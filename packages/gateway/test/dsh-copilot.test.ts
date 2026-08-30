import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp, type GatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import type { OpenForgeEvent } from "../src/services/event-bus.js";
import { DshProcessManager } from "../src/services/dsh-copilot/process-manager.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const bridgeToken = "dsh-copilot-test-bridge-token-0123456789abcdef";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

const FAKE_LAUNCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "fake-dsh-runtime.mjs");

function createControlledDshChild(): {
  child: ChildProcess;
  exit(signal?: NodeJS.Signals): void;
} {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const mutable = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
    kill(_signal?: NodeJS.Signals | number): boolean {
      mutable.killed = true;
      return true;
    }
  });
  let inputBuffer = "";
  stdin.on("data", (chunk: Buffer) => {
    inputBuffer += chunk.toString("utf8");
    let newline = inputBuffer.indexOf("\n");
    while (newline >= 0) {
      const frame = JSON.parse(inputBuffer.slice(0, newline)) as { id: number };
      inputBuffer = inputBuffer.slice(newline + 1);
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} })}\n`);
      newline = inputBuffer.indexOf("\n");
    }
  });
  return {
    child: mutable as unknown as ChildProcess,
    exit(signal: NodeJS.Signals = "SIGKILL"): void {
      mutable.signalCode = signal;
      mutable.emit("exit", null, signal);
    }
  };
}

describe("DshProcessManager shutdown guard", () => {
  it("never spawns a runtime after disposeAll begins", async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "openforge-dsh-closing-"));
    let spawnCalls = 0;
    const manager = new DshProcessManager({
      launcherPath: FAKE_LAUNCHER,
      gatewayUrl: "http://127.0.0.1:1",
      bridgeToken,
      stateDir,
      idleMs: 60_000,
      spawnImpl: (() => {
        spawnCalls += 1;
        throw new Error("spawn must not run after dispose");
      }) as never
    });

    try {
      await manager.disposeAll();
      await assert.rejects(
        () => manager.ensureClient("user-after-close", {
          api: "openai-completions",
          baseUrl: "https://stub.example",
          apiKey: "fake-key",
          model: "stub-model",
          modelName: "Stub"
        }),
        /DSH_PROCESS_MANAGER_CLOSED/u
      );
      assert.equal(spawnCalls, 0);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("escalates a stubborn live child from SIGTERM to SIGKILL", async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "openforge-dsh-stubborn-"));
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    let child: ChildProcess | undefined;
    const manager = new DshProcessManager({
      launcherPath: FAKE_LAUNCHER,
      gatewayUrl: "http://127.0.0.1:1",
      bridgeToken,
      stateDir,
      idleMs: 60_000,
      killGraceMs: 20,
      extraEnv: { DSH_FAKE_SCENARIO: "stubborn" },
      spawnImpl: ((...args: Parameters<typeof spawn>) => {
        child = spawn(...args);
        const kill = child.kill.bind(child);
        child.kill = ((signal?: NodeJS.Signals | number) => {
          signals.push(signal);
          return kill(signal);
        }) as ChildProcess["kill"];
        return child;
      }) as typeof spawn
    });

    try {
      await manager.ensureClient("user-stubborn", {
        api: "openai-completions",
        baseUrl: "https://stub.example",
        apiKey: "fake-key",
        model: "stub-model",
        modelName: "Stub"
      });
      await manager.killUser("user-stubborn");

      assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    } finally {
      if (child?.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) => child?.once("exit", () => resolve()));
      }
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("does not let a replaced runtime's late exit delete the current generation", async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "openforge-dsh-generation-"));
    const children: ReturnType<typeof createControlledDshChild>[] = [];
    const manager = new DshProcessManager({
      launcherPath: FAKE_LAUNCHER,
      gatewayUrl: "http://127.0.0.1:1",
      bridgeToken,
      stateDir,
      idleMs: 60_000,
      killGraceMs: 10,
      spawnImpl: (() => {
        const controlled = createControlledDshChild();
        children.push(controlled);
        return controlled.child;
      }) as typeof spawn
    });

    const route = {
      api: "openai-completions",
      baseUrl: "https://stub.example",
      apiKey: "fake-key",
      modelName: "Stub"
    };
    try {
      await manager.ensureClient("user-generation", { ...route, model: "model-a" });
      await manager.ensureClient("user-generation", { ...route, model: "model-b" });
      assert.equal(children.length, 2);
      assert.equal(manager.isRunning("user-generation"), true);

      children[0]?.exit();

      assert.equal(manager.isRunning("user-generation"), true);
      assert.equal(manager.size, 1);
    } finally {
      await manager.disposeAll();
      children[1]?.exit();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

const mockTmuxClient = {
  async createSession() {},
  async killSession() {},
  async capturePane() { return ""; },
  async listSessions() { return []; }
};

interface Harness {
  app: GatewayApp;
  baseUrl: string;
  db: Database.Database;
  stateDir: string;
  logPath: string;
  events: OpenForgeEvent[];
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
async function bootDshGateway(input: { scenario: string; idleMs?: number }): Promise<Harness> {
  const db = createTestDb();
  const stateDir = mkdtempSync(path.join(tmpdir(), "openforge-dsh-test-"));
  const logPath = path.join(stateDir, "fake-runtime.jsonl");
  const events: OpenForgeEvent[] = [];
  const app = createGatewayApp({
    jwtSecret,
    masterKey,
    db,
    sessionManager: new InMemorySessionManager(mockTmuxClient as never),
    apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
    dshCopilot: {
      launcherPath: FAKE_LAUNCHER,
      gatewayUrl: "http://127.0.0.1:1",
      bridgeToken,
      stateDir,
      idleMs: input.idleMs ?? 60_000,
      extraEnv: { DSH_FAKE_SCENARIO: input.scenario, DSH_FAKE_LOG: logPath }
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
  return { app, baseUrl, db, stateDir, logPath, events };
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

describe("dsh copilot BFF (fake runtime)", () => {
  it("runs a full turn: streamed deltas, message projection, run completed", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "simple" });
    const { token, userId } = await registerAndSeed(h, "dsh-simple@test.com");
    const conversationId = await createConversation(h, token);

    // Act
    const { status, body } = await sendMessage(h, token, conversationId, "打个招呼");

    // Assert
    assert.equal(status, 201, JSON.stringify(body));
    const runId = (body.data as { runId: string }).runId;
    const deltas = h.events.filter((e) => e.type === "copilot_run_updated" && e.textDelta);
    assert.deepEqual(deltas.map((e) => (e as { textDelta: string }).textDelta), ["你好", "，世界"]);
    const thinking = h.events.filter((e) => e.type === "copilot_run_updated" && (e as { thinkingDelta?: string }).thinkingDelta);
    assert.equal(thinking.length, 1);
    const completed = h.events.find((e) => e.type === "copilot_run_updated" && e.status === "completed");
    assert.ok(completed, "completed event emitted");
    assert.equal((completed as { message?: string }).message, "你好，世界");

    const log = new CopilotConversationLog(h.db, userId);
    const messages = log.listMessages(conversationId);
    assert.deepEqual(messages.map((m) => `${m.role}:${m.kind}`), ["user:text", "assistant:text"]);
    assert.equal(messages[1]?.content, "你好，世界");
    const run = log.getRun(runId);
    assert.equal(run?.status, "completed");
    assert.equal(log.getConversation(conversationId)?.dsh_session_id?.startsWith("dsh-"), true);
  });

  it("spawns the runtime with operate tools behind the approval bridge, LLM env and no gateway secrets", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "simple" });
    const { token } = await registerAndSeed(h, "dsh-env@test.com");
    const conversationId = await createConversation(h, token);

    // Act
    await sendMessage(h, token, conversationId, "hi");

    // Assert
    const boot = readFakeLog(h.logPath).find((r) => r.kind === "boot");
    const env = boot?.env as Record<string, unknown>;
    assert.equal(env.operate, "1", "operate tools are registered but approval-gated (M3)");
    assert.equal(env.hasLlmKey, true);
    assert.equal(env.llmApi, "anthropic-messages");
    assert.equal(env.llmBaseUrl, "https://stub.example");
    assert.equal(env.llmModel, "stub-model");
    assert.equal(env.hasBridgeToken, true);
    assert.equal(env.hasMasterKey, false, "OPENFORGE_MASTER_KEY must not leak into the child env");
    assert.equal(env.hasJwtSecret, false, "OPENFORGE_JWT_SECRET must not leak into the child env");
  });

  it("resumes the same dsh session across messages within one runtime", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "simple" });
    const { token } = await registerAndSeed(h, "dsh-resume@test.com");
    const conversationId = await createConversation(h, token);

    // Act
    await sendMessage(h, token, conversationId, "第一句");
    await sendMessage(h, token, conversationId, "第二句");

    // Assert: one boot, two prompts on the SAME dsh session id.
    const records = readFakeLog(h.logPath);
    assert.equal(records.filter((r) => r.kind === "boot").length, 1);
    const prompts = records.filter((r) => r.kind === "prompt");
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0]?.sessionId, prompts[1]?.sessionId);
  });

  it("projects tool call and tool result rows with pairing events", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "tool" });
    const { token, userId } = await registerAndSeed(h, "dsh-tool@test.com");
    const conversationId = await createConversation(h, token);

    // Act
    await sendMessage(h, token, conversationId, "列出任务");

    // Assert
    const log = new CopilotConversationLog(h.db, userId);
    const messages = log.listMessages(conversationId);
    assert.deepEqual(
      messages.map((m) => `${m.role}:${m.kind}`),
      ["user:text", "assistant:tool_call", "tool:tool_result", "assistant:text"]
    );
    assert.equal(messages[1]?.toolName, "list_work_items");
    assert.equal(messages[1]?.toolCallId, "call-1");
    assert.equal(messages[2]?.toolCallId, "call-1");
    assert.equal(messages[2]?.content, "[]");
    const toolEvents = h.events.filter((e) => e.type === "copilot_run_updated" && (e as { toolName?: string }).toolName);
    assert.deepEqual(toolEvents.map((e) => (e as { message?: string }).message), ["running", "ok"]);
  });

  it("applies the dsh session title like the orchestrator auto-title", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "title" });
    const { token, userId } = await registerAndSeed(h, "dsh-title@test.com");
    const conversationId = await createConversation(h, token);

    // Act
    await sendMessage(h, token, conversationId, "起个标题");

    // Assert
    const log = new CopilotConversationLog(h.db, userId);
    assert.equal(log.getConversation(conversationId)?.title, "假运行时标题");
    const titleEvent = h.events.find((e) => e.type === "copilot_run_updated" && (e as { titleUpdated?: string }).titleUpdated);
    assert.equal((titleEvent as { titleUpdated?: string } | undefined)?.titleUpdated, "假运行时标题");
  });

  it("fails the run when the turn ends with an error", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "error" });
    const { token, userId } = await registerAndSeed(h, "dsh-error@test.com");
    const conversationId = await createConversation(h, token);

    // Act
    const { status } = await sendMessage(h, token, conversationId, "会失败");

    // Assert: same blocking semantics as the orchestrator — HTTP 400 + failed run.
    assert.equal(status, 400);
    const log = new CopilotConversationLog(h.db, userId);
    const runs = log.listRuns(conversationId);
    assert.equal(runs[0]?.status, "failed");
    const failed = h.events.find((e) => e.type === "copilot_run_updated" && e.status === "failed");
    assert.ok(failed, "failed event emitted");
  });

  it("reaps the idle runtime and transparently resumes on the next message", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "simple", idleMs: 150 });
    const { token } = await registerAndSeed(h, "dsh-idle@test.com");
    const conversationId = await createConversation(h, token);

    // Act: first message, wait past the idle window, then a second message.
    const first = await sendMessage(h, token, conversationId, "第一句");
    assert.equal(first.status, 201);
    await sleep(500);
    const second = await sendMessage(h, token, conversationId, "第二句");

    // Assert: two boots (reaped + respawned), both prompts on the same dsh session.
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const records = readFakeLog(h.logPath);
    assert.equal(records.filter((r) => r.kind === "boot").length, 2);
    const prompts = records.filter((r) => r.kind === "prompt");
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0]?.sessionId, prompts[1]?.sessionId, "resume reuses the persisted dsh session");
    assert.notEqual(prompts[0]?.pid, prompts[1]?.pid, "the second prompt ran in a fresh process");
  });

  it("marks the run failed on runtime crash and recovers on the next message", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "crash-once" });
    const { token, userId } = await registerAndSeed(h, "dsh-crash@test.com");
    const conversationId = await createConversation(h, token);

    // Act: first prompt crashes the runtime mid-turn; second respawns and completes.
    const crashed = await sendMessage(h, token, conversationId, "崩一次");
    const recovered = await sendMessage(h, token, conversationId, "再来");

    // Assert
    assert.equal(crashed.status, 400);
    assert.equal(recovered.status, 201, JSON.stringify(recovered.body));
    const log = new CopilotConversationLog(h.db, userId);
    const runs = log.listRuns(conversationId);
    assert.deepEqual(runs.map((r) => r.status).sort(), ["completed", "failed"]);
    const records = readFakeLog(h.logPath);
    assert.equal(records.filter((r) => r.kind === "boot").length, 2);
  });

  it("cancel kills the runtime process and settles the blocked POST", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "hang" });
    const { token, userId } = await registerAndSeed(h, "dsh-cancel@test.com");
    const conversationId = await createConversation(h, token);

    // Act: the POST blocks on the hanging turn; cancel from a second request.
    const pending = sendMessage(h, token, conversationId, "卡住");
    await waitFor(() => h.events.some((e) => e.type === "copilot_run_updated" && (e as { textDelta?: string }).textDelta === "working..."));
    const runId = (h.events.find((e) => e.type === "copilot_run_updated") as { runId: string }).runId;
    const cancelRes = await fetch(`${h.baseUrl}/api/v1/copilot/runs/${runId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const cancelBody = (await cancelRes.json()) as { data: { cancelled: boolean } };
    const settled = await pending;

    // Assert
    assert.equal(cancelBody.data.cancelled, true);
    assert.equal(settled.status, 201, "the blocked POST settles like the orchestrator path");
    const log = new CopilotConversationLog(h.db, userId);
    assert.equal(log.getRun(runId)?.status, "cancelled");
  });

  it("rejects a concurrent message with 409 while a run is active", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "hang" });
    const { token } = await registerAndSeed(h, "dsh-busy@test.com");
    const conversationId = await createConversation(h, token);

    // Act
    const pending = sendMessage(h, token, conversationId, "第一句");
    await waitFor(() => h.events.some((e) => e.type === "copilot_run_updated"));
    const busy = await sendMessage(h, token, conversationId, "插队");

    // Assert
    assert.equal(busy.status, 409, JSON.stringify(busy.body));
    assert.equal(((busy.body as { details?: { code?: string } }).details)?.code, "COPILOT_RUN_BUSY");

    // Cleanup: cancel the hanging run.
    const runId = (h.events.find((e) => e.type === "copilot_run_updated") as { runId: string }).runId;
    await fetch(`${h.baseUrl}/api/v1/copilot/runs/${runId}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    await pending;
  });

  it("keeps GET /runs/:id reading the same projection", async () => {
    // Arrange
    const h = await bootDshGateway({ scenario: "simple" });
    const { token } = await registerAndSeed(h, "dsh-getrun@test.com");
    const conversationId = await createConversation(h, token);
    const { body } = await sendMessage(h, token, conversationId, "hi");
    const runId = (body.data as { runId: string }).runId;

    // Act
    const res = await fetch(`${h.baseUrl}/api/v1/copilot/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const runBody = (await res.json()) as { data: { run: { status: string }; pendingActions: unknown[] } };

    // Assert
    assert.equal(res.status, 200);
    assert.equal(runBody.data.run.status, "completed");
    assert.deepEqual(runBody.data.pendingActions, []);
  });
});

describe("copilot flag-off path (regression)", () => {
  it("runs the in-process orchestrator and never binds a dsh session", async () => {
    // Arrange: no dshCopilot option — the M1 stack verbatim.
    const db = createTestDb();
    const stubFetch: typeof fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "stubbed answer", tool_calls: [] } }] })
    }) as Response;
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager(mockTmuxClient as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      llmFetch: stubFetch
    });
    let baseUrl = "";
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => {
        const address = app.server.address();
        if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    cleanups.push(() => app.close());

    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "flag-off@test.com", password: "password123" })
    });
    const { data: auth } = (await res.json()) as { data: { token: string } };
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get("flag-off@test.com") as { id: string };
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const provider = repo.createProviderProfile({
      name: "Stub", providerKey: "stub", baseUrl: "https://stub.example",
      authType: "api_key", apiFormat: "openai", supportedAdapters: ["opencode"]
    });
    repo.createModelProfile({ providerProfileId: provider.id, name: "Stub model", modelId: "stub-model", capabilities: ["chat"], isDefault: true });
    repo.createCredential({ providerProfileId: provider.id, label: "key", plaintextSecret: "secret" });
    const convRes = await fetch(`${baseUrl}/api/v1/copilot/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({})
    });
    const conversationId = ((await convRes.json()) as { data: { conversation: { id: string } } }).data.conversation.id;

    // Act
    const send = await fetch(`${baseUrl}/api/v1/copilot/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ content: "hello" })
    });

    // Assert
    assert.equal(send.status, 201);
    const log = new CopilotConversationLog(db, user.id);
    assert.equal(log.getConversation(conversationId)?.dsh_session_id, null, "no dsh binding on the flag-off path");
    assert.equal(log.listMessages(conversationId).at(-1)?.content, "stubbed answer");
  });
});
