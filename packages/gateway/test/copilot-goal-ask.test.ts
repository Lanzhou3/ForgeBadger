import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { notifyGoalStatus, GOAL_NOTIFICATION_TYPE } from "../src/services/agent/goal-notify.js";
import { evaluateGoalContinuation } from "../src/services/agent/goal-driver.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { createGoalTools } from "../src/services/agent/tools/goals.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";
import { AgentError } from "../src/services/agent/types.js";
import { setTimeout as delay } from "node:timers/promises";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

async function waitFor(predicate: () => boolean, description: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) assert.fail(`timed out waiting for: ${description}`);
    await delay(25);
  }
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

interface Envelope<T> { code: number; message: string; data?: T }

interface AskFixture {
  db: Database.Database;
  userId: string;
  conversationId: string;
  goalId: string;
  runId: string;
  store: CopilotGoalStore;
  ask(input: unknown): Promise<Record<string, unknown>>;
  context: AgentToolContext;
}

function createFixture(): AskFixture {
  const db = createTestDb();
  const user = new UserRepository(db).create("goal-ask@example.com", "hash");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, title: "Ask goal", spec: "needs a decision" }).id;
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goalId, Date.now(), Date.now());
  const tool = createGoalTools().find(entry => entry.name === "goal_ask_user")!;
  const context = { db, userId: user.id, masterKey: "k", runId } as AgentToolContext;
  return {
    db, userId: user.id, conversationId: conversation.id, goalId, runId, store,
    ask: input => tool.execute(input, context) as Promise<Record<string, unknown>>,
    context
  };
}

function notificationsFor(db: Database.Database, userId: string): Array<{ type: string; title_key: string; message: string; href: string; payload: string | null }> {
  return db.prepare("SELECT type,title_key,message,href,payload FROM notifications WHERE user_id=? ORDER BY created_at").all(userId) as Array<{ type: string; title_key: string; message: string; href: string; payload: string | null }>;
}

describe("goal_ask_user decision point", () => {
  const dbs: Database.Database[] = [];
  function tracked(): AskFixture { const fixture = createFixture(); dbs.push(fixture.db); return fixture; }

  after(() => { for (const db of dbs) if (db.open) db.close(); });

  it("blocks the goal with a pending question, journals it and notifies exactly once", async () => {
    const fixture = tracked();
    const result = await fixture.ask({ question: "用方案 A（改动小）还是方案 B（更彻底）？" }) as { status: string; blockedReason: string };
    assert.equal(result.status, "blocked");
    assert.equal(result.blockedReason, "awaiting_user");
    const goal = fixture.store.getGoal(fixture.goalId)!;
    assert.equal(goal.status, "blocked");
    assert.equal(goal.blocked_reason, "awaiting_user");
    assert.equal(goal.pending_question, "用方案 A（改动小）还是方案 B（更彻底）？");
    assert.ok(fixture.store.recentJournal(fixture.goalId).some(entry => entry.note.includes("用方案 A")));
    const notifications = notificationsFor(fixture.db, fixture.userId);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.type, GOAL_NOTIFICATION_TYPE);
    assert.match(notifications[0]!.message, /Ask goal/);
    assert.match(notifications[0]!.message, /用方案 A/);
    assert.equal(notifications[0]!.href, `/copilot/goals/${fixture.goalId}`);
    // Re-entrant notification paths stay idempotent per (goal, status, reason).
    notifyGoalStatus(fixture.db, fixture.userId, fixture.store.getGoal(fixture.goalId)!);
    assert.equal(notificationsFor(fixture.db, fixture.userId).length, 1);
    // The driver never continues an awaiting_user goal.
    const decision = evaluateGoalContinuation({ db: fixture.db, masterKey: "k", eventBus: new ForgeBadgerEventBus() }, fixture.userId, fixture.goalId);
    assert.equal(decision.action, "inactive");
  });

  it("notifies again on a second awaiting_user cycle, even with the same question (P2-10)", async () => {
    const fixture = tracked();
    await fixture.ask({ question: "Same question?" });
    assert.equal(notificationsFor(fixture.db, fixture.userId).length, 1);
    // Answer cycle.
    const store = new CopilotGoalStore(fixture.db, fixture.userId);
    store.applyAnswer(fixture.goalId, "yes", null);
    assert.equal(store.getGoal(fixture.goalId)!.status, "active");
    // Second ask with the SAME question must still notify (sequence advances).
    await fixture.ask({ question: "Same question?" });
    const notifications = notificationsFor(fixture.db, fixture.userId);
    assert.equal(notifications.length, 2);
    assert.ok(store.recentJournal(fixture.goalId).filter(entry => entry.note.includes("Decision required")).length >= 2);
  });

  it("stops the current run gracefully after goal_ask_user blocks the goal (P2-15)", async () => {
    const fixture = tracked();
    const { createCopilotOrchestrator } = await import("../src/services/agent/orchestrator.js");
    const { createAgentToolRegistry } = await import("../src/services/agent/tool-registry.js");
    const { createPlatformTools } = await import("../src/services/agent/tools/index.js");
    let calls = 0;
    const llm = {
      async stream(request: { onEvent: (event: { type: string; toolCall?: { id: string; name: string; arguments: string } }) => void }) {
        calls += 1;
        if (calls === 1) {
          request.onEvent({ type: "tool_call", toolCall: { id: "ask-1", name: "goal_ask_user", arguments: JSON.stringify({ question: "Which approach?" }) } });
          return { message: "" };
        }
        return { message: "should never be reached" };
      },
      async summarize() { return ""; },
      async generateTitle() { return ""; }
    };
    const orchestrator = createCopilotOrchestrator({
      db: fixture.db, masterKey, toolRegistry: createAgentToolRegistry(createPlatformTools()),
      llm: llm as never, eventBus: new ForgeBadgerEventBus()
    });
    fixture.db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND id=?")
      .run(Date.now(), fixture.userId, fixture.runId);
    const runId = await orchestrator.runTurn({
      userId: fixture.userId, conversationId: fixture.conversationId,
      userText: "I need a decision", source: "user", clientRequestId: "ask-run-1", goalId: fixture.goalId
    });
    const run = fixture.db.prepare("SELECT status, stop_reason FROM copilot_runs WHERE user_id=? AND id=?").get(fixture.userId, runId) as { status: string; stop_reason: string | null };
    assert.equal(run.status, "stopped");
    assert.equal(run.stop_reason, "goal_blocked");
    const goal = fixture.store.getGoal(fixture.goalId)!;
    assert.equal(goal.status, "blocked");
    assert.equal(goal.blocked_reason, "awaiting_user");
    assert.equal(calls, 1); // the model was never called again after the ask
    assert.equal(notificationsFor(fixture.db, fixture.userId).length, 1);
  });

  it("requires an active goal", async () => {
    const fixture = tracked();
    fixture.store.setStatus(fixture.goalId, "paused");
    await assert.rejects(fixture.ask({ question: "q" }),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_STATE");
  });
});

describe("goal answer endpoint", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let runtime: ReturnType<typeof createGatewayApp>;
  let baseUrl: string;
  let db: Database.Database;

  before(async () => {
    db = createTestDb();
    const app = runtime = createGatewayApp({
      sessionServerIpcPath: "/tmp/forgebadger-test-goal-answer.sock",
      jwtSecret,
      masterKey,
      db,
      llmFetch: (async () => { throw new Error("llm disabled in route tests"); }) as unknown as typeof fetch,
      sessionManager: new InMemorySessionManager({
        async createSession() {}, async killSession() {}, async capturePane() { return ""; }, async listSessions() { return []; }
      } as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey })
    });
    await new Promise<void>((resolve) => {
      server = app.server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await runtime.close();
  });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    return ((await res.json()) as { data: { token: string } }).data.token;
  }

  const authed = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

  it("409s when the goal is not awaiting an answer", async () => {
    const token = await register("goal-answer-conflict@test.com");
    const conversation = await fetch(`${baseUrl}/api/v1/copilot/conversations`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
    const conversationId = ((await conversation.json()) as { data: { conversation: { id: string } } }).data.conversation.id;
    const created = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST", headers: authed(token),
      body: JSON.stringify({ conversationId, title: "t", spec: "s" })
    });
    const goalId = ((await created.json()) as { data: { goalId: string } }).data.goalId;
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/answer`, {
      method: "POST", headers: authed(token), body: JSON.stringify({ answer: "方案 A" })
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { details: { code: string } };
    assert.equal(body.details.code, "COPILOT_GOAL_STATE");
    await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/cancel`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
  });

  it("answer resumes the goal, clears the question and enqueues the answer run", async () => {
    const token = await register("goal-answer-flow@test.com");
    const conversation = await fetch(`${baseUrl}/api/v1/copilot/conversations`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
    const conversationId = ((await conversation.json()) as { data: { conversation: { id: string } } }).data.conversation.id;
    const created = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST", headers: authed(token),
      body: JSON.stringify({ conversationId, title: "Decision goal", spec: "pick an approach" })
    });
    const { goalId, runId } = ((await created.json()) as { data: { goalId: string; runId: string } }).data;
    const user = db.prepare("SELECT id FROM users WHERE email=?").get("goal-answer-flow@test.com") as { id: string };
    const store = new CopilotGoalStore(db, user.id);
    // The initializer run must settle before the answer can enqueue a continuation.
    await waitFor(() => {
      const run = db.prepare("SELECT status FROM copilot_runs WHERE user_id=? AND id=?").get(user.id, runId) as { status: string };
      return ['completed', 'stopped', 'failed', 'cancelled'].includes(run.status);
    }, "initializer run to settle");
    // Simulate the in-run decision point directly at the service layer.
    store.setStatus(goalId, "blocked", "awaiting_user");
    store.setPendingQuestion(goalId, "Which approach?");
    store.appendJournal(goalId, runId, "Decision required from owner: Which approach?");
    const before = notificationsFor(db, user.id);
    assert.equal(before.length, 0); // service-layer transition does not notify by itself

    const detailBefore = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}`, { headers: authed(token) });
    const detailBody = ((await detailBefore.json()) as { data: { pendingQuestion: string | null } }).data;
    assert.equal(detailBody.pendingQuestion, "Which approach?");

    const answered = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/answer`, {
      method: "POST", headers: authed(token), body: JSON.stringify({ answer: "方案 A，保持改动最小" })
    });
    const answeredJson = (await answered.json()) as Envelope<{ goal: { status: string; pendingQuestion: string | null } }>;
    assert.equal(answered.status, 200, JSON.stringify(answeredJson));
    const answeredBody = answeredJson.data!;
    assert.equal(answeredBody.goal.status, "active");
    assert.equal(answeredBody.goal.pendingQuestion, null);
    assert.ok(store.recentJournal(goalId).some(entry => entry.note.includes("Owner answer: 方案 A")));
    assert.ok(store.recentJournal(goalId).some(entry => entry.note.includes("Decision required")));
    // The continuation run is admitted synchronously with the prefixed answer text.
    const runs = db.prepare("SELECT input_json FROM copilot_runs WHERE user_id=? AND conversation_id=? ORDER BY created_at").all(user.id, conversationId) as Array<{ input_json: string }>;
    const answerRun = runs.map(row => JSON.parse(row.input_json) as { userText?: string }).find(input => input.userText?.startsWith("[Goal 用户答复]"));
    assert.ok(answerRun);
    assert.match(answerRun.userText ?? "", /方案 A，保持改动最小/);
    await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/cancel`, { method: "POST", headers: authed(token), body: JSON.stringify({}) });
  });
});
