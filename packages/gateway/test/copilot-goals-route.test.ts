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

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

interface Envelope<T> { code: number; message: string; data?: T }
interface GoalDto {
  id: string; title: string; status: string; projectId: string | null; conversationId: string;
  spec: string; blockedReason: string | null;
  createdAt: number; updatedAt: number; completedAt: number | null;
}
interface GoalListItemDto { id: string; title: string; status: string; projectId: string | null; conversationId: string; createdAt: number; taskTotal: number; taskPasses: number }
interface GoalDetailDto { goal: GoalDto; tasks: Array<{ id: string; status: string; evidence: string | null }>; journal: Array<{ id: string; note: string }> }

describe("copilot goals routes", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let runtime: ReturnType<typeof createGatewayApp>;
  let baseUrl: string;
  let db: Database.Database;

  before(async () => {
    db = createTestDb();
    const app = runtime = createGatewayApp({
      sessionServerIpcPath: "/tmp/forgebadger-test-goals-session-server.sock",
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
    const body = (await res.json()) as Envelope<{ token: string }>;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data!.token;
  }

  function authenticated(token: string): Record<string, string> {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  async function createConversation(token: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/copilot/conversations`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as Envelope<{ conversation: { id: string } }>;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data!.conversation.id;
  }

  it("rejects unauthenticated access and invalid create payloads", async () => {
    const token = await register("goals-auth@test.com");
    const conversationId = await createConversation(token);
    const unauthenticated = await fetch(`${baseUrl}/api/v1/copilot/goals`);
    assert.equal(unauthenticated.status, 401);
    for (const payload of [
      { conversationId, spec: "missing title" },
      { conversationId, title: "", spec: "empty title" },
      { conversationId, title: "x".repeat(201), spec: "oversized title" },
      { conversationId, title: "ok", spec: "" },
      { conversationId, title: "ok", spec: "spec", grants: ["not_a_grant"] },
      { conversationId, title: "ok", spec: "spec", unknownField: true }
    ]) {
      const res = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
        method: "POST",
        headers: authenticated(token),
        body: JSON.stringify(payload)
      });
      assert.equal(res.status, 400, JSON.stringify(payload));
    }
  });

  it("creates a goal, enqueues the first run and reports the envelope shape", async () => {
    const token = await register("goals-create@test.com");
    const conversationId = await createConversation(token);
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({ conversationId, title: "Translate README", spec: "Translate the README into English" })
    });
    const body = (await res.json()) as Envelope<{ goalId: string; runId: string }>;
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.code, 0);
    assert.equal(body.message, "");
    assert.ok(body.data!.goalId);
    assert.ok(body.data!.runId);
    const detail = await fetch(`${baseUrl}/api/v1/copilot/goals/${body.data!.goalId}`, { headers: authenticated(token) });
    const detailBody = (await detail.json()) as Envelope<GoalDetailDto>;
    assert.equal(detail.status, 200);
    assert.equal(detailBody.data!.goal.conversationId, conversationId);
    assert.equal(detailBody.data!.goal.status, "active");
    await cancelGoal(token, body.data!.goalId);
  });

  it("404s creating a goal on a missing conversation", async () => {
    const token = await register("goals-missing-conversation@test.com");
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({ conversationId: "missing", title: "t", spec: "s" })
    });
    assert.equal(res.status, 404);
  });

  it("maps a busy conversation to 409 and leaves no active goal behind", async () => {
    const token = await register("goals-busy@test.com");
    const conversationId = await createConversation(token);
    const user = db.prepare("SELECT id FROM users WHERE email=?").get("goals-busy@test.com") as { id: string };
    db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,runtime_version,input_json,created_at,updated_at)
      VALUES(?,?,?,'pending',1,'{}',?,?)`).run(randomUUID(), user.id, conversationId, Date.now(), Date.now());
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({ conversationId, title: "t", spec: "s" })
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as Envelope<never> & { details: { code: string } };
    assert.equal(body.details.code, "COPILOT_CONVERSATION_BUSY");
    const goals = await listGoals(token, conversationId);
    assert.equal(goals.length, 1);
    assert.equal(goals[0].status, "cancelled");
    db.prepare("UPDATE copilot_runs SET status='cancelled',completed_at=? WHERE user_id=? AND conversation_id=? AND status='pending'")
      .run(Date.now(), user.id, conversationId);
  });

  it("lists goals with task progress aggregation, scoped per tenant", async () => {
    const owner = await register("goals-list-owner@test.com");
    const stranger = await register("goals-list-stranger@test.com");
    const conversationA = await createConversation(owner);
    const conversationB = await createConversation(owner);
    const first = await postGoal(owner, conversationA, "Goal A1");
    const second = await postGoal(owner, conversationA, "Goal A2");
    await postGoal(owner, conversationB, "Goal B1");
    const ownerUser = db.prepare("SELECT id FROM users WHERE email=?").get("goals-list-owner@test.com") as { id: string };
    db.prepare("INSERT INTO copilot_goal_tasks(id,user_id,goal_id,seq,description,status,created_at,updated_at) VALUES(?,?,?,1,'task','passes',?,?)")
      .run(randomUUID(), ownerUser.id, first.goalId, Date.now(), Date.now());
    const listA = await listGoals(owner, conversationA);
    assert.equal(listA.length, 2);
    for (const item of listA) {
      assert.equal(typeof item.taskTotal, "number");
      assert.equal(typeof item.taskPasses, "number");
      assert.equal(item.conversationId, conversationA);
    }
    assert.equal(listA.find(item => item.id === first.goalId)?.taskPasses, 1);
    assert.equal(listA.find(item => item.id === second.goalId)?.taskTotal, 0);
    assert.equal((await listGoals(owner)).length, 3);
    assert.equal((await listGoals(stranger)).length, 0);
    const strangerDetail = await fetch(`${baseUrl}/api/v1/copilot/goals/${first.goalId}`, { headers: authenticated(stranger) });
    assert.equal(strangerDetail.status, 404);
    await cancelGoal(owner, first.goalId);
    await cancelGoal(owner, second.goalId);
  });

  it("runs the pause/resume/cancel state machine with 409s on invalid transitions", async () => {
    const token = await register("goals-lifecycle@test.com");
    const conversationId = await createConversation(token);
    const { goalId } = await postGoal(token, conversationId, "Lifecycle goal");

    const paused = await transition(token, goalId, "pause");
    assert.equal(paused.status, 200);
    assert.equal(paused.goal.status, "paused");
    assert.equal((await transitionExpectingConflict(token, goalId, "pause")).details.code, "COPILOT_GOAL_STATE");

    const resumed = await transition(token, goalId, "resume");
    assert.equal(resumed.goal.status, "active");
    assert.equal((await transitionExpectingConflict(token, goalId, "resume")).details.code, "COPILOT_GOAL_STATE");

    const cancelled = await transition(token, goalId, "cancel");
    assert.equal(cancelled.goal.status, "cancelled");
    const cancelledAgain = await transition(token, goalId, "cancel");
    assert.equal(cancelledAgain.goal.status, "cancelled");
    assert.equal((await transitionExpectingConflict(token, goalId, "resume")).details.code, "COPILOT_GOAL_STATE");
  });

  it("allows cancelling a blocked goal", async () => {
    const token = await register("goals-blocked-cancel@test.com");
    const conversationId = await createConversation(token);
    const { goalId } = await postGoal(token, conversationId, "Blocked goal");
    db.prepare("UPDATE copilot_goals SET status='blocked', blocked_reason='goal_budget_exhausted' WHERE id=? AND user_id=(SELECT id FROM users WHERE email=?)")
      .run(goalId, "goals-blocked-cancel@test.com");
    const cancelled = await transition(token, goalId, "cancel");
    assert.equal(cancelled.goal.status, "cancelled");
    assert.equal((await transitionExpectingConflict(token, goalId, "pause")).details.code, "COPILOT_GOAL_STATE");
  });

  async function postGoal(token: string, conversationId: string, title: string): Promise<{ goalId: string; runId: string }> {
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({ conversationId, title, spec: "spec for " + title })
    });
    const body = (await res.json()) as Envelope<{ goalId: string; runId: string }>;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data!;
  }

  async function listGoals(token: string, conversationId?: string): Promise<GoalListItemDto[]> {
    const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals${query}`, { headers: authenticated(token) });
    const body = (await res.json()) as Envelope<{ goals: GoalListItemDto[] }>;
    assert.equal(res.status, 200, JSON.stringify(body));
    return body.data!.goals;
  }

  async function transition(token: string, goalId: string, action: "pause" | "resume" | "cancel"): Promise<{ status: number; goal: GoalDto }> {
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/${action}`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({})
    });
    const body = (await res.json()) as Envelope<{ goal: GoalDto }>;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.code, 0);
    return { status: res.status, goal: body.data!.goal };
  }

  async function transitionExpectingConflict(token: string, goalId: string, action: "pause" | "resume" | "cancel"): Promise<{ details: { code: string } }> {
    const res = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/${action}`, {
      method: "POST",
      headers: authenticated(token),
      body: JSON.stringify({})
    });
    assert.equal(res.status, 409);
    return (await res.json()) as { details: { code: string } };
  }

  async function cancelGoal(token: string, goalId: string): Promise<void> {
    await transition(token, goalId, "cancel");
  }
});
