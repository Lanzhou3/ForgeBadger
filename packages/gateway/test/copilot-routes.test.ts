import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { ActivityRepository } from "../src/db/repositories/activity-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { AgentRepository } from "../src/db/repositories/agent-repository.js";
import { PluginRepository } from "../src/db/repositories/plugin-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { SkillRepository } from "../src/db/repositories/skill-repository.js";
import { ProjectSkillRepository } from "../src/db/repositories/project-skill-repository.js";
import { TemplateRepository } from "../src/db/repositories/template-repository.js";
import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { CopilotMemoryRepository } from "../src/db/repositories/copilot-memory-repository.js";
import { createCopilotRoutes } from "../src/routes/copilot.js";
import type { CommandRunner } from "../src/lib/dependency-check.js";
import { OpenForgeEventBus, type OpenForgeEvent } from "../src/services/event-bus.js";
import type {
  CopilotModelClient,
  CopilotModelEvent,
  CopilotModelRequest,
  CopilotModelRequestOptions
} from "../src/services/copilot/types.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("copilot routes", () => {
  let app: express.Express;
  let db: Database.Database;
  let token: string;
  let otherToken: string;
  let userId: string;
  let otherUserId: string;
  let modelEvents: CopilotModelEvent[];
  let modelEventResponses: Array<CopilotModelEvent[] | Error>;
  let modelTextDeltas: string[][];
  let modelResponseWait: Promise<void> | null;
  let modelRequestSignals: Array<AbortSignal | undefined>;
  let adapterCommands: string[];
  let sentSessionInputs: Array<{ sessionId: string; data: string }>;
  let createdSessionInputs: Array<{ userId: string; sessionId: string; cwd: string; command: string }>;
  let capturedSessionIds: string[];
  let runtimeSessionSnapshots: Array<{ id: string; status: string; tmuxName: string }> | null;
  let stoppedSessionInputs: Array<{ sessionId: string; tmuxName?: string; userId?: string }>;
  let providerModelFetchInputs: Array<{ baseUrl: string; apiKey?: string; modelsUrl?: string; timeoutMs?: number }>;
  let adapterCommandRunner: CommandRunner;
  let emittedEvents: OpenForgeEvent[];
  let eventBus: OpenForgeEventBus;
  const calls: CopilotModelRequest[] = [];

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("copilot-routes@example.com", "hash");
    const otherUser = new UserRepository(db).create("other-copilot-routes@example.com", "hash");
    userId = user.id;
    otherUserId = otherUser.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
    otherToken = signJwt({ userId: otherUser.id, email: otherUser.email }, secret);
    calls.length = 0;
    modelRequestSignals = [];
    modelEvents = [{ type: "assistant_message", text: "Gateway is healthy." }];
    modelEventResponses = [];
    modelTextDeltas = [];
    modelResponseWait = null;
    adapterCommands = [];
    sentSessionInputs = [];
    createdSessionInputs = [];
    capturedSessionIds = [];
    runtimeSessionSnapshots = null;
    stoppedSessionInputs = [];
    providerModelFetchInputs = [];
    emittedEvents = [];
    eventBus = new OpenForgeEventBus();
    eventBus.on("event", (event) => emittedEvents.push(event));
    adapterCommandRunner = async (command) => {
      adapterCommands.push(command);
      if (command === "tmux") return { exitCode: 0, stdout: "tmux 3.5", stderr: "" };
      if (command === "claude") return { exitCode: 0, stdout: "Claude Code 1.0.0", stderr: "" };
      if (command === "opencode") return { exitCode: 0, stdout: "OpenCode 0.8.0", stderr: "" };
      if (command === "codex") return { exitCode: 0, stdout: "Codex CLI 1.2.3", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: `${command} missing` };
    };
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      modelClientFactory: () => fakeModelClient(calls, async (_request, options) => {
        modelRequestSignals.push(options?.signal);
        if (modelResponseWait) await modelResponseWait;
        const response = modelEventResponses.shift();
        for (const delta of modelTextDeltas.shift() ?? []) {
          options?.onTextDelta?.(delta);
        }
        if (response instanceof Error) throw response;
        return response ?? modelEvents;
      }),
      sessionManager: {
        async createSession(input: {
          userId: string;
          sessionId: string;
          attachToken?: string;
          launchPlan: { cwd: string; command: string };
        }) {
          createdSessionInputs.push({
            userId: input.userId,
            sessionId: input.sessionId,
            cwd: input.launchPlan.cwd,
            command: input.launchPlan.command
          });
          const now = new Date().toISOString();
          return {
            id: input.sessionId,
            userId: input.userId,
            attachToken: input.attachToken ?? "copilot-attach-token",
            tmuxName: `of-${input.userId.slice(0, 8)}-${input.sessionId}`,
            launchPlan: input.launchPlan,
            status: "running",
            createdAt: now,
            updatedAt: now
          };
        },
        async sendInput(sessionId: string, data: string) {
          sentSessionInputs.push({ sessionId, data });
        },
        async captureHistory(sessionId: string) {
          capturedSessionIds.push(sessionId);
          return "Claude Code output:\nCurrent task is complete.\n";
        },
        listSessions() {
          if (!runtimeSessionSnapshots) {
            throw new Error("Runtime session snapshots are unavailable in this test");
          }
          return runtimeSessionSnapshots;
        },
        async stopSession(sessionId: string, tmuxName?: string, stoppedUserId?: string) {
          stoppedSessionInputs.push({ sessionId, tmuxName, userId: stoppedUserId });
          const now = new Date().toISOString();
          return {
            id: sessionId,
            userId: stoppedUserId ?? userId,
            attachToken: "",
            tmuxName: tmuxName ?? "",
            launchPlan: { cwd: "/tmp/openforge", command: "claude", args: [], env: {} },
            status: "exited",
            createdAt: now,
            updatedAt: now
          };
        }
      } as never,
      eventBus,
      fetchProviderModels: async (input) => {
        providerModelFetchInputs.push({
          baseUrl: input.baseUrl,
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.modelsUrl ? { modelsUrl: input.modelsUrl } : {}),
          ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {})
        });
        return [
          { id: "MiniMax-M2" },
          { id: "MiniMax-Text-01" }
        ];
      },
      loadProviderCatalog: async () => [
        {
          id: "minimax-cn",
          name: "MiniMax China",
          description: "MiniMax China endpoint",
          baseUrl: "https://api.minimax.chat/v1",
          authType: "api_key",
          apiFormat: "openai-compatible",
          supportedAdapters: ["claude", "opencode"],
          modelSource: "dynamic",
          modelFetch: { modelsUrl: "https://api.minimax.chat/v1/models" },
          source: "cc-switch"
        }
      ],
      adapterCommandRunner
    }));
  });

  it("returns Copilot capabilities with read tools enabled", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/copilot/capabilities", undefined, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.deepEqual(res.body.data.supportedProviderFormats, ["openai", "openai-compatible", "anthropic"]);
    assert.equal(res.body.data.toolExecutionEnabled, true);
    assert.equal(res.body.data.providerConfigured, false);
    assert.equal(res.body.data.approvalRequiredForWrites, true);
    assert.ok(res.body.data.readTools.includes("openforge.get_dashboard_summary"));
    assert.ok(res.body.data.readTools.includes("openforge.get_project_detail"));
    assert.ok(res.body.data.readTools.includes("openforge.get_session_detail"));
    assert.ok(res.body.data.readTools.includes("openforge.get_session_terminal_snapshot"));
    assert.ok(res.body.data.readTools.includes("openforge.get_model_provider_summary"));
    assert.ok(res.body.data.readTools.includes("openforge.get_diagnostics_summary"));
    assert.equal(res.body.data.readTools.includes("openforge.propose_session_create"), false);
    assert.ok(res.body.data.prepareTools.includes("openforge.propose_project_create"));
    assert.ok(res.body.data.prepareTools.includes("openforge.propose_session_create"));
    assert.ok(res.body.data.prepareTools.includes("openforge.propose_session_input"));
    assert.ok(res.body.data.prepareTools.includes("openforge.propose_model_provider_apply"));
    assert.ok(res.body.data.prepareTools.includes("openforge.propose_memory_write"));
    assert.ok(res.body.data.prepareTools.includes("openforge.propose_memory_delete"));
    assert.equal(res.body.data.prepareTools.includes("openforge.get_dashboard_summary"), false);
  });

  it("reports Copilot provider readiness when a compatible provider is configured", async () => {
    createOpenAiProvider();

    const res = await makeRequest(app, "GET", "/api/v1/copilot/capabilities", undefined, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.providerConfigured, true);
  });

  it("lists and searches tenant-scoped Copilot memory through management routes", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge-memory-routes",
      aiTool: "claude"
    });
    const otherProject = new ProjectRepository(db, otherUserId).create({
      name: "Other OpenForge",
      path: "/tmp/other-openforge-memory-routes",
      aiTool: "claude"
    });
    const memory = new CopilotMemoryRepository(db, userId);
    const entry = memory.createEntry({
      kind: "decision",
      scope: "project",
      projectId: project.id,
      text: "Provider catalog should stay aligned with cc-switch compatible providers."
    });
    const note = memory.createNote({
      projectId: project.id,
      text: "Working note: Copilot should show tool activity inline."
    });
    new CopilotMemoryRepository(db, otherUserId).createEntry({
      kind: "decision",
      scope: "project",
      projectId: otherProject.id,
      text: "Foreign provider catalog memory must stay isolated."
    });

    const entries = await makeRequest(
      app,
      "GET",
      `/api/v1/copilot/memory/entries?scope=project&projectId=${encodeURIComponent(project.id)}`,
      undefined,
      authHeaders()
    );
    const notes = await makeRequest(
      app,
      "GET",
      `/api/v1/copilot/memory/notes?projectId=${encodeURIComponent(project.id)}`,
      undefined,
      authHeaders()
    );
    const search = await makeRequest(
      app,
      "GET",
      "/api/v1/copilot/memory/search?query=provider%20catalog&includeNotes=true",
      undefined,
      authHeaders()
    );

    assert.equal(entries.status, 200);
    assert.deepEqual(entries.body.data.entries.map((item: { id: string }) => item.id), [entry.id]);
    assert.equal(notes.status, 200);
    assert.deepEqual(notes.body.data.notes.map((item: { id: string }) => item.id), [note.id]);
    assert.equal(search.status, 200);
    assert.deepEqual(search.body.data.results.map((item: { id: string }) => item.id), [entry.id]);
  });

  it("gets and deletes Copilot memory items without crossing tenants", async () => {
    const memory = new CopilotMemoryRepository(db, userId);
    const entry = memory.createEntry({
      kind: "preference",
      scope: "global",
      text: "Copilot should keep terminal tool evidence attached to assistant messages."
    });

    const read = await makeRequest(app, "GET", `/api/v1/copilot/memory/entry/${entry.id}`, undefined, authHeaders());
    const otherRead = await makeRequest(app, "GET", `/api/v1/copilot/memory/entry/${entry.id}`, undefined, otherAuthHeaders());
    const otherDelete = await makeRequest(app, "DELETE", `/api/v1/copilot/memory/entry/${entry.id}`, undefined, otherAuthHeaders());
    const deleted = await makeRequest(app, "DELETE", `/api/v1/copilot/memory/entry/${entry.id}`, undefined, authHeaders());
    const searchAfterDelete = await makeRequest(
      app,
      "GET",
      "/api/v1/copilot/memory/search?query=terminal%20tool&includeNotes=true",
      undefined,
      authHeaders()
    );

    assert.equal(read.status, 200);
    assert.equal(read.body.data.item.id, entry.id);
    assert.equal(read.body.data.item.type, "entry");
    assert.equal(otherRead.status, 404);
    assert.equal(otherDelete.status, 404);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.item.id, entry.id);
    assert.deepEqual(searchAfterDelete.body.data.results, []);
  });

  it("reports Copilot provider readiness when a later compatible provider has credentials", async () => {
    createOpenAiProvider(userId, { isDefault: true, withCredential: false });
    createOpenAiProvider(userId, { providerKey: "anthropic", isDefault: false, withCredential: true });

    const res = await makeRequest(app, "GET", "/api/v1/copilot/capabilities", undefined, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.providerConfigured, true);
  });

  it("does not report Copilot provider readiness for disabled providers", async () => {
    const providerId = createOpenAiProvider();
    disableProvider(providerId);

    const res = await makeRequest(app, "GET", "/api/v1/copilot/capabilities", undefined, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.providerConfigured, false);
  });

  it("rejects unauthenticated run creation", async () => {
    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", { prompt: "Status?" });

    assert.equal(res.status, 401);
    assert.equal(res.body.code, 1);
  });

  it("rejects empty prompts", async () => {
    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", { prompt: "" }, authHeaders());

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
  });

  it("rejects oversized Copilot source references", async () => {
    createOpenAiProvider();
    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Status?",
      source: "session",
      sourceRefId: "s".repeat(257)
    }, authHeaders());

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(calls.length, 0);
  });

  it("returns provider-not-configured when no compatible provider exists", async () => {
    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", { prompt: "Status?" }, authHeaders());

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_provider_not_configured");
    assert.equal(res.body.details.run.status, "failed");
    assert.equal(res.body.details.run.errorCode, "copilot_provider_not_configured");
    assert.equal(res.body.details.events.length, 1);
    assert.equal(res.body.details.events[0].type, "run_failed");
    assert.equal(res.body.details.events[0].payload.code, "copilot_provider_not_configured");
    assert.equal(calls.length, 0);
  });

  it("creates a completed text run with assistant events", async () => {
    createOpenAiProvider();

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize Gateway health",
      source: "dashboard"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.message, "");
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(res.body.data.run.stepCount, 1);
    assert.equal(res.body.data.run.providerProfileName, "OpenAI");
    assert.equal(res.body.data.run.modelProfileName, "GPT");
    assert.equal(res.body.data.events[0].type, "assistant_message");
    assert.equal(res.body.data.events[0].message, "Gateway is healthy.");
    assert.equal(calls[0]?.input, "Summarize Gateway health");
    assert.deepEqual(emittedEvents.map((event) => event.type), [
      "copilot_run_updated",
      "copilot_run_updated"
    ]);
    assert.deepEqual(
      emittedEvents.map((event) =>
        event.type === "copilot_run_updated" ? {
          status: event.status,
          eventType: event.eventType,
          runId: event.runId,
          source: event.source
        } : null
      ),
      [
        {
          status: "running",
          eventType: "started",
          runId: res.body.data.run.id,
          source: "dashboard"
        },
        {
          status: "completed",
          eventType: "completed",
          runId: res.body.data.run.id,
          source: "dashboard"
        }
      ]
    );
  });

  it("runs through a local OpenAI-compatible provider over HTTP before answering", async () => {
    const providerRequests: Array<{
      url: string | undefined;
      authorization: string | undefined;
      body: unknown;
    }> = [];
    const providerServer = http.createServer(async (req, res) => {
      providerRequests.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: await readRequestJson(req)
      });
      res.setHeader("Content-Type", "application/json");
      if (req.url !== "/chat/completions") {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      if (providerRequests.length === 1) {
        res.end(JSON.stringify({
          choices: [{
            message: {
              tool_calls: [
                {
                  id: "call-projects",
                  type: "function",
                  function: {
                    name: "openforge__dot__list_projects",
                    arguments: "{}"
                  }
                },
                {
                  id: "call-sessions",
                  type: "function",
                  function: {
                    name: "openforge__dot__list_sessions",
                    arguments: "{\"limit\":10}"
                  }
                }
              ]
            }
          }]
        }));
        return;
      }
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: "aether-glass has no running sessions."
          }
        }]
      }));
    });
    const providerBaseUrl = await listen(providerServer);
    try {
      const providerRepo = new ModelProviderRepository(db, userId, masterKey);
      const provider = providerRepo.createProviderProfile({
        providerKey: "local-openai-compatible",
        name: "Local OpenAI-compatible provider",
        baseUrl: providerBaseUrl,
        openaiBaseUrl: providerBaseUrl,
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["claude", "opencode"]
      });
      providerRepo.createModelProfile({
        providerProfileId: provider.id,
        name: "Local Chat",
        modelId: "local-chat",
        isDefault: true
      });
      providerRepo.createCredential({
        providerProfileId: provider.id,
        plaintextSecret: "sk-local-provider"
      });
      new ProjectRepository(db, userId).create({
        name: "aether-glass",
        path: "/tmp/aether-glass",
        aiTool: "claude"
      });
      const realProviderApp = express();
      realProviderApp.locals.jwtSecret = secret;
      realProviderApp.use(express.json());
      realProviderApp.use("/api/v1/copilot", createCopilotRoutes({
        db,
        masterKey,
        eventBus
      }));

      const res = await makeRequest(realProviderApp, "POST", "/api/v1/copilot/runs", {
        prompt: "看下 aether-glass 是否有正在运行的会话",
        source: "copilot"
      }, authHeaders());

      assert.equal(res.status, 201);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.run.status, "completed");
      assert.equal(providerRequests.length, 2);
      assert.equal(providerRequests[0]?.url, "/chat/completions");
      assert.equal(providerRequests[0]?.authorization, "Bearer sk-local-provider");
      const firstBody = providerRequests[0]?.body as { tools?: Array<{ function?: { name?: string } }> };
      assert.ok(firstBody.tools?.some((tool) => tool.function?.name === "openforge__dot__list_projects"));
      assert.ok(firstBody.tools?.some((tool) => tool.function?.name === "openforge__dot__list_sessions"));
      assert.deepEqual(
        res.body.data.events.map((event: { type: string; message?: string }) => [event.type, event.message]),
        [
          ["tool_call_requested", "openforge.list_projects"],
          ["tool_call_requested", "openforge.list_sessions"],
          ["tool_result", "openforge.list_projects"],
          ["tool_result", "openforge.list_sessions"],
          ["assistant_message", "aether-glass 没有正在运行的会话。项目状态 active 只表示项目记录可用，不是会话运行状态。"]
        ]
      );
      assert.match(JSON.stringify(providerRequests[1]?.body), /no_running_sessions/);
    } finally {
      await new Promise<void>((resolve) => providerServer.close(() => resolve()));
    }
  });

  it("creates, lists, renames, and deletes Copilot conversations", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/copilot/conversations", {
      title: "Model setup",
      source: "models",
      sourceRefId: "providers"
    }, authHeaders());

    const conversationId = created.body.data.conversation.id as string;
    const renamed = await makeRequest(app, "PATCH", `/api/v1/copilot/conversations/${conversationId}`, {
      title: "MiniMax setup"
    }, authHeaders());
    const listed = await makeRequest(app, "GET", "/api/v1/copilot/conversations", undefined, authHeaders());
    const otherUserRead = await makeRequest(app, "GET", `/api/v1/copilot/conversations/${conversationId}/messages`, undefined, otherAuthHeaders());
    const deleted = await makeRequest(app, "DELETE", `/api/v1/copilot/conversations/${conversationId}`, undefined, authHeaders());
    const listedAfterDelete = await makeRequest(app, "GET", "/api/v1/copilot/conversations", undefined, authHeaders());

    assert.equal(created.status, 201);
    assert.equal(created.body.code, 0);
    assert.equal(created.body.data.conversation.title, "Model setup");
    assert.equal(created.body.data.conversation.source, "models");
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.conversation.title, "MiniMax setup");
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.data.conversations.map((item: { id: string }) => item.id), [conversationId]);
    assert.equal(otherUserRead.status, 404);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.conversation.status, "deleted");
    assert.deepEqual(listedAfterDelete.body.data.conversations, []);
  });

  it("sends conversation messages through Copilot and supports deleting one message", async () => {
    createOpenAiProvider();
    const created = await makeRequest(app, "POST", "/api/v1/copilot/conversations", {
      title: "Terminal help",
      source: "session",
      sourceRefId: "session-1"
    }, authHeaders());
    const conversationId = created.body.data.conversation.id as string;

    const sent = await makeRequest(app, "POST", `/api/v1/copilot/conversations/${conversationId}/messages`, {
      prompt: "解释这个错误",
      source: "session",
      sourceRefId: "session-1"
    }, authHeaders());
    const messages = await makeRequest(app, "GET", `/api/v1/copilot/conversations/${conversationId}/messages`, undefined, authHeaders());
    const userMessageId = sent.body.data.messages[0].id as string;
    const deletedMessage = await makeRequest(app, "DELETE", `/api/v1/copilot/messages/${userMessageId}`, undefined, authHeaders());
    const messagesAfterDelete = await makeRequest(app, "GET", `/api/v1/copilot/conversations/${conversationId}/messages`, undefined, authHeaders());

    assert.equal(sent.status, 201);
    assert.equal(sent.body.code, 0);
    assert.equal(sent.body.data.run.status, "completed");
    assert.deepEqual(sent.body.data.messages.map((message: { role: string; content: string }) => ({
      role: message.role,
      content: message.content
    })), [
      { role: "user", content: "解释这个错误" },
      { role: "assistant", content: "Gateway is healthy." }
    ]);
    assert.match(calls[0]?.input ?? "", /User request:\n解释这个错误/);
    assert.equal(messages.status, 200);
    assert.equal(messages.body.data.messages.length, 2);
    assert.equal(deletedMessage.status, 200);
    assert.equal(deletedMessage.body.data.message.deletedAt !== null, true);
    assert.deepEqual(messagesAfterDelete.body.data.messages.map((message: { role: string }) => message.role), ["assistant"]);
  });

  it("does not let conversation replies confuse active projects with running sessions", async () => {
    createOpenAiProvider();
    new ProjectRepository(db, userId).create({
      name: "aether-glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-projects",
        name: "openforge.list_projects",
        input: {}
      }],
      [{ type: "assistant_message", text: "aether-glass 项目状态为 active，说明存在活跃会话。" }],
      [{ type: "assistant_message", text: "aether-glass 没有正在运行的会话。" }]
    ];
    const created = await makeRequest(app, "POST", "/api/v1/copilot/conversations", {
      title: "Session check",
      source: "copilot"
    }, authHeaders());
    const conversationId = created.body.data.conversation.id as string;

    const sent = await makeRequest(app, "POST", `/api/v1/copilot/conversations/${conversationId}/messages`, {
      prompt: "看下aether-glass是否有正在运行的会话",
      source: "copilot"
    }, authHeaders());

    assert.equal(sent.status, 201);
    assert.equal(sent.body.code, 0);
    assert.equal(sent.body.data.run.status, "completed");
    assert.deepEqual(sent.body.data.events.map((event: { type: string }) => event.type), [
      "tool_call_requested",
      "tool_result",
      "tool_call_requested",
      "tool_result",
      "assistant_message"
    ]);
    assert.equal(sent.body.data.events[2]?.message, "openforge.list_sessions");
    assert.doesNotMatch(JSON.stringify(sent.body), /说明存在活跃会话/);
    assert.match(sent.body.data.messages.at(-1)?.content ?? "", /aether-glass 没有正在运行的会话/);
    assert.match(sent.body.data.messages.at(-1)?.content ?? "", /项目状态 active 只表示项目记录可用/);
  });

  it("persists tool activity on assistant conversation messages", async () => {
    createOpenAiProvider();
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-projects",
        name: "openforge.list_projects",
        input: {}
      }],
      [{ type: "assistant_message", text: "No running sessions." }]
    ];
    const created = await makeRequest(app, "POST", "/api/v1/copilot/conversations", {
      title: "Session check",
      source: "copilot"
    }, authHeaders());
    const conversationId = created.body.data.conversation.id as string;

    const sent = await makeRequest(app, "POST", `/api/v1/copilot/conversations/${conversationId}/messages`, {
      prompt: "当前是否有项目",
      source: "copilot"
    }, authHeaders());
    const listed = await makeRequest(app, "GET", `/api/v1/copilot/conversations/${conversationId}/messages`, undefined, authHeaders());

    const assistant = sent.body.data.messages.find((message: { role: string }) => message.role === "assistant") as {
      payload?: { runActivity?: { events?: Array<{ type: string; message?: string }> } };
    };
    const listedAssistant = listed.body.data.messages.find((message: { role: string }) => message.role === "assistant") as {
      payload?: { runActivity?: { events?: Array<{ type: string; message?: string }> } };
    };
    assert.deepEqual(assistant.payload?.runActivity?.events?.map((event) => event.type), [
      "tool_call_requested",
      "tool_result"
    ]);
    assert.equal(assistant.payload?.runActivity?.events?.[0]?.message, "openforge.list_projects");
    assert.deepEqual(listedAssistant.payload?.runActivity?.events?.map((event) => event.type), [
      "tool_call_requested",
      "tool_result"
    ]);
  });

  it("persists trailing tool activity on the prior assistant bubble when approval is pending", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "aether-glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    modelEventResponses = [[
      {
        type: "assistant_message",
        text: "I will create a Claude Code session after checking the target project."
      },
      {
        type: "tool_call_requested",
        id: "tool-call-session-create",
        name: "openforge.propose_session_create",
        input: {
          projectId: project.id,
          aiTool: "claude",
          name: "Claude Code"
        }
      }
    ]];
    const created = await makeRequest(app, "POST", "/api/v1/copilot/conversations", {
      title: "Create session",
      source: "copilot"
    }, authHeaders());
    const conversationId = created.body.data.conversation.id as string;

    const sent = await makeRequest(app, "POST", `/api/v1/copilot/conversations/${conversationId}/messages`, {
      prompt: "帮我创建一个 claude code 会话",
      source: "copilot"
    }, authHeaders());
    const listed = await makeRequest(app, "GET", `/api/v1/copilot/conversations/${conversationId}/messages`, undefined, authHeaders());

    const assistant = sent.body.data.messages.find((message: { role: string }) => message.role === "assistant") as {
      payload?: {
        runActivity?: {
          events?: Array<{ type: string; message?: string }>;
          pendingActions?: Array<{ type: string; status: string }>;
        };
      };
    };
    const listedAssistant = listed.body.data.messages.find((message: { role: string }) => message.role === "assistant") as {
      payload?: {
        runActivity?: {
          events?: Array<{ type: string; message?: string }>;
          pendingActions?: Array<{ type: string; status: string }>;
        };
      };
    };
    assert.equal(sent.status, 201);
    assert.equal(sent.body.data.run.status, "waiting_for_approval");
    assert.deepEqual(assistant.payload?.runActivity?.events?.map((event) => event.type), [
      "tool_call_requested",
      "tool_result"
    ]);
    assert.equal(assistant.payload?.runActivity?.events?.[0]?.message, "openforge.propose_session_create");
    assert.deepEqual(assistant.payload?.runActivity?.pendingActions?.map((action) => action.type), [
      "openforge.propose_session_create"
    ]);
    assert.deepEqual(listedAssistant.payload?.runActivity?.events?.map((event) => event.type), [
      "tool_call_requested",
      "tool_result"
    ]);
  });

  it("starts async conversation runs and stores the assistant reply after completion", async () => {
    createOpenAiProvider();
    const gate = deferred<void>();
    modelResponseWait = gate.promise;
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-projects",
        name: "openforge.list_projects",
        input: {}
      }],
      [{ type: "assistant_message", text: "Async answer after tools." }]
    ];
    modelTextDeltas = [[], ["Async ", "answer"]];
    const created = await makeRequest(app, "POST", "/api/v1/copilot/conversations", {
      title: "Async run",
      source: "copilot"
    }, authHeaders());
    const conversationId = created.body.data.conversation.id as string;

    const sent = await makeRequest(app, "POST", `/api/v1/copilot/conversations/${conversationId}/messages`, {
      prompt: "异步检查项目",
      source: "copilot",
      async: true
    }, authHeaders());

    assert.equal(sent.status, 202);
    assert.equal(sent.body.code, 0);
    assert.equal(sent.body.data.run.status, "running");
    assert.deepEqual(sent.body.data.messages.map((message: { role: string }) => message.role), ["user"]);
    assert.equal(new CopilotRepository(db, userId).listConversationMessages(conversationId).length, 1);

    gate.resolve();
    await waitFor(() =>
      new CopilotRepository(db, userId)
        .listConversationMessages(conversationId)
        .some((message) => message.role === "assistant" && message.content === "Async answer after tools.")
    );

    const repo = new CopilotRepository(db, userId);
    const run = repo.getRun(sent.body.data.run.id as string);
    const messages = repo.listConversationMessages(conversationId);
    assert.equal(run?.status, "completed");
    assert.deepEqual(
      emittedEvents
        .filter((event) => event.type === "copilot_run_updated")
        .map((event) => ({
          runId: event.runId,
          status: event.status,
          eventType: event.eventType,
          runEventType: event.runEventType,
          runEventSequence: event.runEventSequence,
          deltaText: event.deltaText,
          conversationId: event.conversationId
        })),
      [
        {
          runId: sent.body.data.run.id,
          status: "running",
          eventType: "started",
          runEventType: undefined,
          runEventSequence: undefined,
          deltaText: undefined,
          conversationId
        },
        {
          runId: sent.body.data.run.id,
          status: "running",
          eventType: "event_appended",
          runEventType: "tool_call_requested",
          runEventSequence: 1,
          deltaText: undefined,
          conversationId
        },
        {
          runId: sent.body.data.run.id,
          status: "running",
          eventType: "event_appended",
          runEventType: "tool_result",
          runEventSequence: 2,
          deltaText: undefined,
          conversationId
        },
        {
          runId: sent.body.data.run.id,
          status: "running",
          eventType: "assistant_delta",
          runEventType: undefined,
          runEventSequence: undefined,
          deltaText: "Async ",
          conversationId
        },
        {
          runId: sent.body.data.run.id,
          status: "running",
          eventType: "assistant_delta",
          runEventType: undefined,
          runEventSequence: undefined,
          deltaText: "answer",
          conversationId
        },
        {
          runId: sent.body.data.run.id,
          status: "running",
          eventType: "event_appended",
          runEventType: "assistant_message",
          runEventSequence: 3,
          deltaText: undefined,
          conversationId
        },
        {
          runId: sent.body.data.run.id,
          status: "completed",
          eventType: "completed",
          runEventType: undefined,
          runEventSequence: undefined,
          deltaText: undefined,
          conversationId
        }
      ]
    );
    assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
    assert.deepEqual(repo.listEvents(run?.id ?? "").map((event) => event.type), [
      "tool_call_requested",
      "tool_result",
      "assistant_message"
    ]);
  });

  it("strips model thinking blocks from stored conversation replies", async () => {
    createOpenAiProvider();
    modelEvents = [{
      type: "assistant_message",
      text: "<think>Internal chain of thought should not be shown.</think>\n\n可见回答"
    }];
    const created = await makeRequest(app, "POST", "/api/v1/copilot/conversations", {
      title: "Thinking cleanup",
      source: "copilot"
    }, authHeaders());
    const conversationId = created.body.data.conversation.id as string;

    const sent = await makeRequest(app, "POST", `/api/v1/copilot/conversations/${conversationId}/messages`, {
      prompt: "你好",
      source: "copilot"
    }, authHeaders());
    const listed = await makeRequest(app, "GET", `/api/v1/copilot/conversations/${conversationId}/messages`, undefined, authHeaders());

    assert.equal(sent.status, 201);
    assert.equal(sent.body.data.events[0].message, "可见回答");
    assert.deepEqual(sent.body.data.messages.map((message: { role: string; content: string }) => ({
      role: message.role,
      content: message.content
    })), [
      { role: "user", content: "你好" },
      { role: "assistant", content: "可见回答" }
    ]);
    assert.equal(listed.body.data.messages[1].content, "可见回答");
  });

  it("creates a default run with a later ready provider when the default provider lacks credentials", async () => {
    createOpenAiProvider(userId, { isDefault: true, withCredential: false });
    createOpenAiProvider(userId, { providerKey: "anthropic", isDefault: false, withCredential: true });

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize Gateway health",
      source: "dashboard"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(res.body.data.run.providerProfileName, "Anthropic");
    assert.equal(res.body.data.run.modelProfileName, "Claude");
    assert.equal(calls[0]?.model, "claude-sonnet-4-5");
  });

  it("writes audit logs for Copilot run start and completion", async () => {
    createOpenAiProvider();

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize Gateway health with token=secret-value",
      source: "dashboard",
      sourceRefId: "dashboard-root"
    }, authHeaders());

    const runId = res.body.data.run.id as string;
    const auditLogs = new AuditLogRepository(db, userId).list({
      resourceType: "copilot_run",
      resourceId: runId,
      limit: 10
    });
    const actions = auditLogs.map((log) => log.action).sort();
    const startDetails = JSON.parse(
      auditLogs.find((log) => log.action === "copilot.run.start")?.details ?? "{}"
    ) as {
      runId?: string;
      source?: string;
      sourceRefId?: string;
      status?: string;
      stepCount?: number;
      completedAt?: number | null;
    };
    const completionDetails = JSON.parse(
      auditLogs.find((log) => log.action === "copilot.run.complete")?.details ?? "{}"
    ) as { runId?: string; status?: string; stepCount?: number; providerProfileId?: string; modelProfileId?: string };

    assert.equal(res.status, 201);
    assert.deepEqual(actions, ["copilot.run.complete", "copilot.run.start"]);
    assert.equal(startDetails.runId, runId);
    assert.equal(startDetails.source, "dashboard");
    assert.equal(startDetails.sourceRefId, "dashboard-root");
    assert.equal(startDetails.status, "running");
    assert.equal(startDetails.stepCount, 0);
    assert.equal(startDetails.completedAt, null);
    assert.equal(completionDetails.runId, runId);
    assert.equal(completionDetails.status, "completed");
    assert.equal(completionDetails.stepCount, 1);
    assert.equal(typeof completionDetails.providerProfileId, "string");
    assert.equal(typeof completionDetails.modelProfileId, "string");
    assert.doesNotMatch(JSON.stringify(auditLogs), /secret-value/);
  });

  it("redacts secret-looking prompts before persistence and model requests", async () => {
    createOpenAiProvider();
    const privateKeyBlock = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSl",
      "-----END PRIVATE KEY-----"
    ].join("\n");

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: `Diagnose launch with token=secret-value and OPENFORGE_ATTACH_TOKEN=attach-secret\n${privateKeyBlock}`,
      source: "copilot"
    }, authHeaders());

    assert.equal(res.status, 201);
    const run = new CopilotRepository(db, userId).listRuns()[0];
    assert.match(run?.goal ?? "", /token=\[REDACTED\]/);
    assert.match(run?.goal ?? "", /OPENFORGE_ATTACH_TOKEN=\[REDACTED\]/);
    assert.match(run?.goal ?? "", /\[REDACTED PRIVATE KEY\]/);
    assert.doesNotMatch(run?.goal ?? "", /secret-value|attach-secret|BEGIN PRIVATE KEY|MIIEvwIBADAN|END PRIVATE KEY/);
    assert.doesNotMatch(String(calls[0]?.input ?? ""), /secret-value|attach-secret|BEGIN PRIVATE KEY|MIIEvwIBADAN|END PRIVATE KEY/);
    assert.match(String(calls[0]?.input ?? ""), /token=\[REDACTED\]/);
    assert.match(String(calls[0]?.input ?? ""), /\[REDACTED PRIVATE KEY\]/);
  });

  it("injects bounded project source context into model requests", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge Project",
      path: "/tmp/openforge-secret-path",
      description: "Local IDE control plane",
      techStack: "Next.js, Express",
      aiTool: "claude"
    });
    runtimeSessionSnapshots = [];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Assess project readiness",
      source: "project",
      sourceRefId: project.id
    }, authHeaders());

    const input = calls[0]?.input ?? "";
    assert.equal(res.status, 201);
    assert.match(calls[0]?.instructions ?? "", /Project status and session status are different/);
    assert.match(calls[0]?.instructions ?? "", /openforge\.list_sessions/);
    assert.match(calls[0]?.instructions ?? "", /inspect projects, sessions, agents, skills, templates, plugins/);
    assert.match(calls[0]?.instructions ?? "", /project create\/import\/delete\/config sync/);
    assert.match(calls[0]?.instructions ?? "", /session create\/start\/stop\/delete\/input/);
    assert.match(calls[0]?.instructions ?? "", /openforge\.propose_session_input/);
    assert.match(input, /OpenForge source context/);
    assert.match(input, /Type: project/);
    assert.match(input, new RegExp(`ID: ${project.id}`));
    assert.match(input, /Name: OpenForge Project/);
    assert.match(input, /Project record status: active/);
    assert.match(input, /Database running session records: 0/);
    assert.match(input, /Live runtime sessions: 0/);
    assert.doesNotMatch(input, /\nStatus: active/);
    assert.match(input, /AI tool: claude/);
    assert.match(input, /Tech stack: Next\.js, Express/);
    assert.match(input, /User request:\nAssess project readiness/);
    assert.doesNotMatch(input, /openforge-secret-path/);
  });

  it("does not inject stale database-running session records as live project context", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "Aether Glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const createdSession = sessionRepo.create({
      projectId: project.id,
      name: "Old Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/aether-glass",
      tmuxSession: "of-stale"
    });
    sessionRepo.update(createdSession.id, { status: "running" });
    runtimeSessionSnapshots = [];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "看看 Aether Glass 项目会话情况",
      source: "project",
      sourceRefId: project.id
    }, authHeaders());

    const input = calls[0]?.input ?? "";
    assert.equal(res.status, 201);
    assert.match(input, /Database running session records: 1/);
    assert.match(input, /Live runtime sessions: 0/);
    assert.match(input, /Stale running session records: 1/);
    assert.doesNotMatch(input, /Running sessions: 1/);
  });

  it("injects bounded session source context into model requests", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, userId).create({
      projectId: project.id,
      name: "Release smoke",
      aiTool: "codex",
      workingDir: "/tmp/openforge-secret-working-dir",
      attachToken: "attach-secret",
      tmuxSession: "of-secret",
      credentialMode: "stored_encrypted_key"
    });

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Assess session readiness",
      source: "session",
      sourceRefId: session.id
    }, authHeaders());

    const input = calls[0]?.input ?? "";
    assert.equal(res.status, 201);
    assert.match(input, /OpenForge source context/);
    assert.match(input, /Type: session/);
    assert.match(input, new RegExp(`ID: ${session.id}`));
    assert.match(input, /Name: Release smoke/);
    assert.match(input, /Status: idle/);
    assert.match(input, /AI tool: codex/);
    assert.match(input, new RegExp(`Project ID: ${project.id}`));
    assert.match(input, /User request:\nAssess session readiness/);
    assert.doesNotMatch(input, /attach-secret|of-secret|openforge-secret-working-dir/);
  });

  it("does not leak cross-tenant source context into model requests", async () => {
    createOpenAiProvider();
    const foreignProject = new ProjectRepository(db, otherUserId).create({
      name: "Foreign secret project",
      path: "/tmp/foreign-secret-path",
      aiTool: "claude"
    });
    const foreignSession = new SessionRepository(db, otherUserId).create({
      projectId: foreignProject.id,
      name: "Foreign secret session",
      aiTool: "codex",
      workingDir: "/tmp/foreign-session-secret-path",
      attachToken: "foreign-attach-secret",
      tmuxSession: "foreign-of-secret"
    });

    const projectRes = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Assess project readiness",
      source: "project",
      sourceRefId: foreignProject.id
    }, authHeaders());
    const sessionRes = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Assess session readiness",
      source: "session",
      sourceRefId: foreignSession.id
    }, authHeaders());

    const input = calls[0]?.input ?? "";
    const sessionInput = calls[1]?.input ?? "";
    assert.equal(projectRes.status, 201);
    assert.match(input, /OpenForge source context unavailable/);
    assert.match(input, /Type: project/);
    assert.match(input, new RegExp(`ID: ${foreignProject.id}`));
    assert.match(input, /not visible to the current user/);
    assert.match(input, /User request:\nAssess project readiness/);
    assert.doesNotMatch(input, /Foreign secret project|foreign-secret-path/);
    assert.equal(sessionRes.status, 201);
    assert.match(sessionInput, /OpenForge source context unavailable/);
    assert.match(sessionInput, /Type: session/);
    assert.match(sessionInput, new RegExp(`ID: ${foreignSession.id}`));
    assert.match(sessionInput, /not visible to the current user/);
    assert.match(sessionInput, /User request:\nAssess session readiness/);
    assert.doesNotMatch(sessionInput, /Foreign secret session|foreign-session-secret-path|foreign-attach-secret|foreign-of-secret/);
  });

  it("includes older live runs when listing bounded Copilot history", async () => {
    const repo = new CopilotRepository(db, userId);
    const liveRun = repo.createRun({
      status: "running",
      source: "copilot",
      goal: "Older running run"
    });
    for (let index = 0; index < 25; index += 1) {
      repo.createRun({
        status: "completed",
        source: "copilot",
        goal: `Completed run ${index}`
      });
    }

    const res = await makeRequest(app, "GET", "/api/v1/copilot/runs?limit=20", undefined, authHeaders());

    const runs = res.body.data.runs as Array<{ id: string; status: string; goal: string }>;
    assert.equal(res.status, 200);
    assert.equal(runs.filter((run) => run.status === "completed").length, 20);
    assert.ok(runs.some((run) => run.id === liveRun.id && run.status === "running"));
    assert.equal(runs.length, 21);
  });

  it("rejects concurrent Copilot runs for the same user while allowing other users", async () => {
    createOpenAiProvider();
    createOpenAiProvider(otherUserId);
    const release = deferred<void>();
    modelResponseWait = release.promise;
    const server = http.createServer(app);
    const baseUrl = await listen(server);
    try {
      const first = fetch(`${baseUrl}/api/v1/copilot/runs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ prompt: "First run", source: "copilot" })
      });
      await waitFor(() => calls.length === 1);

      const blocked = fetch(`${baseUrl}/api/v1/copilot/runs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ prompt: "Second run", source: "copilot" })
      });
      const other = fetch(`${baseUrl}/api/v1/copilot/runs`, {
        method: "POST",
        headers: otherAuthHeaders(),
        body: JSON.stringify({ prompt: "Other user run", source: "copilot" })
      });
      await waitFor(() => calls.length === 2);
      release.resolve();

      const firstRes = await first;
      const blockedRes = await blocked;
      const otherRes = await other;
      const blockedBody = await blockedRes.json();
      assert.equal(blockedRes.status, 409);
      assert.equal(blockedBody.code, 1);
      assert.equal(blockedBody.details.code, "copilot_run_already_active");
      assert.equal(firstRes.status, 201);
      assert.equal(otherRes.status, 201);
    } finally {
      release.resolve();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects new Copilot runs while the same user already has a live run", async () => {
    const existing = new CopilotRepository(db, userId).createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Existing approval run"
    });

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Start another run",
      source: "copilot"
    }, authHeaders());

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_run_already_active");
    assert.equal(res.body.details.runId, existing.id);
    assert.equal(calls.length, 0);
  });

  it("injects bounded active memory recall for Copilot page runs", async () => {
    createOpenAiProvider();
    new CopilotMemoryRepository(db, userId).createEntry({
      kind: "decision",
      scope: "global",
      text: "Provider SSOT is required for Copilot model configuration."
    });
    new CopilotMemoryRepository(db, otherUserId).createEntry({
      kind: "decision",
      scope: "global",
      text: "Foreign provider SSOT memory must not be recalled."
    });

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "How should provider SSOT work for Copilot?",
      source: "copilot"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.match(calls[0]?.input ?? "", /Relevant OpenForge memory/);
    assert.match(calls[0]?.input ?? "", /Provider SSOT is required/);
    assert.doesNotMatch(calls[0]?.input ?? "", /Foreign provider/);
    assert.deepEqual(
      res.body.data.events.map((event: { type: string }) => event.type),
      ["memory_recalled", "assistant_message"]
    );
    assert.equal(res.body.data.run.stepCount, 2);
  });

  it("injects active memory recall for project source runs", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "Aether Glass",
      path: "/workspace/aether-glass",
      aiTool: "claude"
    });
    const otherProject = new ProjectRepository(db, userId).create({
      name: "Other Project",
      path: "/workspace/other-project",
      aiTool: "claude"
    });
    new CopilotMemoryRepository(db, userId).createEntry({
      kind: "decision",
      scope: "global",
      text: "Provider SSOT is required for Copilot model configuration."
    });
    new CopilotMemoryRepository(db, userId).createEntry({
      kind: "project_note",
      scope: "project",
      projectId: project.id,
      text: "Aether Glass prefers Claude Code sessions for coding work."
    });
    new CopilotMemoryRepository(db, userId).createEntry({
      kind: "project_note",
      scope: "project",
      projectId: otherProject.id,
      text: "Other Project memory must not be recalled for Aether Glass."
    });

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "How should provider SSOT work for Aether Glass?",
      source: "project",
      sourceRefId: project.id
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.match(calls[0]?.input ?? "", /Relevant OpenForge memory/);
    assert.match(calls[0]?.input ?? "", /Provider SSOT is required/);
    assert.match(calls[0]?.input ?? "", /Aether Glass prefers Claude Code/);
    assert.doesNotMatch(calls[0]?.input ?? "", /Other Project memory/);
    assert.deepEqual(
      res.body.data.events.map((event: { type: string }) => event.type),
      ["memory_recalled", "assistant_message"]
    );
  });

  it("records a non-blocking skip event when active recall fails", async () => {
    createOpenAiProvider();
    new CopilotMemoryRepository(db, userId).createEntry({
      kind: "decision",
      scope: "global",
      text: "Provider SSOT is required for Copilot model configuration."
    });
    db.prepare("DROP TABLE copilot_memory_fts").run();

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "How should provider SSOT work for Copilot?",
      source: "copilot"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(calls[0]?.input, "How should provider SSOT work for Copilot?");
    assert.deepEqual(
      res.body.data.events.map((event: { type: string }) => event.type),
      ["memory_recall_skipped", "assistant_message"]
    );
    assert.equal(res.body.data.events[0].payload.reason, "failed");
    assert.equal(res.body.data.run.stepCount, 2);
  });

  it("keeps approval-required tool runs waiting for approval", async () => {
    createOpenAiProvider();
    modelEvents = [{
      type: "tool_call_requested",
      id: "tool-call-1",
      name: "openforge.propose_memory_write",
      input: {
        kind: "decision",
        scope: "global",
        text: "Remember provider SSOT."
      }
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Remember this decision",
      source: "copilot"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "waiting_for_approval");
    assert.equal(res.body.data.run.stepCount, 2);
    assert.equal(res.body.data.run.completedAt, null);
    assert.equal(calls.length, 1);
    assert.equal(res.body.data.pendingActions.length, 1);
    assert.equal(res.body.data.pendingActions[0].type, "openforge.propose_memory_write");
  });

  it("keeps session input tool runs waiting for approval", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const session = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-user123-session_abcdef"
    });
    sessionRepo.update(session.id, { status: "running" });
    modelEventResponses = [
      [
        {
          type: "tool_call_requested",
          id: "tool-call-detail",
          name: "openforge.get_session_detail",
          input: { sessionId: session.id }
        },
        {
          type: "tool_call_requested",
          id: "tool-call-terminal",
          name: "openforge.get_session_terminal_snapshot",
          input: { sessionId: session.id }
        }
      ],
      [{
        type: "tool_call_requested",
        id: "tool-call-input",
        name: "openforge.propose_session_input",
        input: {
          sessionId: session.id,
          input: "pwd",
          submit: true
        }
      }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Ask Claude Code to print working directory",
      source: "copilot"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "waiting_for_approval");
    assert.equal(res.body.data.pendingActions.length, 1);
    assert.equal(res.body.data.pendingActions[0].type, "openforge.propose_session_input");
    assert.equal(res.body.data.pendingActions[0].input.sessionId, session.id);
    assert.equal(res.body.data.pendingActions[0].input.input, "pwd");
    assert.equal(res.body.data.pendingActions[0].input.submit, true);
    assert.deepEqual(capturedSessionIds, [session.id]);
  });

  it("keeps session-stop tool runs waiting for approval", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const createdSession = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-main"
    });
    const session = sessionRepo.updateStatus(createdSession.id, "running") ?? createdSession;
    modelEvents = [{
      type: "tool_call_requested",
      id: "tool-call-stop",
      name: "openforge.propose_session_stop",
      input: { sessionId: session.id, reason: "User asked to stop it." }
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Stop the Claude Code session",
      source: "session",
      sourceRefId: session.id
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "waiting_for_approval");
    assert.equal(res.body.data.pendingActions.length, 1);
    assert.equal(res.body.data.pendingActions[0].type, "openforge.propose_session_stop");
    assert.equal(res.body.data.pendingActions[0].input.sessionId, session.id);
    assert.equal(new SessionRepository(db, userId).getById(session.id)?.status, "running");
  });

  it("keeps Copilot model-selection tool runs waiting for approval", async () => {
    createOpenAiProvider(userId, { isDefault: true, providerKey: "openai" });
    const targetProviderId = createOpenAiProvider(userId, { isDefault: false, providerKey: "anthropic" });
    const targetModel = new ModelProviderRepository(db, userId, masterKey).listModelProfiles(targetProviderId)[0];
    assert.ok(targetModel);
    modelEvents = [{
      type: "tool_call_requested",
      id: "tool-call-model-selection",
      name: "openforge.propose_copilot_model_selection",
      input: {
        providerProfileId: targetProviderId,
        modelProfileId: targetModel.id,
        reason: "Use Anthropic for Copilot."
      }
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Switch Copilot to Anthropic",
      source: "models"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "waiting_for_approval");
    assert.equal(res.body.data.pendingActions.length, 1);
    assert.equal(res.body.data.pendingActions[0].type, "openforge.propose_copilot_model_selection");
    assert.equal(res.body.data.pendingActions[0].input.providerProfileId, targetProviderId);
    assert.equal(res.body.data.pendingActions[0].input.modelProfileId, targetModel.id);
    assert.equal(new ModelProviderRepository(db, userId, masterKey).getModelProfile(targetModel.id)?.isDefault, false);
  });

  it("keeps project-create tool runs waiting for approval", async () => {
    createOpenAiProvider();
    const projectPath = path.join(tmpdir(), `openforge-copilot-draft-${randomSuffix()}`);
    modelEvents = [{
      type: "tool_call_requested",
      id: "tool-call-1",
      name: "openforge.propose_project_create",
      input: {
        name: "Copilot Draft Project",
        path: projectPath,
        aiTool: "claude",
        description: "Created after approval"
      }
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Create a new Claude Code project",
      source: "copilot"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "waiting_for_approval");
    assert.equal(res.body.data.pendingActions.length, 1);
    assert.equal(res.body.data.pendingActions[0].type, "openforge.propose_project_create");
    assert.equal(res.body.data.pendingActions[0].input.name, "Copilot Draft Project");
    assert.equal(res.body.data.pendingActions[0].input.path, projectPath);
    assert.equal(new ProjectRepository(db, userId).list().length, 0);
    assert.equal(existsSync(projectPath), false);
  });

  it("keeps project-config-sync tool runs waiting for approval", async () => {
    createOpenAiProvider();
    const projectPath = path.join(tmpdir(), `openforge-copilot-config-draft-${randomSuffix()}`);
    mkdirSync(projectPath, { recursive: true });
    const project = new ProjectRepository(db, userId).create({
      name: "Config Draft",
      path: projectPath,
      aiTool: "claude"
    });
    modelEvents = [{
      type: "tool_call_requested",
      id: "tool-call-1",
      name: "openforge.propose_project_config_sync",
      input: {
        projectId: project.id,
        credentialMode: "host_environment"
      }
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Sync this project config",
      source: "copilot"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "waiting_for_approval");
    assert.equal(res.body.data.pendingActions.length, 1);
    assert.equal(res.body.data.pendingActions[0].type, "openforge.propose_project_config_sync");
    assert.equal(res.body.data.pendingActions[0].input.projectId, project.id);
    assert.equal(existsSync(path.join(projectPath, ".claude", "settings.json")), false);
  });

  it("writes audit logs for Copilot tool requests and pending-action creation", async () => {
    createOpenAiProvider();
    modelEvents = [{
      type: "tool_call_requested",
      id: "tool-call-1",
      name: "openforge.propose_troubleshooting_steps",
      input: {
        steps: ["Check provider setup"],
        summary: "token=secret-value"
      }
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Prepare troubleshooting steps",
      source: "copilot"
    }, authHeaders());

    const runId = res.body.data.run.id as string;
    const actionId = res.body.data.pendingActions[0].id as string;
    const auditLogs = new AuditLogRepository(db, userId).list({
      resourceType: "copilot_run",
      resourceId: runId,
      limit: 10
    });
    const actions = auditLogs.map((log) => log.action).sort();
    const toolDetails = JSON.parse(
      auditLogs.find((log) => log.action === "copilot.tool.request")?.details ?? "{}"
    ) as { runId?: string; toolName?: string; input?: { summary?: string } };
    const pendingDetails = JSON.parse(
      auditLogs.find((log) => log.action === "copilot.pending_action.create")?.details ?? "{}"
    ) as { runId?: string; actionId?: string; actionType?: string; status?: string; input?: { summary?: string } };
    const resultDetails = JSON.parse(
      auditLogs.find((log) => log.action === "copilot.tool.result")?.details ?? "{}"
    ) as { runId?: string; toolName?: string; output?: { actionId?: string; summary?: string } };

    assert.equal(res.status, 201);
    assert.deepEqual(actions, [
      "copilot.pending_action.create",
      "copilot.run.start",
      "copilot.tool.request",
      "copilot.tool.result"
    ]);
    assert.equal(toolDetails.runId, runId);
    assert.equal(toolDetails.toolName, "openforge.propose_troubleshooting_steps");
    assert.equal(toolDetails.input?.summary, "token=[REDACTED]");
    assert.equal(pendingDetails.runId, runId);
    assert.equal(pendingDetails.actionId, actionId);
    assert.equal(pendingDetails.actionType, "openforge.propose_troubleshooting_steps");
    assert.equal(pendingDetails.status, "pending");
    assert.equal(pendingDetails.input?.summary, "token=[REDACTED]");
    assert.equal(resultDetails.runId, runId);
    assert.equal(resultDetails.toolName, "openforge.propose_troubleshooting_steps");
    assert.equal(resultDetails.output?.actionId, actionId);
    assert.equal(resultDetails.output?.summary, "Pending user approval");
    assert.doesNotMatch(JSON.stringify(auditLogs), /secret-value/);
  });

  it("generates a final assistant answer after read-only tool results", async () => {
    createOpenAiProvider();
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-1",
        name: "openforge.get_dashboard_summary",
        input: {}
      }],
      [{ type: "assistant_message", text: "Dashboard is ready after checking tool results." }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize dashboard health",
      source: "dashboard"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(res.body.data.run.stepCount, 3);
    assert.equal(calls.length, 2);
    assert.ok(Array.isArray(calls[1]?.tools));
    assert.match(calls[1]?.input ?? "", /openforge\.get_dashboard_summary/);
    assert.match(calls[1]?.input ?? "", /Summarize dashboard health/);
    assert.deepEqual(
      res.body.data.events.map((event: { type: string }) => event.type),
      ["tool_call_requested", "tool_result", "assistant_message"]
    );
    assert.equal(
      res.body.data.events.at(-1)?.message,
      "Dashboard is ready after checking tool results."
    );
    const toolResultLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.tool.result",
      resourceType: "copilot_run",
      resourceId: res.body.data.run.id
    });
    const toolResultDetails = JSON.parse(toolResultLogs[0]?.details ?? "{}") as {
      toolName?: string;
      toolCallId?: string;
      output?: { stats?: { projects?: number } };
    };
    assert.equal(toolResultLogs.length, 1);
    assert.equal(toolResultDetails.toolName, "openforge.get_dashboard_summary");
    assert.equal(toolResultDetails.toolCallId, "tool-call-1");
    assert.equal(typeof toolResultDetails.output?.stats?.projects, "number");
  });

  it("fails closed when a read tool output exceeds the Copilot safety limit", async () => {
    createOpenAiProvider();
    const activities = new ActivityRepository(db, userId);
    for (let index = 0; index < 50; index += 1) {
      activities.create({
        type: "copilot_large_activity",
        message: `Large activity ${index} ${"x".repeat(2 * 1024)}`
      });
    }
    modelEvents = [{
      type: "tool_call_requested",
      id: "tool-call-1",
      name: "openforge.get_recent_activity",
      input: { limit: 50 }
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize recent activity",
      source: "dashboard"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_redaction_blocked_output");
    assert.equal(run?.status, "failed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "run_failed"
    ]);
    const toolFailLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.tool.fail",
      resourceType: "copilot_run",
      resourceId: run?.id
    });
    const toolFailDetails = JSON.parse(toolFailLogs[0]?.details ?? "{}") as {
      toolName?: string;
      toolCallId?: string;
      errorCode?: string;
    };
    assert.equal(toolFailLogs.length, 1);
    assert.equal(toolFailDetails.toolName, "openforge.get_recent_activity");
    assert.equal(toolFailDetails.toolCallId, "tool-call-1");
    assert.equal(toolFailDetails.errorCode, "copilot_redaction_blocked_output");
    assert.equal(calls.length, 1);
  });

  it("redacts model-supplied tool call names before persistence", async () => {
    createOpenAiProvider();
    modelEvents = [{
      type: "tool_call_requested",
      id: "tool-call-1",
      name: "token=secret-tool",
      input: { token: "secret-input" }
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Use a tool",
      source: "dashboard"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    const auditLogs = new AuditLogRepository(db, userId).list({
      resourceType: "copilot_run",
      resourceId: run?.id,
      limit: 10
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.details.code, "copilot_tool_not_allowed");
    assert.match(events[0]?.message ?? "", /\[REDACTED\]/);
    assert.match(String(events[0]?.payload.name ?? ""), /\[REDACTED\]/);
    assert.match(String(events[0]?.payload.input?.token ?? ""), /\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(res.body), /secret-tool|secret-input/);
    assert.doesNotMatch(JSON.stringify(events), /secret-tool|secret-input/);
    assert.doesNotMatch(JSON.stringify(auditLogs), /secret-tool|secret-input/);
  });

  it("marks runs failed when the initial model request throws", async () => {
    createOpenAiProvider();
    modelEventResponses = [new Error("network failure token=secret-value")];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize Gateway health",
      source: "copilot"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    assert.equal(res.status, 502);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_model_request_failed");
    assert.equal(res.body.details.run.status, "failed");
    assert.equal(run?.status, "failed");
    assert.equal(run?.errorCode, "copilot_model_request_failed");
    assert.equal(new CopilotRepository(db, userId).listEvents(run?.id ?? "").at(-1)?.type, "run_failed");
    assert.doesNotMatch(JSON.stringify(res.body), /secret-value/);
  });

  it("writes a redacted audit log when a Copilot run fails", async () => {
    createOpenAiProvider();
    modelEventResponses = [new Error("network failure token=secret-value")];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize Gateway health",
      source: "copilot"
    }, authHeaders());

    const runId = res.body.details.run.id as string;
    const auditLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.run.fail",
      resourceType: "copilot_run",
      resourceId: runId
    });
    const details = JSON.parse(auditLogs[0]?.details ?? "{}") as {
      runId?: string;
      status?: string;
      errorCode?: string;
      errorMessage?: string;
    };

    assert.equal(res.status, 502);
    assert.equal(auditLogs.length, 1);
    assert.equal(details.runId, runId);
    assert.equal(details.status, "failed");
    assert.equal(details.errorCode, "copilot_model_request_failed");
    assert.equal(details.errorMessage, "Copilot model request failed");
    assert.doesNotMatch(JSON.stringify(auditLogs), /secret-value/);
  });

  it("redacts model-supplied run failure messages before persistence", async () => {
    createOpenAiProvider();
    modelEvents = [{
      type: "run_failed",
      code: "token=secret-code",
      message: "Provider rejected token=secret-value and sk-secret-key"
    }];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize Gateway health",
      source: "copilot"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const event = new CopilotRepository(db, userId).listEvents(run?.id ?? "").at(-1);
    assert.equal(res.status, 502);
    assert.equal(res.body.details.code, "copilot_model_request_failed");
    assert.equal(run?.errorCode, "copilot_model_request_failed");
    assert.equal(event?.payload.code, "copilot_model_request_failed");
    assert.match(run?.errorMessage ?? "", /\[REDACTED\]/);
    assert.match(event?.message ?? "", /\[REDACTED\]/);
    assert.match(String(event?.payload.message ?? ""), /\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(res.body), /secret-code|secret-value|sk-secret-key/);
    assert.doesNotMatch(JSON.stringify(event), /secret-code|secret-value|sk-secret-key/);
  });

  it("marks runs failed when the post-tool model answer throws", async () => {
    createOpenAiProvider();
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-1",
        name: "openforge.get_dashboard_summary",
        input: {}
      }],
      new Error("follow-up failure sk-secret-value")
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize dashboard health",
      source: "dashboard"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 502);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_model_request_failed");
    assert.equal(run?.status, "failed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_result",
      "run_failed"
    ]);
    assert.equal(new AuditLogRepository(db, userId).list({
      action: "copilot.tool.fail",
      resourceType: "copilot_run",
      resourceId: run?.id
    }).length, 0);
    assert.doesNotMatch(JSON.stringify(res.body), /sk-secret-value/);
  });

  it("executes multiple read tools from one model response as a provider fallback before answering", async () => {
    createOpenAiProvider();
    modelEventResponses = [
      [
        {
          type: "tool_call_requested",
          id: "tool-call-1",
          name: "openforge.get_dashboard_summary",
          input: {}
        },
        {
          type: "tool_call_requested",
          id: "tool-call-2",
          name: "openforge.get_diagnostics_summary",
          input: {}
        }
      ],
      [{ type: "assistant_message", text: "Dashboard and diagnostics are ready." }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Summarize dashboard and diagnostics",
      source: "dashboard"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(run?.status, "completed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_call_requested",
      "tool_result",
      "tool_result",
      "assistant_message"
    ]);
    assert.equal(calls.length, 2);
    assert.match(calls[0]?.instructions ?? "", /at most one OpenForge tool/i);
    assert.match(calls[1]?.instructions ?? "", /at most one OpenForge tool/i);
    assert.match(calls[1]?.instructions ?? "", /Project status and session status are different/);
    assert.match(calls[1]?.instructions ?? "", /Only say a session is active or running/);
    assert.match(calls[1]?.input ?? "", /openforge\.get_dashboard_summary/);
    assert.match(calls[1]?.input ?? "", /openforge\.get_diagnostics_summary/);
    assert.equal(events.at(-1)?.message, "Dashboard and diagnostics are ready.");
  });

  it("continues bounded read-tool loops when the model needs another tool after tool results", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const createdSession = sessionRepo.create({
      projectId: project.id,
      name: "Main session",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-main"
    });
    sessionRepo.updateStatus(createdSession.id, "running");
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-projects",
        name: "openforge.list_projects",
        input: {}
      }],
      [{
        type: "tool_call_requested",
        id: "tool-call-sessions",
        name: "openforge.list_sessions",
        input: {}
      }],
      [{ type: "assistant_message", text: "OpenForge has one running Claude session." }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "Check whether OpenForge has an active session",
      source: "copilot"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(run?.status, "completed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_result",
      "tool_call_requested",
      "tool_result",
      "assistant_message"
    ]);
    assert.equal(calls.length, 3);
    assert.ok(Array.isArray(calls[1]?.tools));
    assert.ok(Array.isArray(calls[2]?.tools));
    assert.match(calls[2]?.input ?? "", /openforge\.list_sessions/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /OpenForge 有 1 个正在运行的会话/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /Main session/);
  });

  it("requires session tool evidence before answering active-session questions", async () => {
    createOpenAiProvider();
    new ProjectRepository(db, userId).create({
      name: "aether-glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-projects",
        name: "openforge.list_projects",
        input: {}
      }],
      [{ type: "assistant_message", text: "aether-glass is active, so it has an active session." }],
      [{ type: "assistant_message", text: "aether-glass has no running sessions." }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "看下aether-glass是否有正在运行的会话",
      source: "copilot"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(run?.status, "completed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_result",
      "tool_call_requested",
      "tool_result",
      "assistant_message"
    ]);
    assert.equal(events[2]?.message, "openforge.list_sessions");
    assert.equal(calls.length, 3);
    assert.match(calls[2]?.input ?? "", /openforge\.list_sessions/);
    assert.doesNotMatch(JSON.stringify(res.body), /so it has an active session/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /aether-glass 没有正在运行的会话/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /项目状态 active 只表示项目记录可用/);
  });

  it("treats project running-state questions as session-status questions", async () => {
    createOpenAiProvider();
    new ProjectRepository(db, userId).create({
      name: "aether-glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-projects",
        name: "openforge.list_projects",
        input: {}
      }],
      [{ type: "assistant_message", text: "aether-glass 项目状态为 active，说明正在运行。" }],
      [{ type: "assistant_message", text: "aether-glass 没有正在运行的会话。" }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "看下 aether-glass 项目现在是否正在运行",
      source: "copilot"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(run?.status, "completed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_result",
      "tool_call_requested",
      "tool_result",
      "assistant_message"
    ]);
    assert.equal(events[2]?.message, "openforge.list_sessions");
    assert.doesNotMatch(JSON.stringify(res.body), /说明正在运行/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /aether-glass 没有正在运行的会话/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /项目状态 active 只表示项目记录可用/);
  });

  it("requires session tool evidence before answering general project-session questions", async () => {
    createOpenAiProvider();
    new ProjectRepository(db, userId).create({
      name: "aether-glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-projects",
        name: "openforge.list_projects",
        input: {}
      }],
      [{ type: "assistant_message", text: "aether-glass 项目状态为 active，说明存在活跃会话。" }],
      [{ type: "assistant_message", text: "aether-glass 没有会话。" }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "看看 aether-glass 项目会话情况",
      source: "copilot"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(run?.status, "completed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_result",
      "tool_call_requested",
      "tool_result",
      "assistant_message"
    ]);
    assert.equal(events[2]?.message, "openforge.list_sessions");
    assert.doesNotMatch(JSON.stringify(res.body), /说明存在活跃会话/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /aether-glass 没有正在运行的会话/);
  });

  it("overrides model answers that confuse active projects with active sessions", async () => {
    createOpenAiProvider();
    new ProjectRepository(db, userId).create({
      name: "aether-glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    modelEventResponses = [
      [
        {
          type: "tool_call_requested",
          id: "tool-call-projects",
          name: "openforge.list_projects",
          input: {}
        },
        {
          type: "tool_call_requested",
          id: "tool-call-sessions",
          name: "openforge.list_sessions",
          input: {}
        }
      ],
      [{
        type: "assistant_message",
        text: "aether-glass 项目状态为 active，说明存在活跃会话。"
      }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "看下aether-glass是否有正在运行的会话",
      source: "copilot"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(run?.status, "completed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_call_requested",
      "tool_result",
      "tool_result",
      "assistant_message"
    ]);
    assert.doesNotMatch(JSON.stringify(res.body), /说明存在活跃会话/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /没有正在运行的会话/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /项目状态.*不是会话运行状态/);
  });

  it("drops premature assistant text when the model asks for session evidence in the same response", async () => {
    createOpenAiProvider();
    new ProjectRepository(db, userId).create({
      name: "aether-glass",
      path: "/tmp/aether-glass",
      aiTool: "claude"
    });
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-projects",
        name: "openforge.list_projects",
        input: {}
      }],
      [
        {
          type: "assistant_message",
          text: "aether-glass 项目状态为 active，说明存在活跃会话。"
        },
        {
          type: "tool_call_requested",
          id: "tool-call-sessions",
          name: "openforge.list_sessions",
          input: {}
        }
      ],
      [{
        type: "assistant_message",
        text: "aether-glass 没有正在运行的会话。"
      }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "看下aether-glass是否有正在运行的会话",
      source: "copilot"
    }, authHeaders());

    const run = new CopilotRepository(db, userId).listRuns()[0];
    const events = new CopilotRepository(db, userId).listEvents(run?.id ?? "");
    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(run?.status, "completed");
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_result",
      "tool_call_requested",
      "tool_result",
      "assistant_message"
    ]);
    assert.doesNotMatch(JSON.stringify(res.body), /说明存在活跃会话/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /aether-glass 没有正在运行的会话/);
    assert.match(res.body.data.events.at(-1)?.message ?? "", /项目状态 active 只表示项目记录可用/);
  });

  it("lets Copilot inspect bounded terminal output before answering session questions", async () => {
    createOpenAiProvider();
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const createdSession = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-main"
    });
    const session = sessionRepo.updateStatus(createdSession.id, "running") ?? createdSession;
    modelEventResponses = [
      [{
        type: "tool_call_requested",
        id: "tool-call-terminal",
        name: "openforge.get_session_terminal_snapshot",
        input: { sessionId: session.id, maxBytes: 512 }
      }],
      [{ type: "assistant_message", text: "Claude Code says the current task is complete." }]
    ];

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "What does the Claude Code session say right now?",
      source: "session",
      sourceRefId: session.id
    }, authHeaders());

    const events = new CopilotRepository(db, userId).listEvents(res.body.data.run.id);
    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.deepEqual(capturedSessionIds, [session.id]);
    assert.deepEqual(events.map((event) => event.type), [
      "tool_call_requested",
      "tool_result",
      "assistant_message"
    ]);
    assert.match(calls[1]?.input ?? "", /Current task is complete/);
    assert.equal(res.body.data.events.at(-1)?.message, "Claude Code says the current task is complete.");
  });

  it("does not cancel terminal Copilot runs", async () => {
    const repo = new CopilotRepository(db, userId);
    const run = repo.createRun({
      status: "completed",
      source: "copilot",
      goal: "Already done"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/cancel`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_run_not_cancellable");
    assert.equal(new CopilotRepository(db, userId).getRun(run.id)?.status, "completed");
  });

  it("rejects outstanding pending actions when cancelling a waiting run", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_memory_write", {
      kind: "decision",
      scope: "global",
      text: "Remember release gates."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/cancel`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    const events = new CopilotRepository(db, userId).listEvents(runId);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "cancelled");
    assert.equal(action?.status, "rejected");
    assert.equal(events.at(-2)?.type, "pending_action_rejected");
    assert.equal(events.at(-2)?.payload.actionId, actionId);
    assert.equal(events.at(-2)?.payload.status, "rejected");
    assert.equal(events.at(-1)?.type, "run_cancelled");
    assert.equal(events.at(-1)?.payload.rejectedPendingActionCount, 1);
  });

  it("writes an audit log when cancelling a Copilot run", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_memory_write", {
      kind: "decision",
      scope: "global",
      text: "Remember token=secret-value."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/cancel`,
      undefined,
      authHeaders()
    );

    const auditLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.run.cancel",
      resourceType: "copilot_run",
      resourceId: runId
    });
    const actionAuditLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.pending_action.reject",
      resourceType: "copilot_run",
      resourceId: runId
    });
    const details = JSON.parse(auditLogs[0]?.details ?? "{}") as {
      runId?: string;
      status?: string;
      rejectedPendingActionCount?: number;
    };
    const actionDetails = JSON.parse(actionAuditLogs[0]?.details ?? "{}") as {
      actionId?: string;
      decision?: string;
      result?: { reason?: string };
    };

    assert.equal(res.status, 200);
    assert.equal(auditLogs.length, 1);
    assert.equal(actionAuditLogs.length, 1);
    assert.equal(details.runId, runId);
    assert.equal(details.status, "cancelled");
    assert.equal(details.rejectedPendingActionCount, 1);
    assert.equal(actionDetails.actionId, actionId);
    assert.equal(actionDetails.decision, "rejected");
    assert.equal(actionDetails.result?.reason, "run_cancelled");
    assert.doesNotMatch(JSON.stringify([...auditLogs, ...actionAuditLogs]), /secret-value/);
  });

  it("rejects a processing pending action without cancelling the whole run", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_memory_write", {
      kind: "decision",
      scope: "global",
      text: "Do not remember this."
    });
    new CopilotRepository(db, userId).updatePendingActionIfStatus(actionId, "pending", {
      status: "processing"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/reject`,
      undefined,
      authHeaders()
    );

    const repo = new CopilotRepository(db, userId);
    const action = repo.getPendingAction(actionId);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(action?.status, "rejected");
    assert.equal(action?.result.reason, "user_rejected");
  });

  it("keeps a run waiting while another pending action is still processing", async () => {
    const repo = new CopilotRepository(db, userId);
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Review multiple actions"
    });
    const first = repo.createPendingAction(run.id, {
      type: "openforge.propose_memory_write",
      input: {
        kind: "decision",
        scope: "global",
        text: "Reject this one."
      }
    });
    const second = repo.createPendingAction(run.id, {
      type: "openforge.propose_memory_write",
      input: {
        kind: "decision",
        scope: "global",
        text: "Still processing."
      }
    });
    repo.updatePendingActionIfStatus(second.id, "pending", { status: "processing" });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/pending-actions/${first.id}/reject`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.run.status, "waiting_for_approval");
    assert.equal(new CopilotRepository(db, userId).getRun(run.id)?.status, "waiting_for_approval");
    assert.equal(new CopilotRepository(db, userId).getPendingAction(second.id)?.status, "processing");
  });

  it("keeps cancelled running runs cancelled when the model request finishes later", async () => {
    createOpenAiProvider();
    const release = deferred<void>();
    modelResponseWait = release.promise;
    const server = http.createServer(app);
    const baseUrl = await listen(server);

    try {
      const first = fetch(`${baseUrl}/api/v1/copilot/runs`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ prompt: "Long model call", source: "copilot" })
      });
      await waitFor(() => calls.length === 1);
      const run = new CopilotRepository(db, userId).listRuns()[0];
      assert.ok(run);

      const cancelRes = await fetch(`${baseUrl}/api/v1/copilot/runs/${run.id}/cancel`, {
        method: "POST",
        headers: authHeaders()
      });
      const cancelBody = await cancelRes.json();
      release.resolve();

      const firstRes = await first;
      const firstBody = await firstRes.json();
      const repo = new CopilotRepository(db, userId);

      assert.equal(cancelRes.status, 200);
      assert.equal(cancelBody.data.run.status, "cancelled");
      assert.equal(firstRes.status, 409);
      assert.equal(firstBody.details.code, "copilot_run_cancelled");
      assert.equal(repo.getRun(run.id)?.status, "cancelled");
      assert.equal(repo.listEvents(run.id).at(-1)?.type, "run_cancelled");
      assert.equal(modelRequestSignals[0]?.aborted, true);
    } finally {
      release.resolve();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("cancels only still-pending or processing actions without overwriting approved decisions", async () => {
    const repo = new CopilotRepository(db, userId);
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Cancel outstanding actions"
    });
    const approved = repo.createPendingAction(run.id, {
      type: "openforge.propose_setting_update",
      input: { key: "theme", value: "dark" }
    });
    const pending = repo.createPendingAction(run.id, {
      type: "openforge.propose_setting_update",
      input: { key: "language", value: "zh-CN" }
    });
    const processing = repo.createPendingAction(run.id, {
      type: "openforge.propose_setting_update",
      input: { key: "fontSize", value: "14" }
    });
    repo.updatePendingActionIfStatus(approved.id, "pending", {
      status: "approved",
      result: { ok: true },
      approvedBy: userId,
      approvedAt: Date.now()
    });
    repo.updatePendingActionIfStatus(processing.id, "pending", { status: "processing" });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/cancel`,
      undefined,
      authHeaders()
    );

    const latestRepo = new CopilotRepository(db, userId);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.run.status, "cancelled");
    assert.equal(res.body.data.events.at(-1)?.payload.rejectedPendingActionCount, 2);
    assert.equal(latestRepo.getPendingAction(approved.id)?.status, "approved");
    assert.equal(latestRepo.getPendingAction(pending.id)?.status, "rejected");
    assert.equal(latestRepo.getPendingAction(processing.id)?.status, "rejected");
  });

  it("does not approve a processing pending action after its run is cancelled", async () => {
    const release = deferred<void>();
    let commandStarted = false;
    const raceApp = express();
    raceApp.locals.jwtSecret = secret;
    raceApp.use(express.json());
    raceApp.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      adapterCommandRunner: async (command) => {
        commandStarted = true;
        await release.promise;
        if (command === "tmux") return { exitCode: 0, stdout: "tmux 3.5", stderr: "" };
        return { exitCode: 1, stdout: "", stderr: `${command} missing` };
      }
    }));
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_adapter_refresh");
    const server = http.createServer(raceApp);
    const baseUrl = await listen(server);

    try {
      const approve = fetch(`${baseUrl}/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`, {
        method: "POST",
        headers: authHeaders()
      });
      await waitFor(() => commandStarted);
      const cancelRes = await fetch(`${baseUrl}/api/v1/copilot/runs/${runId}/cancel`, {
        method: "POST",
        headers: authHeaders()
      });
      release.resolve();

      const approveRes = await approve;
      const approveBody = await approveRes.json();
      const cancelBody = await cancelRes.json();
      const repo = new CopilotRepository(db, userId);
      const action = repo.getPendingAction(actionId);

      assert.equal(cancelRes.status, 200);
      assert.equal(cancelBody.data.run.status, "cancelled");
      assert.equal(approveRes.status, 409);
      assert.equal(approveBody.details.code, "copilot_run_cancelled");
      assert.equal(repo.getRun(runId)?.status, "cancelled");
      assert.equal(action?.status, "rejected");
      assert.equal(action?.result.reason, "run_cancelled");
    } finally {
      release.resolve();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("restores a processing pending action when approval execution throws", async () => {
    const failureApp = express();
    failureApp.locals.jwtSecret = secret;
    failureApp.use(express.json());
    failureApp.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      pendingActionApprover: async () => {
        throw new Error("approval crashed");
      }
    }));
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_adapter_refresh");

    const res = await makeRequest(
      failureApp,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const repo = new CopilotRepository(db, userId);
    const action = repo.getPendingAction(actionId);
    assert.equal(res.status, 500);
    assert.equal(res.body.details.code, "copilot_pending_action_approval_failed");
    assert.equal(action?.status, "pending");
    assert.equal(action?.result, null);
  });

  it("fails running Copilot runs when the model request times out", async () => {
    createOpenAiProvider();
    let timeoutSignal: AbortSignal | undefined;
    const timeoutApp = express();
    timeoutApp.locals.jwtSecret = secret;
    timeoutApp.use(express.json());
    timeoutApp.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      modelRequestTimeoutMs: 5,
      modelClientFactory: () => ({
        async createResponse(_request: CopilotModelRequest, options?: { signal?: AbortSignal }) {
          timeoutSignal = options?.signal;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return [{ type: "assistant_message", text: "Late answer" }];
        }
      } as CopilotModelClient)
    }));

    const res = await makeRequest(timeoutApp, "POST", "/api/v1/copilot/runs", {
      prompt: "Long model call",
      source: "copilot"
    }, authHeaders());

    const repo = new CopilotRepository(db, userId);
    const run = repo.listRuns()[0];
    const events = repo.listEvents(run?.id ?? "");
    assert.equal(res.status, 504);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_model_request_timeout");
    assert.equal(run?.status, "failed");
    assert.equal(events.at(-1)?.type, "run_failed");
    assert.equal(events.at(-1)?.payload.code, "copilot_model_request_timeout");
    assert.equal(timeoutSignal?.aborted, true);
  });

  it("does not approve pending actions for non-waiting runs", async () => {
    const repo = new CopilotRepository(db, userId);
    const run = repo.createRun({
      status: "cancelled",
      source: "copilot",
      goal: "Cancelled pending action"
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_memory_write",
      input: {
        kind: "decision",
        scope: "global",
        text: "Should not be stored."
      }
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/pending-actions/${action.id}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_run_not_approvable");
    assert.equal(new CopilotMemoryRepository(db, userId).listEntries({}).length, 0);
  });

  it("rejects pending-action approval outside the current user", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_diagnostics_export");

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      otherAuthHeaders()
    );

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 1);
  });

  it("does not expose Copilot run details across tenants", async () => {
    const run = new CopilotRepository(db, userId).createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Tenant scoped run"
    });

    const res = await makeRequest(
      app,
      "GET",
      `/api/v1/copilot/runs/${run.id}`,
      undefined,
      otherAuthHeaders()
    );

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.message, "Copilot run not found");
  });

  it("does not cancel Copilot runs across tenants", async () => {
    const repo = new CopilotRepository(db, userId);
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Tenant scoped cancellable run"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/cancel`,
      undefined,
      otherAuthHeaders()
    );

    assert.equal(res.status, 404);
    assert.equal(res.body.code, 1);
    assert.equal(repo.getRun(run.id)?.status, "waiting_for_approval");
  });

  it("marks pending actions rejected", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_troubleshooting_steps");

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/reject`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "rejected");
  });

  it("does not reject already decided pending actions while a run still waits", async () => {
    const repo = new CopilotRepository(db, userId);
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Approve actions"
    });
    const approvedAction = repo.createPendingAction(run.id, {
      type: "openforge.propose_troubleshooting_steps",
      input: { steps: ["Already approved"] }
    });
    repo.updatePendingAction(approvedAction.id, {
      status: "approved",
      result: { steps: ["Already approved"], executed: false },
      approvedBy: userId,
      approvedAt: Date.now()
    });
    repo.createPendingAction(run.id, {
      type: "openforge.propose_troubleshooting_steps",
      input: { steps: ["Still pending"] }
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/pending-actions/${approvedAction.id}/reject`,
      undefined,
      authHeaders()
    );

    const action = repo.getPendingAction(approvedAction.id);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_pending_action_not_pending");
    assert.equal(action?.status, "approved");
    assert.equal(repo.getRun(run.id)?.status, "waiting_for_approval");
  });

  it("writes an audit log when rejecting a Copilot pending action", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_troubleshooting_steps", {
      steps: ["Check provider setup"],
      note: "token=secret-value"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/reject`,
      undefined,
      authHeaders()
    );

    const auditLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.pending_action.reject",
      resourceType: "copilot_run",
      resourceId: runId
    });
    const details = JSON.parse(auditLogs[0]?.details ?? "{}") as {
      actionId?: string;
      actionType?: string;
      decision?: string;
      rejectedBy?: string;
      input?: { note?: string };
      result?: { reason?: string };
    };

    assert.equal(res.status, 200);
    assert.equal(auditLogs.length, 1);
    assert.equal(details.actionId, actionId);
    assert.equal(details.actionType, "openforge.propose_troubleshooting_steps");
    assert.equal(details.decision, "rejected");
    assert.equal(details.rejectedBy, userId);
    assert.equal(details.input?.note, "token=[REDACTED]");
    assert.equal(details.result?.reason, "user_rejected");
    assert.doesNotMatch(JSON.stringify(details), /secret-value/);
  });

  it("completes waiting runs and records an event after rejecting the last pending action", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_troubleshooting_steps");

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/reject`,
      undefined,
      authHeaders()
    );

    const repo = new CopilotRepository(db, userId);
    const events = repo.listEvents(runId);
    const auditLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.run.complete",
      resourceType: "copilot_run",
      resourceId: runId
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(typeof res.body.data.run.completedAt, "number");
    assert.equal(repo.getRun(runId)?.status, "completed");
    assert.equal(events.at(-1)?.type, "pending_action_rejected");
    assert.equal(events.at(-1)?.message, "openforge.propose_troubleshooting_steps");
    assert.equal(auditLogs.length, 1);
  });

  it("requires authenticated route approval so the model cannot self-approve", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_diagnostics_export");

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`
    );

    assert.equal(res.status, 401);
    assert.equal(res.body.code, 1);
  });

  it("approves adapter-refresh actions by returning fresh adapter discovery", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_adapter_refresh", {
      reason: "Recheck CLI availability after install."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const adapters = res.body.data.action.result.adapters as Array<{
      id: string;
      available: boolean;
      launchEnabled: boolean;
      version?: string;
    }>;
    const claude = adapters.find((adapter) => adapter.id === "claude");
    const opencode = adapters.find((adapter) => adapter.id === "opencode");
    const codex = adapters.find((adapter) => adapter.id === "codex");
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(claude?.available, true);
    assert.equal(claude?.launchEnabled, true);
    assert.equal(claude?.version, "Claude Code 1.0.0");
    assert.equal(opencode?.available, true);
    assert.equal(opencode?.launchEnabled, true);
    assert.equal(codex?.available, true);
    assert.equal(codex?.launchEnabled, true);
    assert.ok(adapterCommands.includes("tmux"));
    assert.ok(adapterCommands.includes("claude"));
    assert.ok(adapterCommands.includes("opencode"));
    assert.ok(adapterCommands.includes("codex"));
  });

  it("allows only one concurrent approval for the same pending action", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_adapter_refresh", {
      reason: "Recheck CLI availability after install."
    });
    const release = deferred<void>();
    let waitingCommandCount = 0;
    const blockingAdapterCommandRunner: CommandRunner = async (command) => {
      adapterCommands.push(command);
      waitingCommandCount += 1;
      await release.promise;
      if (command === "tmux") return { exitCode: 0, stdout: "tmux 3.5", stderr: "" };
      if (command === "claude") return { exitCode: 0, stdout: "Claude Code 1.0.0", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: `${command} missing` };
    };
    const customApp = express();
    customApp.locals.jwtSecret = secret;
    customApp.use(express.json());
    customApp.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      modelClientFactory: () => fakeModelClient(calls, async () => modelEvents),
      adapterCommandRunner: blockingAdapterCommandRunner
    }));
    const server = http.createServer(customApp);
    const baseUrl = await listen(server);
    try {
      const first = fetch(`${baseUrl}/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`, {
        method: "POST",
        headers: authHeaders()
      });
      await waitFor(() => waitingCommandCount > 0);
      const duplicate = fetch(`${baseUrl}/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`, {
        method: "POST",
        headers: authHeaders()
      });
      release.resolve();

      const responses = await Promise.all([first, duplicate]);
      const statuses = responses.map((response) => response.status).sort();
      const bodies = await Promise.all(responses.map((response) => response.json()));
      const auditLogs = new AuditLogRepository(db, userId).list({
        action: "copilot.pending_action.approve",
        resourceType: "copilot_run",
        resourceId: runId,
        limit: 10
      });

      assert.deepEqual(statuses, [200, 409]);
      assert.equal(bodies.filter((body) => body.code === 0).length, 1);
      assert.ok(bodies.some((body) => body.details?.code === "copilot_pending_action_not_pending"));
      assert.equal(new CopilotRepository(db, userId).getPendingAction(actionId)?.status, "approved");
      assert.equal(auditLogs.length, 1);
    } finally {
      release.resolve();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("approves canonical memory-write actions into redacted durable memory", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_memory_write", {
      kind: "decision",
      scope: "global",
      text: "Remember token=secret-value and provider SSOT.",
      metadata: { source: "route-test" }
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const entries = new CopilotMemoryRepository(db, userId).listEntries({ scope: "global" });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.sourceRunId, runId);
    assert.match(entries[0]?.redactedText ?? "", /token=\[REDACTED\]/);
    assert.doesNotMatch(entries[0]?.redactedText ?? "", /secret-value/);
    assert.equal(
      (res.body.data.action.result as { entry: { id: string } }).entry.id,
      entries[0]?.id
    );
  });

  it("approves canonical memory-delete actions without crossing tenants", async () => {
    const memory = new CopilotMemoryRepository(db, userId);
    const entry = memory.createEntry({
      kind: "decision",
      scope: "global",
      text: "Outdated Copilot memory."
    });
    const foreignEntry = new CopilotMemoryRepository(db, otherUserId).createEntry({
      kind: "decision",
      scope: "global",
      text: "Foreign memory must remain."
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_memory_delete", {
      id: entry.id,
      type: "entry",
      reason: "No longer accurate."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(new CopilotMemoryRepository(db, userId).getEntry(entry.id), undefined);
    assert.equal(new CopilotMemoryRepository(db, otherUserId).getEntry(foreignEntry.id)?.id, foreignEntry.id);
    assert.equal(res.body.data.action.result.deleted.id, entry.id);
    assert.equal(res.body.data.action.result.deleted.type, "entry");
  });

  it("writes a redacted audit log when approving a Copilot pending action", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_memory_write", {
      kind: "decision",
      scope: "global",
      text: "Remember token=secret-value and provider SSOT.",
      metadata: { apiKey: "sk-secret-value" }
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const auditLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.pending_action.approve",
      resourceType: "copilot_run",
      resourceId: runId
    });
    const details = JSON.parse(auditLogs[0]?.details ?? "{}") as {
      actionId?: string;
      actionType?: string;
      decision?: string;
      approvedBy?: string;
      input?: { text?: string; metadata?: { apiKey?: string } };
      result?: { entry?: { id?: string } };
    };

    assert.equal(res.status, 200);
    assert.equal(auditLogs.length, 1);
    assert.equal(details.actionId, actionId);
    assert.equal(details.actionType, "openforge.propose_memory_write");
    assert.equal(details.decision, "approved");
    assert.equal(details.approvedBy, userId);
    assert.equal(details.input?.text, "Remember token=[REDACTED] and provider SSOT.");
    assert.equal(details.input?.metadata?.apiKey, "[REDACTED]");
    assert.equal(details.result?.entry?.id, res.body.data.action.result.entry.id);
    assert.doesNotMatch(JSON.stringify(details), /secret-value/);
    assert.doesNotMatch(JSON.stringify(details), /sk-secret-value/);
  });

  it("completes waiting runs and records an event after approving the last pending action", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_diagnostics_export");

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const repo = new CopilotRepository(db, userId);
    const events = repo.listEvents(runId);
    const auditLogs = new AuditLogRepository(db, userId).list({
      action: "copilot.run.complete",
      resourceType: "copilot_run",
      resourceId: runId
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(typeof res.body.data.run.completedAt, "number");
    assert.equal(repo.getRun(runId)?.status, "completed");
    assert.equal(events.at(-1)?.type, "pending_action_approved");
    assert.equal(events.at(-1)?.message, "openforge.propose_diagnostics_export");
    assert.equal(auditLogs.length, 1);
  });

  it("approves session-create actions for all primary AI CLIs", async () => {
    const cases: Array<{ aiTool: "claude" | "opencode" | "codex"; name: string; command: string }> = [
      { aiTool: "claude", name: "Copilot Claude Code", command: "claude" },
      { aiTool: "opencode", name: "Copilot OpenCode", command: "opencode" },
      { aiTool: "codex", name: "Copilot Codex", command: "codex" }
    ];

    for (const testCase of cases) {
      const projectPath = path.join(tmpdir(), `openforge-copilot-create-${testCase.aiTool}`);
      mkdirSync(projectPath, { recursive: true });
      const project = new ProjectRepository(db, userId).create({
        name: `OpenForge ${testCase.aiTool}`,
        path: projectPath,
        aiTool: testCase.aiTool
      });
      const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_create", {
        projectId: project.id,
        aiTool: testCase.aiTool,
        name: testCase.name
      });

      const res = await makeRequest(
        app,
        "POST",
        `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
        undefined,
        authHeaders()
      );

      const sessions = new SessionRepository(db, userId).listByProject(project.id);
      const createdSession = createdSessionInputs.at(-1);
      assert.equal(res.status, 200);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.action.status, "approved");
      assert.equal(res.body.data.action.result.executed, true);
      assert.equal(res.body.data.action.result.session.name, testCase.name);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0]?.status, "running");
      assert.equal(sessions[0]?.aiTool, testCase.aiTool);
      assert.equal(createdSession?.sessionId, sessions[0]?.id);
      assert.equal(createdSession?.cwd, projectPath);
      assert.equal(createdSession?.command, testCase.command);
    }
  });

  it("continues the Copilot run after approving a direct session-create action", async () => {
    const providerId = createOpenAiProvider();
    const model = new ModelProviderRepository(db, userId, masterKey).listModelProfiles(providerId)[0];
    assert.ok(model);
    modelEventResponses = [[{
      type: "assistant_message",
      text: "Claude Code session is running and ready for the next instruction."
    }]];
    const projectPath = path.join(tmpdir(), `openforge-copilot-direct-session-${randomSuffix()}`);
    mkdirSync(projectPath, { recursive: true });
    const project = new ProjectRepository(db, userId).create({
      name: "Direct Session",
      path: projectPath,
      aiTool: "claude"
    });
    const repo = new CopilotRepository(db, userId);
    const run = repo.createRun({
      status: "waiting_for_approval",
      providerProfileId: providerId,
      modelProfileId: model.id,
      source: "copilot",
      goal: "Create a Claude Code session"
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_session_create",
      input: {
        projectId: project.id,
        aiTool: "claude",
        name: "Claude Code"
      }
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/pending-actions/${action.id}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.input ?? "", /openforge\.propose_session_create returned/);
    assert.match(JSON.stringify(res.body), /Claude Code session is running and ready/);
    assert.equal(new SessionRepository(db, userId).listByProject(project.id).length, 1);
  });

  it("approves project-create actions by creating the project root and record", async () => {
    const projectPath = path.join(tmpdir(), `openforge-copilot-project-${randomSuffix()}`);
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_create", {
      name: "Copilot Created Project",
      path: projectPath,
      aiTool: "claude",
      description: "Created through approval",
      techStack: "TypeScript"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const projects = new ProjectRepository(db, userId).list();
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.project.name, "Copilot Created Project");
    assert.equal(res.body.data.action.result.project.path, projectPath);
    assert.equal(res.body.data.action.result.project.aiTool, "claude");
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.path, projectPath);
    assert.equal(projects[0]?.description, "Created through approval");
    assert.equal(existsSync(projectPath), true);
  });

  it("approves project-import actions by importing an existing project directory", async () => {
    const projectPath = path.join(tmpdir(), `openforge-copilot-import-${randomSuffix()}`);
    mkdirSync(projectPath, { recursive: true });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_import", {
      name: "Imported Project",
      path: projectPath,
      aiTool: "opencode",
      description: "Imported through approval",
      techStack: "TypeScript"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const projects = new ProjectRepository(db, userId).list();
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.project.name, "Imported Project");
    assert.equal(res.body.data.action.result.project.path, projectPath);
    assert.equal(res.body.data.action.result.project.aiTool, "opencode");
    assert.equal(res.body.data.action.result.project.isImported, true);
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.path, projectPath);
    assert.equal(projects[0]?.isImported, true);
  });

  it("approves project-delete actions by deleting a project and stopping its running sessions", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const session = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-user123-session_abcdef"
    });
    sessionRepo.update(session.id, { status: "running" });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_delete", {
      projectId: project.id,
      reason: "User asked to remove it."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.project.id, project.id);
    assert.equal(res.body.data.action.result.stoppedSessionCount, 1);
    assert.equal(new ProjectRepository(db, userId).getById(project.id), undefined);
    assert.deepEqual(stoppedSessionInputs, [{
      sessionId: session.id,
      tmuxName: "of-user123-session_abcdef",
      userId
    }]);
  });

  it("approves project-config-sync actions by writing generated project config", async () => {
    const projectPath = path.join(tmpdir(), `openforge-copilot-config-${randomSuffix()}`);
    mkdirSync(projectPath, { recursive: true });
    const project = new ProjectRepository(db, userId).create({
      name: "Config Sync",
      path: projectPath,
      aiTool: "claude"
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_config_sync", {
      projectId: project.id,
      credentialMode: "host_environment"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.summary.totalFiles > 0, true);
    assert.equal(res.body.data.action.result.result.writtenFiles.length > 0, true);
    assert.equal(existsSync(path.join(projectPath, ".claude", "settings.json")), true);
  });

  it("approves session-input actions by sending input to the running terminal session", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const session = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-user123-session_abcdef"
    });
    sessionRepo.update(session.id, { status: "running" });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_input", {
      sessionId: session.id,
      input: "pwd",
      submit: true
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.sessionId, session.id);
    assert.equal(res.body.data.action.result.submitted, true);
    assert.equal(res.body.data.action.result.terminal.available, true);
    assert.match(res.body.data.action.result.terminal.text, /Current task is complete/);
    assert.deepEqual(capturedSessionIds, [session.id]);
    assert.equal(res.body.data.events.at(-1)?.type, "pending_action_approved");
    assert.match(
      String((res.body.data.events.at(-1)?.payload.result as { terminal?: { text?: string } } | undefined)?.terminal?.text),
      /Current task is complete/
    );
    assert.deepEqual(sentSessionInputs, [{ sessionId: session.id, data: "pwd\n" }]);
  });

  it("approves session-input actions for OpenCode and Codex running terminal sessions", async () => {
    const sessionRepo = new SessionRepository(db, userId);
    const scenarios: Array<{ aiTool: "opencode" | "codex"; command: string }> = [
      { aiTool: "opencode", command: "opencode status" },
      { aiTool: "codex", command: "codex status" }
    ];

    for (const scenario of scenarios) {
      const project = new ProjectRepository(db, userId).create({
        name: `${scenario.aiTool} project`,
        path: `/tmp/openforge-${scenario.aiTool}`,
        aiTool: scenario.aiTool
      });
      const session = sessionRepo.create({
        projectId: project.id,
        name: `${scenario.aiTool} session`,
        aiTool: scenario.aiTool,
        workingDir: project.path,
        tmuxSession: `of-user123-${scenario.aiTool}`
      });
      sessionRepo.update(session.id, { status: "running" });
      const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_input", {
        sessionId: session.id,
        input: scenario.command,
        submit: true
      });

      const res = await makeRequest(
        app,
        "POST",
        `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
        undefined,
        authHeaders()
      );

      assert.equal(res.status, 200);
      assert.equal(res.body.code, 0);
      assert.equal(res.body.data.action.status, "approved");
      assert.equal(res.body.data.action.result.sessionId, session.id);
      assert.equal(res.body.data.action.result.submitted, true);
      assert.equal(res.body.data.action.result.terminal.available, true);
    }

    assert.deepEqual(sentSessionInputs, scenarios.map((scenario, index) => ({
      sessionId: capturedSessionIds[index],
      data: `${scenario.command}\n`
    })));
    assert.equal(capturedSessionIds.length, scenarios.length);
  });

  it("stores an assistant follow-up message after approving a session-input action from a conversation", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const session = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-user123-session_abcdef"
    });
    sessionRepo.update(session.id, { status: "running" });
    const repo = new CopilotRepository(db, userId);
    const conversation = repo.createConversation({
      title: "Drive session",
      source: "session",
      sourceRefId: session.id
    });
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "session",
      sourceRefId: session.id,
      goal: "Check working directory"
    });
    repo.createConversationMessage(conversation.id, {
      role: "user",
      content: "帮我在会话里执行 pwd",
      runId: run.id
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_session_input",
      input: {
        sessionId: session.id,
        input: "pwd",
        submit: true
      }
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/pending-actions/${action.id}/approve`,
      undefined,
      authHeaders()
    );

    const messages = repo.listConversationMessages(conversation.id);
    const assistant = messages.find((message) => message.role === "assistant");
    const runActivity = assistant?.payload.runActivity as { events?: Array<{ type?: string; payload?: unknown }> } | undefined;
    assert.equal(res.status, 200);
    assert.equal(assistant?.runId, run.id);
    assert.match(assistant?.content ?? "", /Terminal input was sent/);
    assert.deepEqual(runActivity?.events?.map((event) => event.type), ["pending_action_approved"]);
    assert.match(
      JSON.stringify(runActivity?.events?.[0]?.payload ?? {}),
      /Current task is complete/
    );
  });

  it("continues the Copilot run with the model after approving a conversation session-input action", async () => {
    const providerId = createOpenAiProvider();
    const model = new ModelProviderRepository(db, userId, masterKey).listModelProfiles(providerId)[0];
    assert.ok(model);
    modelEventResponses = [[{
      type: "assistant_message",
      text: "已发送到会话，并根据最新终端输出确认任务已完成。"
    }]];
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const session = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-user123-session_abcdef"
    });
    sessionRepo.update(session.id, { status: "running" });
    const repo = new CopilotRepository(db, userId);
    const conversation = repo.createConversation({
      title: "Drive session",
      source: "session",
      sourceRefId: session.id
    });
    const run = repo.createRun({
      status: "waiting_for_approval",
      providerProfileId: providerId,
      modelProfileId: model.id,
      source: "session",
      sourceRefId: session.id,
      goal: "帮我在会话里执行 pwd"
    });
    repo.createConversationMessage(conversation.id, {
      role: "user",
      content: "帮我在会话里执行 pwd",
      runId: run.id
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_session_input",
      input: {
        sessionId: session.id,
        input: "pwd",
        submit: true
      }
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${run.id}/pending-actions/${action.id}/approve`,
      undefined,
      authHeaders()
    );

    const messages = repo.listConversationMessages(conversation.id);
    const assistant = messages.find((message) => message.role === "assistant");
    const runActivity = assistant?.payload.runActivity as { events?: Array<{ type?: string }> } | undefined;
    assert.equal(res.status, 200);
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.input ?? "", /openforge\.propose_session_input returned/);
    assert.match(calls[0]?.input ?? "", /Current task is complete/);
    assert.equal(assistant?.content, "已发送到会话，并根据最新终端输出确认任务已完成。");
    assert.deepEqual(runActivity?.events?.map((event) => event.type), ["pending_action_approved"]);
  });

  it("approves session-stop actions by stopping the running terminal session", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const createdSession = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-user123-session_abcdef",
      attachToken: "secret-attach-token"
    });
    const session = sessionRepo.updateStatus(createdSession.id, "running") ?? createdSession;
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_stop", {
      sessionId: session.id,
      reason: "User asked to stop it."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const updated = new SessionRepository(db, userId).getById(session.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.session.status, "stopped");
    assert.equal(res.body.data.action.result.session.tmuxName, null);
    assert.equal(updated?.status, "stopped");
    assert.equal(updated?.attachToken, "");
    assert.equal(updated?.tmuxSession, null);
    assert.deepEqual(stoppedSessionInputs, [{
      sessionId: session.id,
      tmuxName: "of-user123-session_abcdef",
      userId
    }]);
  });

  it("approves session-delete actions by stopping and deleting a running terminal session", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const createdSession = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: "/tmp/openforge",
      tmuxSession: "of-user123-session_delete",
      attachToken: "secret-attach-token"
    });
    const session = sessionRepo.updateStatus(createdSession.id, "running") ?? createdSession;
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_delete", {
      sessionId: session.id,
      reason: "User asked to delete it."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.session.id, session.id);
    assert.equal(res.body.data.action.result.stopped, true);
    assert.equal(new SessionRepository(db, userId).getById(session.id), undefined);
    assert.deepEqual(stoppedSessionInputs, [{
      sessionId: session.id,
      tmuxName: "of-user123-session_delete",
      userId
    }]);
  });

  it("approves skill-toggle actions by enabling or disabling a user-owned skill", async () => {
    const skill = new SkillRepository(db, userId).create({
      name: "debugging",
      content: "Use systematic debugging.",
      isEnabled: false
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_skill_toggle", {
      skillId: skill.id,
      enabled: true,
      reason: "User asked to enable it."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const updated = new SkillRepository(db, userId).getById(skill.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.skill.id, skill.id);
    assert.equal(res.body.data.action.result.skill.isEnabled, true);
    assert.equal(updated?.isEnabled, true);
  });

  it("approves plugin-toggle actions by enabling or disabling a user-owned plugin state", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_plugin_toggle", {
      pluginId: "claude-safe-edits",
      enabled: true,
      reason: "Enable safer Claude edits."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const updated = new PluginRepository(db, userId).getByPluginId("claude-safe-edits");
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.plugin.id, "claude-safe-edits");
    assert.equal(res.body.data.action.result.plugin.status, "enabled");
    assert.equal(updated?.status, "enabled");
  });

  it("approves project skill-toggle actions by overriding skill state for one project", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const skill = new SkillRepository(db, userId).create({
      name: "debugging",
      content: "Use systematic debugging.",
      isEnabled: false
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_skill_toggle", {
      projectId: project.id,
      skillId: skill.id,
      enabled: true,
      reason: "Use this skill for OpenForge."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const projectSkills = new ProjectSkillRepository(db, userId).listByProject(project.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.projectSkill.projectId, project.id);
    assert.equal(res.body.data.action.result.projectSkill.skillId, skill.id);
    assert.equal(res.body.data.action.result.projectSkill.isEnabled, true);
    assert.equal(projectSkills.find((item) => item.skillId === skill.id)?.selectionState, "project_enabled");
  });

  it("approves agent-create actions by creating a user-owned agent", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge-agent-create",
      aiTool: "claude"
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_agent_create", {
      projectId: project.id,
      name: "Debugger",
      description: "Debugs failing tests",
      tools: "read,search",
      allowedDirs: "/tmp/openforge-agent-create",
      customPrompt: "Use systematic debugging.",
      reason: "User asked to create it."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const agents = new AgentRepository(db, userId).list();
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.agent.name, "Debugger");
    assert.equal(res.body.data.action.result.agent.projectId, project.id);
    assert.equal(res.body.data.action.result.agent.customPromptPreview, "Use systematic debugging.");
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.name, "Debugger");
  });

  it("approves agent-update actions by changing a user-owned agent", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge-agent-update",
      aiTool: "claude"
    });
    const agent = new AgentRepository(db, userId).create({
      projectId: project.id,
      name: "Reviewer",
      description: "Reviews code",
      tools: "read"
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_agent_update", {
      agentId: agent.id,
      name: "Code Reviewer",
      status: "disabled",
      tools: "read,search",
      reason: "Pause and expand tools."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const updated = new AgentRepository(db, userId).getById(agent.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.agent.id, agent.id);
    assert.equal(res.body.data.action.result.agent.name, "Code Reviewer");
    assert.equal(res.body.data.action.result.agent.status, "disabled");
    assert.equal(updated?.name, "Code Reviewer");
    assert.equal(updated?.status, "disabled");
    assert.equal(updated?.tools, "read,search");
  });

  it("approves agent-delete actions by deleting a user-owned agent", async () => {
    const agent = new AgentRepository(db, userId).create({
      name: "Temporary Reviewer",
      description: "Temporary",
      tools: "read"
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_agent_delete", {
      agentId: agent.id,
      reason: "No longer needed."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.agent.id, agent.id);
    assert.equal(new AgentRepository(db, userId).getById(agent.id), undefined);
  });

  it("approves template-create actions by creating a custom template", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_template_create", {
      name: "OpenCode Starter",
      description: "Starter config",
      version: "1.2.0",
      visibility: "private",
      files: [{ filePath: "AGENTS.md", content: "# Agents", fileType: "markdown" }],
      reason: "User asked to create it."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const templates = new TemplateRepository(db, userId).list();
    const created = new TemplateRepository(db, userId).getById(res.body.data.action.result.template.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.template.name, "OpenCode Starter");
    assert.equal(res.body.data.action.result.template.fileCount, 1);
    assert.equal(templates.length, 1);
    assert.equal(created?.files?.[0]?.filePath, "AGENTS.md");
  });

  it("approves template-update actions by updating a custom template", async () => {
    const template = new TemplateRepository(db, userId).create({
      name: "Claude Starter",
      description: "Starter config",
      files: [{ filePath: "CLAUDE.md", content: "# Claude", fileType: "markdown" }]
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_template_update", {
      templateId: template.id,
      name: "Claude Starter v2",
      status: "disabled",
      reason: "Archive this template."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const updated = new TemplateRepository(db, userId).getById(template.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.template.id, template.id);
    assert.equal(res.body.data.action.result.template.name, "Claude Starter v2");
    assert.equal(res.body.data.action.result.template.status, "disabled");
    assert.equal(updated?.name, "Claude Starter v2");
    assert.equal(updated?.status, "disabled");
  });

  it("approves template-delete actions by deleting a custom template", async () => {
    const template = new TemplateRepository(db, userId).create({
      name: "Temporary Template",
      files: [{ filePath: "README.md", content: "# Temp", fileType: "markdown" }]
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_template_delete", {
      templateId: template.id,
      reason: "No longer needed."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.template.id, template.id);
    assert.equal(new TemplateRepository(db, userId).getById(template.id), undefined);
  });

  it("approves session-start actions by starting an existing stopped terminal session", async () => {
    const projectPath = path.join(tmpdir(), "openforge-copilot-start");
    mkdirSync(projectPath, { recursive: true });
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: projectPath,
      aiTool: "claude"
    });
    const sessionRepo = new SessionRepository(db, userId);
    const session = sessionRepo.create({
      projectId: project.id,
      name: "Claude Code",
      aiTool: "claude",
      workingDir: projectPath
    });
    sessionRepo.update(session.id, { status: "stopped" });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_start", {
      sessionId: session.id,
      reason: "User asked to resume it."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const updated = new SessionRepository(db, userId).getById(session.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.session.status, "running");
    assert.equal(updated?.status, "running");
    assert.equal(updated?.tmuxSession, res.body.data.action.result.session.tmuxName);
    assert.equal(createdSessionInputs.length, 1);
    assert.equal(createdSessionInputs[0]?.sessionId, session.id);
    assert.equal(createdSessionInputs[0]?.cwd, projectPath);
  });

  it("approves Copilot model-selection actions by setting the default model", async () => {
    const existingProviderId = createOpenAiProvider(userId, { isDefault: true, providerKey: "openai" });
    const targetProviderId = createOpenAiProvider(userId, { isDefault: false, providerKey: "anthropic" });
    const providerRepo = new ModelProviderRepository(db, userId, masterKey);
    const existingModel = providerRepo.listModelProfiles(existingProviderId)[0];
    const targetModel = providerRepo.listModelProfiles(targetProviderId)[0];
    assert.ok(existingModel);
    assert.ok(targetModel);
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_copilot_model_selection", {
      providerProfileId: targetProviderId,
      modelProfileId: targetModel.id,
      reason: "Use Anthropic for Copilot."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const updatedRepo = new ModelProviderRepository(db, userId, masterKey);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.selection.providerProfileId, targetProviderId);
    assert.equal(res.body.data.action.result.selection.modelProfileId, targetModel.id);
    assert.equal(updatedRepo.getModelProfile(targetModel.id)?.isDefault, true);
    assert.equal(updatedRepo.getModelProfile(existingModel.id)?.isDefault, false);
  });

  it("approves model-provider sync actions by fetching models with a saved credential", async () => {
    const providerRepo = new ModelProviderRepository(db, userId, masterKey);
    const provider = providerRepo.createProviderProfile({
      name: "MiniMax China",
      providerKey: "minimax-cn",
      baseUrl: "https://api.minimax.chat/v1",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude", "opencode"]
    });
    const credential = providerRepo.createCredential({
      providerProfileId: provider.id,
      plaintextSecret: "sk-minimax-secret"
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_model_provider_sync", {
      providerProfileId: provider.id,
      credentialId: credential.id,
      timeoutMs: 5000,
      reason: "Sync MiniMax models."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const models = new ModelProviderRepository(db, userId, masterKey).listModelProfiles(provider.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.provider.id, provider.id);
    assert.equal(res.body.data.action.result.fetchedCount, 2);
    assert.equal(res.body.data.action.result.createdCount, 2);
    assert.deepEqual(models.map((model) => model.modelId), ["MiniMax-M2", "MiniMax-Text-01"]);
    assert.deepEqual(providerModelFetchInputs, [{
      baseUrl: "https://api.minimax.chat/v1",
      apiKey: "sk-minimax-secret",
      modelsUrl: "https://api.minimax.chat/v1/models",
      timeoutMs: 5000
    }]);
    assert.equal(JSON.stringify(res.body).includes("sk-minimax-secret"), false);
  });

  it("approves model-provider apply actions by writing Claude Code project config", async () => {
    const projectRoot = path.join(tmpdir(), `openforge-copilot-provider-apply-${randomSuffix()}`);
    mkdirSync(projectRoot, { recursive: true });
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: projectRoot,
      aiTool: "claude"
    });
    const providerRepo = new ModelProviderRepository(db, userId, masterKey);
    const provider = providerRepo.createProviderProfile({
      name: "MiniMax China",
      providerKey: "minimax-cn",
      baseUrl: "https://api.minimax.chat/v1",
      anthropicBaseUrl: "https://api.minimax.chat/anthropic",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["claude", "opencode"]
    });
    const model = providerRepo.createModelProfile({
      providerProfileId: provider.id,
      name: "MiniMax M2",
      modelId: "MiniMax-M2"
    });
    const credential = providerRepo.createCredential({
      providerProfileId: provider.id,
      plaintextSecret: "sk-minimax-secret"
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_model_provider_apply", {
      adapter: "claude",
      projectId: project.id,
      providerProfileId: provider.id,
      modelProfileId: model.id,
      credentialId: credential.id,
      reason: "Use MiniMax for Claude Code."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const configPath = path.join(projectRoot, ".claude", "settings.local.json");
    const content = readFileSync(configPath, "utf8");
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.action.result.executed, true);
    assert.equal(res.body.data.action.result.adapter, "claude");
    assert.equal(res.body.data.action.result.projectId, project.id);
    assert.deepEqual(res.body.data.action.result.changedFiles, [{
      relativePath: ".claude/settings.local.json",
      operation: "create"
    }]);
    assert.match(res.body.data.action.result.backupPath, /\.openforge\/backups\/model-provider-apply/);
    assert.match(content, /MiniMax-M2/);
    assert.match(content, /ANTHROPIC_AUTH_TOKEN/);
    assert.doesNotMatch(content, /sk-minimax-secret/);
  });

  it("does not approve invalid stored memory-write actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_memory_write", {
      kind: "decision",
      scope: "global"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_memory_write_invalid");
    assert.equal(action?.status, "pending");
    assert.equal(new CopilotMemoryRepository(db, userId).listEntries({}).length, 0);
  });

  it("does not approve invalid stored session-create actions", async () => {
    const project = new ProjectRepository(db, userId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_create", {
      projectId: project.id,
      aiTool: "shell",
      name: "Invalid draft"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_session_draft_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve invalid stored session-stop actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_stop", {
      reason: "Missing session id"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_session_stop_invalid");
    assert.equal(action?.status, "pending");
    assert.deepEqual(stoppedSessionInputs, []);
  });

  it("does not approve invalid stored session-delete actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_delete", {
      reason: "Missing session id"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_session_delete_invalid");
    assert.equal(action?.status, "pending");
    assert.deepEqual(stoppedSessionInputs, []);
  });

  it("does not approve invalid stored skill-toggle actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_skill_toggle", {
      enabled: true
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_skill_toggle_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve invalid stored plugin-toggle actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_plugin_toggle", {
      enabled: true
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_plugin_toggle_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve invalid stored project skill-toggle actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_skill_toggle", {
      skillId: "missing",
      enabled: true
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_project_skill_toggle_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve invalid stored agent management actions", async () => {
    const invalidCreate = createPendingAction(userId, "openforge.propose_agent_create", {
      name: ""
    });
    const invalidUpdate = createPendingAction(userId, "openforge.propose_agent_update", {
      agentId: "missing",
      status: "archived"
    });
    const invalidDelete = createPendingAction(userId, "openforge.propose_agent_delete", {
      reason: "Missing agent id"
    });

    const createRes = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${invalidCreate.runId}/pending-actions/${invalidCreate.actionId}/approve`,
      undefined,
      authHeaders()
    );
    const updateRes = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${invalidUpdate.runId}/pending-actions/${invalidUpdate.actionId}/approve`,
      undefined,
      authHeaders()
    );
    const deleteRes = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${invalidDelete.runId}/pending-actions/${invalidDelete.actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(createRes.status, 400);
    assert.equal(createRes.body.details.code, "copilot_agent_create_invalid");
    assert.equal(updateRes.status, 400);
    assert.equal(updateRes.body.details.code, "copilot_agent_update_invalid");
    assert.equal(deleteRes.status, 400);
    assert.equal(deleteRes.body.details.code, "copilot_agent_delete_invalid");
    assert.equal(new CopilotRepository(db, userId).getPendingAction(invalidCreate.actionId)?.status, "pending");
    assert.equal(new CopilotRepository(db, userId).getPendingAction(invalidUpdate.actionId)?.status, "pending");
    assert.equal(new CopilotRepository(db, userId).getPendingAction(invalidDelete.actionId)?.status, "pending");
  });

  it("does not approve invalid stored template management actions", async () => {
    const invalidCreate = createPendingAction(userId, "openforge.propose_template_create", {
      name: "",
      files: [{ filePath: "AGENTS.md", content: "# Agents" }]
    });
    const invalidUpdate = createPendingAction(userId, "openforge.propose_template_update", {
      templateId: "missing",
      status: "archived"
    });
    const invalidDelete = createPendingAction(userId, "openforge.propose_template_delete", {
      reason: "Missing template id"
    });

    const createRes = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${invalidCreate.runId}/pending-actions/${invalidCreate.actionId}/approve`,
      undefined,
      authHeaders()
    );
    const updateRes = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${invalidUpdate.runId}/pending-actions/${invalidUpdate.actionId}/approve`,
      undefined,
      authHeaders()
    );
    const deleteRes = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${invalidDelete.runId}/pending-actions/${invalidDelete.actionId}/approve`,
      undefined,
      authHeaders()
    );

    assert.equal(createRes.status, 400);
    assert.equal(createRes.body.details.code, "copilot_template_create_invalid");
    assert.equal(updateRes.status, 400);
    assert.equal(updateRes.body.details.code, "copilot_template_update_invalid");
    assert.equal(deleteRes.status, 400);
    assert.equal(deleteRes.body.details.code, "copilot_template_delete_invalid");
    assert.equal(new CopilotRepository(db, userId).getPendingAction(invalidCreate.actionId)?.status, "pending");
    assert.equal(new CopilotRepository(db, userId).getPendingAction(invalidUpdate.actionId)?.status, "pending");
    assert.equal(new CopilotRepository(db, userId).getPendingAction(invalidDelete.actionId)?.status, "pending");
  });

  it("does not approve invalid stored session-start actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_start", {
      reason: "Missing session id"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_session_start_invalid");
    assert.equal(action?.status, "pending");
    assert.equal(createdSessionInputs.length, 0);
  });

  it("does not approve invalid stored Copilot model-selection actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_copilot_model_selection", {
      providerProfileId: "missing-provider",
      modelProfileId: "missing-model"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_model_selection_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve invalid stored model-provider sync actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_model_provider_sync", {
      providerProfileId: "missing-provider"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_model_provider_sync_invalid");
    assert.equal(action?.status, "pending");
    assert.deepEqual(providerModelFetchInputs, []);
  });

  it("does not approve invalid stored model-provider apply actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_model_provider_apply", {
      adapter: "claude",
      providerProfileId: "missing-provider",
      modelProfileId: "missing-model",
      projectId: "missing-project"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_model_provider_apply_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve invalid stored project-create actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_create", {
      name: "Invalid Project",
      path: path.join(tmpdir(), `openforge-invalid-project-${randomSuffix()}`),
      aiTool: "shell"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_project_create_invalid");
    assert.equal(action?.status, "pending");
    assert.equal(new ProjectRepository(db, userId).list().length, 0);
  });

  it("does not approve invalid stored project-import actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_import", {
      name: "Missing Project",
      path: path.join(tmpdir(), `missing-copilot-import-${randomSuffix()}`),
      aiTool: "claude"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_project_import_failed");
    assert.equal(action?.status, "pending");
    assert.equal(new ProjectRepository(db, userId).list().length, 0);
  });

  it("does not approve invalid stored project-delete actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_delete", {
      projectId: "missing-project",
      reason: "User asked to remove it."
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_project_delete_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve invalid stored project-config-sync actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_config_sync", {
      projectId: "missing-project",
      credentialMode: "host_environment"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_project_config_sync_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve session-create actions when the target project is gone", async () => {
    const projects = new ProjectRepository(db, userId);
    const project = projects.create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_session_create", {
      projectId: project.id,
      aiTool: "claude",
      name: "Stale draft"
    });
    projects.delete(project.id);

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_session_draft_invalid");
    assert.equal(action?.status, "pending");
  });

  it("does not approve unknown stored pending-action types", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_shell_command", {
      command: "echo unsafe"
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_pending_action_unsupported");
    assert.equal(action?.status, "pending");
  });

  it("does not approve invalid stored troubleshooting-step actions", async () => {
    const { runId, actionId } = createPendingAction(userId, "openforge.propose_troubleshooting_steps", {
      steps: []
    });

    const res = await makeRequest(
      app,
      "POST",
      `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
      undefined,
      authHeaders()
    );

    const action = new CopilotRepository(db, userId).getPendingAction(actionId);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_troubleshooting_steps_invalid");
    assert.equal(action?.status, "pending");
  });

  function createOpenAiProvider(
    ownerId = userId,
    options: { isDefault?: boolean; providerKey?: "openai" | "anthropic"; withCredential?: boolean } = {}
  ): string {
    const providerKey = options.providerKey ?? "openai";
    const repo = new ModelProviderRepository(db, ownerId, masterKey);
    const provider = repo.createProviderProfile({
      providerKey,
      name: providerKey === "anthropic" ? "Anthropic" : "OpenAI",
      baseUrl: providerKey === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat: providerKey,
      supportedAdapters: ["opencode"]
    });
    repo.createModelProfile({
      providerProfileId: provider.id,
      name: providerKey === "anthropic" ? "Claude" : "GPT",
      modelId: providerKey === "anthropic" ? "claude-sonnet-4-5" : "gpt-5.1",
      isDefault: options.isDefault ?? true
    });
    if (options.withCredential !== false) {
      repo.createCredential({
        providerProfileId: provider.id,
        plaintextSecret: providerKey === "anthropic" ? "sk-ant" : "sk-openai"
      });
    }
    return provider.id;
  }

  function disableProvider(providerId: string): void {
    db.prepare(`
      UPDATE model_provider_profiles
      SET status = 'disabled'
      WHERE id = ? AND user_id = ?
    `).run(providerId, userId);
  }

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
  }

  function otherAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${otherToken}`,
      "Content-Type": "application/json"
    };
  }

  function createPendingAction(ownerId: string, type: string, input: Record<string, unknown> = { reason: "test" }) {
    const repo = new CopilotRepository(db, ownerId);
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Approve action"
    });
    const action = repo.createPendingAction(run.id, {
      type,
      input
    });
    return { runId: run.id, actionId: action.id };
  }

  function randomSuffix(): string {
    return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
});

function fakeModelClient(
  calls: CopilotModelRequest[],
  events: (
    request: CopilotModelRequest,
    options?: CopilotModelRequestOptions
  ) => CopilotModelEvent[] | Promise<CopilotModelEvent[]>
): CopilotModelClient {
  return {
    async createResponse(request: CopilotModelRequest, options?: CopilotModelRequestOptions) {
      calls.push(request);
      return await events(request, options);
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
}

async function makeRequest(
  app: express.Express,
  method: string,
  pathName: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  try {
    const res = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const responseBody = await res.json().catch(() => ({}));
    return { status: res.status, body: responseBody };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function readRequestJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) as unknown : {};
}

async function listen(server: http.Server): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
