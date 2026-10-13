import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { goalGrantForTool, GOAL_GRANT_TOOLS } from "../src/services/agent/goal-grants.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";

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

/** LLM that requests the operate tool exactly once, then answers with text. */
function toolCallingLlm(toolName: string, argumentsJson: string): AgentLlmClient {
  let calls = 0;
  return {
    async stream(request) {
      calls += 1;
      const emit = request.onEvent as (event: AgentLlmStreamEvent) => void;
      if (calls === 1) {
        emit({ type: "tool_call", toolCall: { id: "op-1", name: toolName, arguments: argumentsJson } });
        return { message: "" };
      }
      return { message: "done" };
    },
    async summarize() { return ""; },
    async generateTitle() { return ""; }
  };
}

interface GrantFixture {
  db: Database.Database;
  userId: string;
  conversationId: string;
  orchestrator: ReturnType<typeof createCopilotOrchestrator>;
  log: CopilotConversationLog;
  admitRun(goalId?: string): Promise<string>;
}

function grantFixture(grants?: string[]): GrantFixture {
  const db = createTestDb();
  const user = new UserRepository(db).create("goal-grants@example.com", "hash");
  const log = new CopilotConversationLog(db, user.id);
  const conversation = log.createConversation();
  // `start_session` maps to the real platform command session.start, so the
  // gate runs its full platform-action path; the session row makes resolve
  // pass and the missing session runtime fails execution AFTER the gate.
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
    .run("project-1", user.id, "p", "/tmp/goal-grants-project", "claude", "active");
  const session = new SessionRepository(db, user.id).create({
    projectId: "project-1", name: "target", aiTool: "claude", workingDir: "/tmp/goal-grants-project", credentialMode: "host_environment"
  });
  const registry = createAgentToolRegistry([{
    name: "takeover_session",
    description: "operate fixture",
    risk: "operate",
    requiresApproval: true,
    inputSchema: z.object({ sessionId: z.string().min(1).max(128) }).strict(),
    async execute() { return { started: true }; }
  }]);
  const orchestrator = createCopilotOrchestrator({
    db, masterKey, toolRegistry: registry, llm: toolCallingLlm("takeover_session", JSON.stringify({ sessionId: session.id })), eventBus: new ForgeBadgerEventBus(),
    sessionManager: new InMemorySessionManager({
      async createSession() {}, async killSession() {}, async capturePane() { return ""; }, async listSessions() { return []; },
      takeoverSession() {}
    } as never)
  });
  const store = new CopilotGoalStore(db, user.id);
  const goalId = grants
    ? store.createGoal({ conversationId: conversation.id, title: "Granted goal", spec: "s", grants }).id
    : undefined;
  return {
    db, userId: user.id, conversationId: conversation.id, orchestrator, log,
    async admitRun(runGoalId?: string) {
      return orchestrator.enqueue({
        userId: user.id, conversationId: conversation.id, userText: "please start a session",
        source: "user", clientRequestId: randomUUID(),
        ...(runGoalId ? { goalId: runGoalId } : {})
      });
    }
  };
}

async function driveRun(fixture: GrantFixture, runId: string): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await fixture.orchestrator.executeRun(fixture.userId, runId);
}

describe("goal authorization grants in the approval gate", () => {
  const dbs: Database.Database[] = [];
  function tracked(fixture: GrantFixture) { dbs.push(fixture.db); return fixture; }

  after(() => { for (const db of dbs) if (db.open) db.close(); });

  it("auto-approves a covered operate tool inside a granted goal run and journals it", async () => {
    const fixture = tracked(grantFixture(["operate_sessions"]));
    const goalId = new CopilotGoalStore(fixture.db, fixture.userId).listGoals()[0]!.id;
    assert.equal(goalGrantForTool(fixture.db, fixture.userId, goalId, "takeover_session"), "operate_sessions");
    const runId = await fixture.admitRun(goalId);
    await driveRun(fixture, runId);
    // The gate auto-approved: the run completed with a tool receipt (the
    // session runtime is absent in this fixture) and no pending action exists.
    assert.equal(fixture.log.getRun(runId)?.status, "completed");
    assert.equal(fixture.log.listPendingActions(runId).length, 0);
    const journal = new CopilotGoalStore(fixture.db, fixture.userId).recentJournal(goalId);
    assert.ok(journal.some(entry => entry.note.includes("自动执行 takeover_session") && entry.note.includes("operate_sessions")));
    const toolResult = fixture.log.listMessages(fixture.conversationId).find(message => message.kind === "tool_result");
    assert.ok(toolResult);
  });

  it("keeps per-call approval for goal runs without the grant", async () => {
    const fixture = tracked(grantFixture());
    const goalId = new CopilotGoalStore(fixture.db, fixture.userId)
      .createGoal({ conversationId: fixture.conversationId, title: "Ung ranted".replace(" ", ""), spec: "s" }).id;
    const runId = await fixture.admitRun(goalId);
    await driveRun(fixture, runId);
    assert.equal(fixture.log.getRun(runId)?.status, "awaiting_approval");
    assert.equal(fixture.log.listPendingActions(runId).length, 1);
    // Owner approval resumes and the tool executes (existing flow unchanged).
    const action = fixture.log.listPendingActions(runId)[0]!;
    await fixture.orchestrator.resumeAfterApproval({ userId: fixture.userId, runId, actionId: action.id, approved: true });
    assert.equal(fixture.log.getRun(runId)?.status, "completed");
    const journal = new CopilotGoalStore(fixture.db, fixture.userId).recentJournal(goalId);
    assert.equal(journal.some(entry => entry.note.includes("自动执行")), false);
  });

  it("leaves non-goal runs on the per-call approval path", async () => {
    const fixture = tracked(grantFixture());
    const runId = await fixture.admitRun();
    await driveRun(fixture, runId);
    assert.equal(fixture.log.getRun(runId)?.status, "awaiting_approval");
    assert.equal(fixture.log.listPendingActions(runId).length, 1);
  });

  it("stops covering tools once the goal is no longer active (P1-3)", async () => {
    const fixture = tracked(grantFixture(["operate_sessions"]));
    const goalId = new CopilotGoalStore(fixture.db, fixture.userId).listGoals()[0]!.id;
    const store = new CopilotGoalStore(fixture.db, fixture.userId);
    store.setStatus(goalId, "cancelled");
    assert.equal(goalGrantForTool(fixture.db, fixture.userId, goalId, "takeover_session"), null);
    // An in-flight run of the cancelled goal stops immediately (goal lifecycle
    // gate) and never reaches the operate tool.
    const runId = await fixture.admitRun(goalId);
    await driveRun(fixture, runId);
    const run = fixture.log.getRun(runId)!;
    assert.equal(run.status, "stopped");
    assert.equal((run as { stopReason?: string }).stopReason, "goal_cancelled");
    assert.equal(fixture.log.listPendingActions(runId).length, 0);
  });

  it("maps every grant to an auditable tool set", () => {
    assert.deepEqual(Object.keys(GOAL_GRANT_TOOLS).sort(), ["operate_sessions", "pm_dispatch", "terminal_run"]);
    assert.ok(GOAL_GRANT_TOOLS.pm_dispatch!.includes("goal_dispatch_task"));
  });
});

describe("POST /goals grants validation", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let runtime: ReturnType<typeof createGatewayApp>;
  let baseUrl: string;

  before(async () => {
    const db = createTestDb();
    const app = runtime = createGatewayApp({
      sessionServerIpcPath: "/tmp/forgebadger-test-goal-grants.sock",
      jwtSecret, masterKey, db,
      llmFetch: (async () => { throw new Error("llm disabled"); }) as unknown as typeof fetch,
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

  it("rejects unknown grant values with 400 and persists valid ones", async () => {
    const register = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "goal-grants-route@test.com", password: "password123" })
    });
    const token = ((await register.json()) as { data: { token: string } }).data.token;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    const conversation = await fetch(`${baseUrl}/api/v1/copilot/conversations`, { method: "POST", headers, body: JSON.stringify({}) });
    const conversationId = ((await conversation.json()) as { data: { conversation: { id: string } } }).data.conversation.id;

    const invalid = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST", headers,
      body: JSON.stringify({ conversationId, title: "t", spec: "s", grants: ["operate_everything"] })
    });
    assert.equal(invalid.status, 400);

    const valid = await fetch(`${baseUrl}/api/v1/copilot/goals`, {
      method: "POST", headers,
      body: JSON.stringify({ conversationId, title: "t", spec: "s", grants: ["terminal_run", "pm_dispatch"] })
    });
    const validJson = (await valid.json()) as { data: { goalId: string } };
    assert.equal(valid.status, 201, JSON.stringify(validJson));
    const goalId = validJson.data.goalId;
    const detail = await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}`, { headers });
    const body = (await detail.json()) as { data: { goal: { grants: string[] } } };
    assert.deepEqual(body.data.goal.grants.sort(), ["pm_dispatch", "terminal_run"]);
    await fetch(`${baseUrl}/api/v1/copilot/goals/${goalId}/cancel`, { method: "POST", headers, body: JSON.stringify({}) });
  });
});
