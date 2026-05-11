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
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/copilot", createCopilotRoutes({
      db,
      masterKey,
      modelClientFactory: () => fakeModelClient(calls, () => modelEvents)
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
    assert.equal(res.body.data.events[0].type, "assistant_message");
    assert.equal(res.body.data.events[0].message, "Gateway is healthy.");
    assert.equal(calls[0]?.input, "Summarize Gateway health");
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
    assert.equal(res.body.data.run.completedAt, null);
    assert.equal(res.body.data.pendingActions.length, 1);
    assert.equal(res.body.data.pendingActions[0].type, "openforge.propose_memory_write");
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

  function createOpenAiProvider(): void {
    const repo = new ModelProviderRepository(db, userId, masterKey);
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
  events: () => CopilotModelEvent[]
): CopilotModelClient {
  return {
    async createResponse(request) {
      calls.push(request);
      return events();
    }
  };
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
