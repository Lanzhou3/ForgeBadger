import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { CopilotMemoryRepository } from "../src/db/repositories/copilot-memory-repository.js";
import { createCopilotRoutes } from "../src/routes/copilot.js";
import type { CopilotModelClient, CopilotModelEvent, CopilotModelRequest } from "../src/services/copilot/types.js";

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
  let modelResponseWait: Promise<void> | null;
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
    modelEvents = [{ type: "assistant_message", text: "Gateway is healthy." }];
    modelEventResponses = [];
    modelResponseWait = null;
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      modelClientFactory: () => fakeModelClient(calls, async () => {
        if (modelResponseWait) await modelResponseWait;
        const response = modelEventResponses.shift();
        if (response instanceof Error) throw response;
        return response ?? modelEvents;
      })
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
    assert.equal(res.body.data.readTools.includes("openforge.propose_session_create"), false);
  });

  it("reports Copilot provider readiness when a compatible provider is configured", async () => {
    createOpenAiProvider();

    const res = await makeRequest(app, "GET", "/api/v1/copilot/capabilities", undefined, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.providerConfigured, true);
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

  it("returns provider-not-configured when no compatible provider exists", async () => {
    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", { prompt: "Status?" }, authHeaders());

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
    assert.equal(res.body.details.code, "copilot_provider_not_configured");
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

  it("does not inject active memory recall outside the Copilot page source", async () => {
    createOpenAiProvider();
    new CopilotMemoryRepository(db, userId).createEntry({
      kind: "decision",
      scope: "global",
      text: "Provider SSOT is required for Copilot model configuration."
    });

    const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
      prompt: "How should provider SSOT work for Copilot?",
      source: "dashboard"
    }, authHeaders());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    assert.equal(calls[0]?.input, "How should provider SSOT work for Copilot?");
    assert.deepEqual(
      res.body.data.events.map((event: { type: string }) => event.type),
      ["assistant_message"]
    );
  });

  it("continues Copilot page runs without injected memory when active recall fails", async () => {
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
      ["assistant_message"]
    );
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
    assert.equal(calls[1]?.tools, undefined);
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
    assert.doesNotMatch(JSON.stringify(res.body), /sk-secret-value/);
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
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.run.status, "cancelled");
    assert.equal(action?.status, "rejected");
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
    assert.equal(res.status, 200);
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(typeof res.body.data.run.completedAt, "number");
    assert.equal(repo.getRun(runId)?.status, "completed");
    assert.equal(events.at(-1)?.type, "pending_action_rejected");
    assert.equal(events.at(-1)?.message, "openforge.propose_troubleshooting_steps");
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
    assert.equal(res.status, 200);
    assert.equal(res.body.data.action.status, "approved");
    assert.equal(res.body.data.run.status, "completed");
    assert.equal(typeof res.body.data.run.completedAt, "number");
    assert.equal(repo.getRun(runId)?.status, "completed");
    assert.equal(events.at(-1)?.type, "pending_action_approved");
    assert.equal(events.at(-1)?.message, "openforge.propose_diagnostics_export");
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

  function createOpenAiProvider(ownerId = userId): void {
    const repo = new ModelProviderRepository(db, ownerId, masterKey);
    const provider = repo.createProviderProfile({
      providerKey: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["opencode"]
    });
    repo.createModelProfile({
      providerProfileId: provider.id,
      name: "GPT",
      modelId: "gpt-5.1",
      isDefault: true
    });
    repo.createCredential({
      providerProfileId: provider.id,
      plaintextSecret: "sk-openai"
    });
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
});

function fakeModelClient(
  calls: CopilotModelRequest[],
  events: () => CopilotModelEvent[] | Promise<CopilotModelEvent[]>
): CopilotModelClient {
  return {
    async createResponse(request) {
      calls.push(request);
      return await events();
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
