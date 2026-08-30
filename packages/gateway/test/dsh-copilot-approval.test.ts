import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp, type GatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import type { OpenForgeEvent } from "../src/services/event-bus.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const bridgeToken = "dsh-approval-test-bridge-token-0123456789abcdef";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

const FAKE_LAUNCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "fake-dsh-runtime.mjs");

interface SentInput {
  name: string;
  data: string;
}

function createMockTmux(sentInputs: SentInput[]) {
  const panes = new Map<string, string>();
  const staged = new Map<string, string>();
  return {
    async createSession(options: { name: string }) {
      panes.set(options.name, "────────────────\n❯  \n────────────────\nauto mode on");
    },
    async killSession() {},
    async capturePane(name: string) { return panes.get(name) ?? ""; },
    async listSessions() { return [] as string[]; },
    async sendInput(name: string, data: string) {
      sentInputs.push({ name, data });
      panes.set(name, (panes.get(name) ?? "") + data);
    },
    async inspectPane(name: string) {
      return { content: panes.get(name) ?? "", dead: false, inMode: false };
    },
    async stageProgrammaticInput(name: string, data: string) {
      sentInputs.push({ name, data });
      staged.set(name, data);
      panes.set(name, `────────────────\n❯ ${data}\n────────────────\nauto mode on`);
    },
    async pressEnter(name: string) {
      sentInputs.push({ name, data: "<Enter>" });
      panes.set(name, `${staged.get(name) ?? ""}\n────────────────\n❯  \n────────────────\nauto mode on`);
    }
  };
}

interface Harness {
  app: GatewayApp;
  baseUrl: string;
  db: Database.Database;
  stateDir: string;
  logPath: string;
  events: OpenForgeEvent[];
  sentInputs: SentInput[];
  sessionManager: InMemorySessionManager;
}

const cleanups: Array<() => Promise<void> | void> = [];
after(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

/** Boot a gateway with the dsh copilot BFF wired to the fake runtime. */
async function bootDshGateway(input: { scenario: string; idleMs?: number; extraEnv?: Record<string, string> }): Promise<Harness> {
  const db = createTestDb();
  const stateDir = mkdtempSync(path.join(tmpdir(), "openforge-dsh-approval-test-"));
  const logPath = path.join(stateDir, "fake-runtime.jsonl");
  const events: OpenForgeEvent[] = [];
  const sentInputs: SentInput[] = [];
  const sessionManager = new InMemorySessionManager(createMockTmux(sentInputs) as never);
  const app = createGatewayApp({
    jwtSecret,
    masterKey,
    db,
    sessionManager,
    apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
    dshCopilot: {
      launcherPath: FAKE_LAUNCHER,
      gatewayUrl: "http://127.0.0.1:1",
      bridgeToken,
      stateDir,
      idleMs: input.idleMs ?? 60_000,
      extraEnv: { DSH_FAKE_SCENARIO: input.scenario, DSH_FAKE_LOG: logPath, ...input.extraEnv }
    }
  });
  app.eventBus.on("event", (event) => events.push(event));
  const server = app.server;
  let baseUrl = "";
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  cleanups.push(async () => { await app.close(); rmSync(stateDir, { recursive: true, force: true }); });
  return { app, baseUrl, db, stateDir, logPath, events, sentInputs, sessionManager };
}

async function registerAndSeed(h: Harness, email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${h.baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  const body = (await res.json()) as { data: { token: string } };
  assert.equal(res.status, 201, JSON.stringify(body));
  const user = h.db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string };
  const repo = new ModelProviderRepository(h.db, user.id, masterKey);
  const provider = repo.createProviderProfile({
    name: "Stub",
    providerKey: "stub",
    anthropicBaseUrl: "https://stub.example",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["opencode"]
  });
  repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Stub model",
    modelId: "stub-model",
    capabilities: ["chat"],
    isDefault: true
  });
  repo.createCredential({ providerProfileId: provider.id, label: "key", plaintextSecret: "fake-llm-key" });
  return { token: body.data.token, userId: user.id };
}

async function createConversation(h: Harness, token: string): Promise<string> {
  const res = await fetch(`${h.baseUrl}/api/v1/copilot/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
  const body = (await res.json()) as { data: { conversation: { id: string } } };
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.data.conversation.id;
}

async function sendMessage(h: Harness, token: string, conversationId: string, content: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${h.baseUrl}/api/v1/copilot/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content })
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function decide(h: Harness, token: string, runId: string, actionId: string, approved: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${h.baseUrl}/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ approved })
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function getRun(h: Harness, token: string, runId: string): Promise<{ run: { status: string }; pendingActions: Array<{ id: string; status: string; tool: string }> }> {
  const res = await fetch(`${h.baseUrl}/api/v1/copilot/runs/${runId}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { data: { run: { status: string }; pendingActions: Array<{ id: string; status: string; tool: string }> } };
  return body.data;
}

function readFakeLog(logPath: string): Array<Record<string, unknown>> {
  return readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await sleep(25);
  }
}

/** Send a message and wait until the run parks on an approval. */
async function sendUntilAwaiting(h: Harness, token: string, conversationId: string, content: string): Promise<string> {
  const { status, body } = await sendMessage(h, token, conversationId, content);
  assert.equal(status, 201, JSON.stringify(body));
  const runId = (body.data as { runId: string }).runId;
  await waitFor(() => {
    const row = h.db.prepare("SELECT status FROM copilot_runs WHERE id = ?").get(runId) as { status: string } | undefined;
    return row?.status === "awaiting_approval";
  });
  return runId;
}

describe("dsh copilot approval bridging (M3, fake runtime)", () => {
  it("runs the full approval cycle: ask -> pending action -> approve -> tool result -> completed", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "operate" });
    const { token, userId } = await registerAndSeed(h, "dsh-approve@test.com");
    const conversationId = await createConversation(h, token);

    // Act: the model calls an operate tool; the run parks on owner approval.
    const runId = await sendUntilAwaiting(h, token, conversationId, "把任务下发给会话");

    // Assert: pending action row + WS event + the runtime asked over JSON-RPC.
    const before = await getRun(h, token, runId);
    assert.equal(before.run.status, "awaiting_approval");
    assert.equal(before.pendingActions.length, 1);
    assert.equal(before.pendingActions[0]?.tool, "dispatch_task_to_session");
    assert.equal(before.pendingActions[0]?.status, "pending");
    const awaitingEvent = h.events.find((e) => e.type === "copilot_run_updated" && e.status === "awaiting_approval");
    assert.equal((awaitingEvent as { pendingActionId?: string } | undefined)?.pendingActionId, before.pendingActions[0]?.id);
    const approvalAsk = readFakeLog(h.logPath).find((r) => r.kind === "approval");
    assert.deepEqual(approvalAsk?.args, { sessionId: "sess-1", message: "修复登录页" });

    // Act: the owner approves; the suspended kernel tool call continues.
    const decided = await decide(h, token, runId, before.pendingActions[0]!.id, true);
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal((decided.body.data as { resumed: boolean }).resumed, true);
    await waitFor(() => {
      const row = h.db.prepare("SELECT status FROM copilot_runs WHERE id = ?").get(runId) as { status: string } | undefined;
      return row?.status === "completed";
    });

    // Assert: the runtime saw allowed-once, the projection has the tool result
    // and the closing assistant text, and the run finalized with a WS event.
    assert.equal(readFakeLog(h.logPath).find((r) => r.kind === "approval-response")?.outcome, "allowed-once");
    const log = new CopilotConversationLog(h.db, userId);
    const messages = log.listMessages(conversationId);
    assert.deepEqual(
      messages.map((m) => `${m.role}:${m.kind}`),
      ["user:text", "assistant:tool_call", "tool:tool_result", "assistant:text"]
    );
    assert.equal(messages[2]?.content, '{"dispatched":true,"sessionId":"sess-1"}');
    assert.equal(log.getPendingAction(before.pendingActions[0]!.id)?.status, "approved");
    assert.ok(h.events.some((e) => e.type === "copilot_run_updated" && e.status === "completed"));
  });

  it("returns the rejection to the model as a tool result", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "operate" });
    const { token, userId } = await registerAndSeed(h, "dsh-reject@test.com");
    const conversationId = await createConversation(h, token);
    const runId = await sendUntilAwaiting(h, token, conversationId, "下发任务");
    const { pendingActions } = await getRun(h, token, runId);

    // Act
    const decided = await decide(h, token, runId, pendingActions[0]!.id, false);
    assert.equal((decided.body.data as { resumed: boolean }).resumed, true);
    await waitFor(() => {
      const row = h.db.prepare("SELECT status FROM copilot_runs WHERE id = ?").get(runId) as { status: string } | undefined;
      return row?.status === "completed";
    });

    // Assert: the runtime got the rejection and projected a denied tool result.
    assert.equal(readFakeLog(h.logPath).find((r) => r.kind === "approval-response")?.outcome, "rejected");
    const log = new CopilotConversationLog(h.db, userId);
    const toolResult = log.listMessages(conversationId).find((m) => m.kind === "tool_result");
    assert.match(toolResult?.content ?? "", /Denied: Rejected by the owner/);
    assert.equal(log.getPendingAction(pendingActions[0]!.id)?.status, "rejected");
  });

  it("makes repeated decides idempotent (no double execution)", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "operate" });
    const { token } = await registerAndSeed(h, "dsh-idem@test.com");
    const conversationId = await createConversation(h, token);
    const runId = await sendUntilAwaiting(h, token, conversationId, "下发任务");
    const { pendingActions } = await getRun(h, token, runId);

    // Act
    const first = await decide(h, token, runId, pendingActions[0]!.id, true);
    const second = await decide(h, token, runId, pendingActions[0]!.id, true);
    await waitFor(() => {
      const row = h.db.prepare("SELECT status FROM copilot_runs WHERE id = ?").get(runId) as { status: string } | undefined;
      return row?.status === "completed";
    });

    // Assert
    assert.equal((first.body.data as { resumed: boolean }).resumed, true);
    assert.equal((second.body.data as { resumed: boolean }).resumed, false, "second decide is a no-op");
    assert.equal(readFakeLog(h.logPath).filter((r) => r.kind === "approval").length, 1, "the tool call ran once");
  });

  it("rejects an action id that belongs to a different awaiting run", async () => {
    // Arrange: park run A on a dispatch, then let its runtime die so a bad
    // cross-run decision would otherwise enter the gateway-side fallback.
    const taskMessage = "cross-run dispatch must never execute";
    const h = await bootDshGateway({ scenario: "operate-crash" });
    const { token, userId } = await registerAndSeed(h, "dsh-cross-run-action@test.com");
    const conversationId = await createConversation(h, token);
    const project = new ProjectRepository(h.db, userId).create({ name: "P", path: "/tmp/dsh-cross-run", aiTool: "claude" });
    const sessionId = new SessionRepository(h.db, userId).create({
      projectId: project.id,
      name: "Cross-run target",
      aiTool: "claude",
      workingDir: project.path
    }).id;
    await h.sessionManager.createSession({
      userId,
      sessionId,
      launchPlan: { command: "claude", args: [], cwd: project.path, env: {}, secretEnvNames: [], credentialMode: "host_environment" }
    });
    const runA = await sendUntilAwaiting(h, token, conversationId, "下发任务");
    await waitFor(() => readFakeLog(h.logPath).some((record) => record.kind === "crashed"));
    await sleep(200);
    const actionA = (await getRun(h, token, runA)).pendingActions[0]!;
    h.db.prepare("UPDATE copilot_pending_actions SET input_json = ? WHERE id = ?")
      .run(JSON.stringify({ sessionId, message: taskMessage }), actionA.id);
    const log = new CopilotConversationLog(h.db, userId);
    const runB = log.createRun(conversationId, { provider: "stub", model: "stub-model" });
    log.updateRun(runB.id, { status: "awaiting_approval", startedAt: new Date() });

    // Act: submit run A's action id through run B's decision URL.
    const decided = await decide(h, token, runB.id, actionA.id, true);

    // Assert: fail closed without mutating either run/action or touching tmux.
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal((decided.body.data as { resumed: boolean }).resumed, false);
    assert.equal(log.getPendingAction(actionA.id)?.status, "pending");
    assert.equal(log.getRun(runA)?.status, "awaiting_approval");
    assert.equal(log.getRun(runB.id)?.status, "awaiting_approval");
    assert.equal(h.sentInputs.filter((input) => input.data === taskMessage).length, 0);
    assert.equal(h.sentInputs.filter((input) => input.data === "<Enter>").length, 0);

    // Cleanup the real pending run through its own context.
    await decide(h, token, runA, actionA.id, false);
  });

  it("denies denylisted operate input before any pending action is created", async () => {
    // Arrange: dispatch message carries a destructive shell pattern.
    const h = await bootDshGateway({
      scenario: "operate",
      extraEnv: { DSH_FAKE_OPERATE_ARGS: '{"sessionId":"sess-1","message":"rm -rf / --no-preserve-root"}' }
    });
    const { token } = await registerAndSeed(h, "dsh-deny@test.com");
    const conversationId = await createConversation(h, token);

    // Act
    const { status, body } = await sendMessage(h, token, conversationId, "下发任务");
    assert.equal(status, 201, JSON.stringify(body));
    const runId = (body.data as { runId: string }).runId;

    // Assert: no pending action, the runtime was answered rejected, the run completed.
    const { run, pendingActions } = await getRun(h, token, runId);
    assert.equal(run.status, "completed");
    assert.deepEqual(pendingActions, []);
    assert.equal(readFakeLog(h.logPath).find((r) => r.kind === "approval-response")?.outcome, "rejected");
    const denied = h.events.find((e) => e.type === "copilot_run_updated" && (e as { message?: string }).message === "denied");
    assert.ok(denied, "deny WS event emitted");
    const opLog = h.db.prepare("SELECT result_json FROM copilot_operation_log WHERE operation = ?").get("dispatch_task_to_session") as { result_json: string } | undefined;
    assert.equal((JSON.parse(opLog?.result_json ?? "{}") as { action?: string }).action, "deny");
  });

  it("cancel during pending rejects the action and kills the runtime", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "operate-hang" });
    const { token, userId } = await registerAndSeed(h, "dsh-cancel-pending@test.com");
    const conversationId = await createConversation(h, token);
    const runId = await sendUntilAwaiting(h, token, conversationId, "下发任务");
    const { pendingActions } = await getRun(h, token, runId);

    // Act
    const cancelRes = await fetch(`${h.baseUrl}/api/v1/copilot/runs/${runId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const cancelBody = (await cancelRes.json()) as { data: { cancelled: boolean } };

    // Assert
    assert.equal(cancelBody.data.cancelled, true);
    const log = new CopilotConversationLog(h.db, userId);
    assert.equal(log.getRun(runId)?.status, "cancelled");
    assert.equal(log.getPendingAction(pendingActions[0]!.id)?.status, "rejected");
    // The runtime process is gone: a late decide is a no-op.
    const late = await decide(h, token, runId, pendingActions[0]!.id, true);
    assert.equal((late.body.data as { resumed: boolean }).resumed, false);
  });

  it("keeps the pending action decidable after a mid-approval crash and executes gateway-side", async () => {
    // Arrange: a real session row so the gateway-side dispatch passes the tenant check.
    const taskMessage = "请继续处理...\n\n1. 先复现问题\n2. 再运行测试";
    const h = await bootDshGateway({
      scenario: "operate-crash",
      extraEnv: {
        DSH_FAKE_OPERATE_ARGS: JSON.stringify({ sessionId: "sess-1", message: taskMessage })
      }
    });
    const { token, userId } = await registerAndSeed(h, "dsh-crash-pending@test.com");
    const conversationId = await createConversation(h, token);
    const project = new ProjectRepository(h.db, userId).create({ name: "P", path: "/tmp/dsh-approval-crash", aiTool: "claude" });
    const sessionId = new SessionRepository(h.db, userId).create({
      projectId: project.id,
      name: "Dispatch target",
      aiTool: "claude",
      workingDir: project.path
    }).id;
    await h.sessionManager.createSession({
      userId,
      sessionId,
      launchPlan: { command: "claude", args: [], cwd: project.path, env: {}, secretEnvNames: [], credentialMode: "host_environment" }
    });

    // Act: the runtime asks for approval and dies before the owner decides.
    const runId = await sendUntilAwaiting(h, token, conversationId, "下发任务");
    const awaiting = await getRun(h, token, runId);
    assert.equal(awaiting.run.status, "awaiting_approval");
    assert.equal(awaiting.pendingActions.length, 1);
    assert.deepEqual(readFakeLog(h.logPath).find((r) => r.kind === "approval")?.args, {
      sessionId: "sess-1",
      message: taskMessage
    });
    assert.equal(h.sentInputs.length, 0, "approval must park before dispatch reaches tmux");
    await waitFor(() => readFakeLog(h.logPath).some((r) => r.kind === "crashed"));
    await sleep(200); // let the exit propagate to the process manager
    // Point the pending action at the REAL session before deciding (the fake
    // runtime asked with sess-1; the row input drives the fallback execution).
    const { pendingActions } = await getRun(h, token, runId);
    assert.equal(pendingActions.length, 1);
    h.db.prepare("UPDATE copilot_pending_actions SET input_json = ? WHERE id = ?")
      .run(JSON.stringify({ sessionId, message: taskMessage }), pendingActions[0]!.id);

    const decided = await decide(h, token, runId, pendingActions[0]!.id, true);

    // Assert: the fallback executed the dispatch gateway-side (tmux got the
    // bytes), completed the run, projected the tool result, and injected the
    // decision into the respawned runtime's session.
    assert.equal((decided.body.data as { resumed: boolean }).resumed, true, JSON.stringify(decided.body));
    const log = new CopilotConversationLog(h.db, userId);
    assert.equal(log.getRun(runId)?.status, "completed");

    const repeated = await decide(h, token, runId, pendingActions[0]!.id, true);
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    assert.equal((repeated.body.data as { resumed: boolean }).resumed, false);
    const afterRepeated = await getRun(h, token, runId);
    assert.equal(afterRepeated.run.status, "completed");
    assert.equal(afterRepeated.pendingActions.length, 1);
    assert.equal(afterRepeated.pendingActions[0]?.status, "approved");

    assert.equal(
      h.sentInputs.filter((input) => input.data === taskMessage).length,
      1,
      "approved dispatch reached programmatic tmux staging exactly once"
    );
    assert.equal(h.sentInputs.filter((input) => input.data === "<Enter>").length, 1);
    const toolResult = log.listMessages(conversationId).find((m) => m.kind === "tool_result");
    assert.match(toolResult?.content ?? "", /"dispatched":true/);
    await waitFor(() => readFakeLog(h.logPath).some((r) => r.kind === "inject"));
    const inject = readFakeLog(h.logPath).find((r) => r.kind === "inject");
    assert.match(String(inject?.text ?? ""), /approved/);
  });

  it("respawns and resumes the conversation after a crash-during-pending", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "operate-crash" });
    const { token } = await registerAndSeed(h, "dsh-crash-resume@test.com");
    const conversationId = await createConversation(h, token);
    const runId = await sendUntilAwaiting(h, token, conversationId, "下发任务");
    await waitFor(() => readFakeLog(h.logPath).some((r) => r.kind === "crashed"));
    await sleep(200);
    const { pendingActions } = await getRun(h, token, runId);
    await decide(h, token, runId, pendingActions[0]!.id, false);

    // Act: the next user message must transparently respawn + resume.
    const next = await sendMessage(h, token, conversationId, "继续聊");

    // Assert
    assert.equal(next.status, 201, JSON.stringify(next.body));
    const records = readFakeLog(h.logPath);
    const prompts = records.filter((r) => r.kind === "prompt");
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0]?.sessionId, prompts[1]?.sessionId, "resume reuses the persisted dsh session");
    assert.notEqual(prompts[0]?.pid, prompts[1]?.pid);
  });

  it("rejects a new message with 409 while a run is parked on approval", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "operate" });
    const { token } = await registerAndSeed(h, "dsh-await-busy@test.com");
    const conversationId = await createConversation(h, token);
    const runId = await sendUntilAwaiting(h, token, conversationId, "下发任务");

    // Act
    const busy = await sendMessage(h, token, conversationId, "插队");

    // Assert
    assert.equal(busy.status, 409, JSON.stringify(busy.body));

    // Cleanup: reject the pending action so the run can settle.
    const { pendingActions } = await getRun(h, token, runId);
    await decide(h, token, runId, pendingActions[0]!.id, false);
  });

  it("returns 501 for edit-message on the dsh path (no implicit divergence)", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "simple" });
    const { token, userId } = await registerAndSeed(h, "dsh-edit@test.com");
    const conversationId = await createConversation(h, token);
    await sendMessage(h, token, conversationId, "第一句");
    const log = new CopilotConversationLog(h.db, userId);
    const messageId = log.listMessages(conversationId)[0]!.id;

    // Act
    const res = await fetch(`${h.baseUrl}/api/v1/copilot/conversations/${conversationId}/edit-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageId, content: "改过的内容" })
    });
    const body = (await res.json()) as { code: number; details?: { code?: string } };

    // Assert
    assert.equal(res.status, 501);
    assert.equal(body.details?.code, "DSH_EDIT_MESSAGE_UNSUPPORTED");
    // Nothing was truncated or rewritten.
    assert.equal(log.listMessages(conversationId).length, 2);
  });
});
