import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import http from "node:http";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { AuditLogRepository } from "../src/db/repositories/audit-log-repository.js";
import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { FeishuIntegrationRepository } from "../src/db/repositories/feishu-integration-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import {
  getFeishuCliStatus,
  type FeishuCliCommandRunner
} from "../src/services/integrations/feishu-cli.js";
import type { CopilotModelRequest } from "../src/services/copilot/types.js";
import { createFeishuIntegrationRoutes } from "../src/routes/integrations-feishu.js";

const secret = "0123456789abcdef0123456789abcdef";

describe("getFeishuCliStatus", () => {
  it("reports lark-cli as unavailable without leaking stderr when discovery fails", async () => {
    const status = await getFeishuCliStatus({
      runner: async () => ({
        exitCode: 127,
        stdout: "",
        stderr: "command not found: lark-cli sk-secret"
      })
    });

    assert.deepEqual(status, {
      available: false,
      authState: "unknown",
      identityMode: "unknown",
      enabled: false,
      error: "Feishu CLI unavailable"
    });
    assert.equal(JSON.stringify(status).includes("sk-secret"), false);
  });

  it("parses version and structured auth status from allowlisted commands", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: FeishuCliCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (args.includes("--version")) {
        return { exitCode: 0, stdout: "@larksuite/cli 1.2.3\n", stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({ tokenStatus: "valid", identity: "user" }, null, 2),
        stderr: ""
      };
    };

    const status = await getFeishuCliStatus({ runner });

    assert.deepEqual(calls, [
      { command: "lark-cli", args: ["--version"] },
      { command: "lark-cli", args: ["auth", "status"] }
    ]);
    assert.deepEqual(status, {
      available: true,
      version: "@larksuite/cli 1.2.3",
      authState: "authenticated",
      identityMode: "user",
      enabled: false
    });
  });

  it("parses structured auth status after progress lines", async () => {
    const status = await getFeishuCliStatus({
      runner: async (_command, args) => {
        if (args.includes("--version")) {
          return { exitCode: 0, stdout: "lark-cli 1.2.3\n", stderr: "" };
        }
        return {
          exitCode: 0,
          stdout: "checking auth\n{\"tokenStatus\":\"valid\",\"identity\":\"bot\"}\n",
          stderr: ""
        };
      }
    });

    assert.equal(status.authState, "authenticated");
    assert.equal(status.identityMode, "bot");
  });

  it("fails closed when auth status output is not structured JSON", async () => {
    const status = await getFeishuCliStatus({
      runner: async (_command, args) => {
        if (args.includes("--version")) {
          return { exitCode: 0, stdout: "lark-cli 0.9.0\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "logged in as someone@example.com", stderr: "" };
      }
    });

    assert.deepEqual(status, {
      available: true,
      version: "lark-cli 0.9.0",
      authState: "unknown",
      identityMode: "unknown",
      enabled: false
    });
  });

  it("returns unavailable on timeout without leaking stderr", async () => {
    const status = await getFeishuCliStatus({
      runner: async () => ({
        exitCode: 124,
        stdout: "",
        stderr: "Command timed out after 3000ms with token sk-timeout-secret"
      })
    });

    assert.equal(status.available, false);
    assert.equal(status.authState, "unknown");
    assert.equal(status.identityMode, "unknown");
    assert.equal(status.enabled, false);
    assert.equal(JSON.stringify(status).includes("sk-timeout-secret"), false);
  });

  it("fails closed when the command runner throws", async () => {
    const status = await getFeishuCliStatus({
      runner: async () => {
        throw new Error("spawn failed with token sk-runner-secret");
      }
    });

    assert.deepEqual(status, {
      available: false,
      authState: "unknown",
      identityMode: "unknown",
      enabled: false,
      error: "Feishu CLI unavailable"
    });
    assert.equal(JSON.stringify(status).includes("sk-runner-secret"), false);
  });
});

describe("FeishuIntegrationRepository", () => {
  let db: Database;
  let owner: User;
  let other: User;

  beforeEach(() => {
    db = createTestDb();
    const users = new UserRepository(db);
    owner = users.create("owner@example.com", "hash");
    other = users.create("other@example.com", "hash");
  });

  it("keeps config tenant scoped and normalizes bounded allowed chat ids", () => {
    const ownerRepo = new FeishuIntegrationRepository(db, owner.id);
    const otherRepo = new FeishuIntegrationRepository(db, other.id);

    const config = ownerRepo.upsertConfig({
      enabled: true,
      emergencyDisabled: false,
      identityMode: "user",
      allowedChatIds: [" chat-a ", "chat-a", "chat-b", ""],
      commandPrefix: "/of"
    });

    assert.deepEqual(config.allowedChatIds, ["chat-a", "chat-b"]);
    assert.equal(config.enabled, true);
    assert.equal(config.emergencyDisabled, false);
    assert.equal(config.commandPrefix, "/of");
    assert.equal(ownerRepo.canExecuteActions(), true);
    assert.deepEqual(otherRepo.getConfig(), {
      enabled: false,
      emergencyDisabled: false,
      identityMode: "unknown",
      allowedChatIds: [],
      commandPrefix: "/openforge",
      publicWebhookId: null,
      publicWebhookEnabled: false,
      webhookConfiguredAt: null
    });

    ownerRepo.upsertConfig({ emergencyDisabled: true });
    assert.equal(ownerRepo.canExecuteActions(), false);
    ownerRepo.upsertConfig({ enabled: false, emergencyDisabled: false });
    assert.equal(ownerRepo.canExecuteActions(), false);
  });

  it("rejects oversized allowed chat id lists", () => {
    const repo = new FeishuIntegrationRepository(db, owner.id);
    assert.throws(
      () => repo.upsertConfig({ allowedChatIds: Array.from({ length: 51 }, (_, index) => `chat-${index}`) }),
      /allowed chat ids/i
    );
  });

  it("keeps user mappings tenant scoped and bounded", () => {
    const ownerRepo = new FeishuIntegrationRepository(db, owner.id);
    const otherRepo = new FeishuIntegrationRepository(db, other.id);

    ownerRepo.replaceUserMappings([
      { feishuUserId: " ou_1 ", openforgeUserId: owner.id, displayName: "Owner" },
      { feishuUserId: "ou_2", openforgeUserId: owner.id }
    ]);

    assert.deepEqual(ownerRepo.listUserMappings().map((mapping) => ({
      feishuUserId: mapping.feishuUserId,
      openforgeUserId: mapping.openforgeUserId,
      displayName: mapping.displayName
    })), [
      { feishuUserId: "ou_1", openforgeUserId: owner.id, displayName: "Owner" },
      { feishuUserId: "ou_2", openforgeUserId: owner.id, displayName: null }
    ]);
    assert.deepEqual(otherRepo.listUserMappings(), []);
    assert.throws(
      () => ownerRepo.replaceUserMappings(Array.from({ length: 101 }, (_, index) => ({
        feishuUserId: `ou_${index}`,
        openforgeUserId: owner.id
      }))),
      /user mappings/i
    );
  });

  it("does not persist secret-like columns for Feishu integration data", () => {
    const rows = [
      ...db.prepare("PRAGMA table_info(integration_feishu_configs)").all(),
      ...db.prepare("PRAGMA table_info(integration_feishu_user_mappings)").all()
    ] as Array<{ name: string }>;

    assert.equal(rows.length > 0, true);
    const sensitiveColumns = rows
      .map((row) => row.name)
      .filter((name) => /secret|token|credential|cookie|password/i.test(name));
    assert.deepEqual(sensitiveColumns, ["verification_token_encrypted"]);
  });
});

describe("Feishu integration routes", () => {
  it("returns authenticated read-only Feishu integration status", async () => {
    const app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
      getStatus: async () => ({
        available: true,
        version: "lark-cli 1.2.3",
        authState: "authenticated",
        identityMode: "user",
        enabled: false
      })
    }));

    const token = signJwt({ userId: "user-1", email: "route@example.com" }, secret);
    const res = await makeRequest(app, "GET", "/api/v1/integrations/feishu/status", undefined, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      code: 0,
      data: {
        status: {
          available: true,
          version: "lark-cli 1.2.3",
          authState: "authenticated",
          identityMode: "user",
          enabled: false
        }
      },
      message: ""
    });
  });

  it("reads and updates tenant-scoped Feishu integration config with an audit log", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("route-owner@example.com", "hash");
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const defaultRes = await makeRequest(app, "GET", "/api/v1/integrations/feishu/config", undefined, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(defaultRes.status, 200);
    assert.deepEqual(defaultRes.body.data.config, {
      enabled: false,
      emergencyDisabled: false,
      identityMode: "unknown",
      allowedChatIds: [],
      commandPrefix: "/openforge",
      publicWebhookId: null,
      publicWebhookEnabled: false,
      webhookConfiguredAt: null
    });

    const updateRes = await makeRequest(app, "PATCH", "/api/v1/integrations/feishu/config", {
      enabled: true,
      identityMode: "bot",
      allowedChatIds: [" chat-1 ", "chat-1", "chat-2"],
      commandPrefix: "/of"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(updateRes.status, 200);
    assert.deepEqual(updateRes.body.data.config.allowedChatIds, ["chat-1", "chat-2"]);
    assert.equal(updateRes.body.data.config.enabled, true);
    assert.equal(updateRes.body.data.config.identityMode, "bot");

    const auditLogs = new AuditLogRepository(db, user.id).list({ action: "feishu.config.update" });
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].resourceType, "feishu_integration");
  });

  it("rejects invalid Feishu config payloads before persistence", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("invalid-route@example.com", "hash");
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "PATCH", "/api/v1/integrations/feishu/config", {
      allowedChatIds: Array.from({ length: 51 }, (_, index) => `chat-${index}`)
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 1);
  });

  it("replaces and lists tenant-scoped Feishu user mappings with an audit log", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("mapping-owner@example.com", "hash");
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const replaceRes = await makeRequest(app, "PUT", "/api/v1/integrations/feishu/user-mappings", {
      mappings: [
        { feishuUserId: " ou_route ", openforgeUserId: user.id, displayName: "Route Owner" }
      ]
    }, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(replaceRes.status, 200);
    assert.deepEqual(replaceRes.body.data.mappings.map((mapping: any) => ({
      feishuUserId: mapping.feishuUserId,
      openforgeUserId: mapping.openforgeUserId,
      displayName: mapping.displayName
    })), [
      { feishuUserId: "ou_route", openforgeUserId: user.id, displayName: "Route Owner" }
    ]);

    const listRes = await makeRequest(app, "GET", "/api/v1/integrations/feishu/user-mappings", undefined, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.mappings.length, 1);

    const auditLogs = new AuditLogRepository(db, user.id).list({ action: "feishu.user_mappings.replace" });
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].resourceType, "feishu_integration");
  });

  it("rejects unauthenticated inbound commands before policy checks", async () => {
    const db = createTestDb();
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "status"
    });

    assert.equal(res.status, 401);
    assert.equal(new AuditLogRepository(db, "missing-user").list({ action: "feishu.inbound.reject" }).length, 0);
  });

  it("rejects inbound commands when the integration is disabled without creating a Copilot run", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-disabled@example.com", "hash");
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "status api_key=sk-disabled-secret"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.details.code, "feishu_integration_disabled");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
    assert.equal(JSON.stringify(res.body).includes("sk-disabled-secret"), false);
  });

  it("rejects inbound commands when emergency disable is enabled", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-emergency@example.com", "hash");
    new FeishuIntegrationRepository(db, user.id).upsertConfig({
      enabled: true,
      emergencyDisabled: true,
      identityMode: "bot",
      allowedChatIds: ["oc_allowed"]
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "status"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.details.code, "feishu_integration_emergency_disabled");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
  });

  it("rejects inbound commands until an explicit chat allowlist is configured", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-no-allowlist@example.com", "hash");
    const repo = new FeishuIntegrationRepository(db, user.id);
    repo.upsertConfig({
      enabled: true,
      identityMode: "bot",
      allowedChatIds: []
    });
    repo.replaceUserMappings([
      { feishuUserId: "ou_allowed", openforgeUserId: user.id }
    ]);
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_any",
      feishuUserId: "ou_allowed",
      text: "status"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.details.code, "feishu_chat_allowlist_required");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
  });

  it("rejects inbound commands while Feishu identity mode is unknown", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-unknown-identity@example.com", "hash");
    const repo = new FeishuIntegrationRepository(db, user.id);
    repo.upsertConfig({
      enabled: true,
      identityMode: "unknown",
      allowedChatIds: ["oc_allowed"]
    });
    repo.replaceUserMappings([
      { feishuUserId: "ou_allowed", openforgeUserId: user.id }
    ]);
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "status"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.details.code, "feishu_identity_mode_required");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
  });

  it("rejects inbound commands from chats outside the allowlist and records redacted audit", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-chat-denied@example.com", "hash");
    new FeishuIntegrationRepository(db, user.id).upsertConfig({
      enabled: true,
      identityMode: "bot",
      allowedChatIds: ["oc_allowed"]
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_denied",
      feishuUserId: "ou_allowed",
      text: "status token=sk-chat-denied-secret",
      messageId: "om_denied"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.details.code, "feishu_chat_not_allowed");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
    const auditLogs = new AuditLogRepository(db, user.id).list({ action: "feishu.inbound.reject" });
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].resourceType, "feishu_inbound_command");
    assert.equal(JSON.stringify(auditLogs).includes("sk-chat-denied-secret"), false);
  });

  it("rejects inbound commands from unmapped Feishu users", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-unmapped@example.com", "hash");
    new FeishuIntegrationRepository(db, user.id).upsertConfig({
      enabled: true,
      identityMode: "bot",
      allowedChatIds: ["oc_allowed"]
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_unmapped",
      text: "status"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.details.code, "feishu_user_not_mapped");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
  });

  it("creates a Feishu-sourced Copilot conversation and run for mapped users", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-mapped@example.com", "hash");
    seedFeishuInboundPolicy(db, user.id);
    seedCopilotProvider(db, user.id);
    const modelRequests: CopilotModelRequest[] = [];
    const app = createTestApp(db, {
      masterKey: secret,
      modelClientFactory: () => ({
        async createResponse(request: CopilotModelRequest) {
          modelRequests.push(request);
          return [{ type: "assistant_message", text: "Feishu command queued." }];
        }
      })
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "status api_key=sk-inbound-secret",
      messageId: "om_allowed"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.run.source, "feishu");
    assert.equal(res.body.data.conversation.source, "feishu");
    assert.equal(res.body.data.pendingActionCount, 0);
    assert.equal(JSON.stringify(res.body).includes("sk-inbound-secret"), false);
    const runs = new CopilotRepository(db, user.id).listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].source, "feishu");
    assert.equal(runs[0].goal.includes("sk-inbound-secret"), false);
    assert.equal(modelRequests.length, 1);
    assert.equal(modelRequests[0].input.includes("sk-inbound-secret"), false);
  });

  it("rejects inbound project context that is not visible to the mapped user", async () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const user = users.create("inbound-project-owner@example.com", "hash");
    const other = users.create("inbound-project-other@example.com", "hash");
    seedFeishuInboundPolicy(db, user.id);
    const foreignProject = new ProjectRepository(db, other.id).create({
      name: "Foreign",
      path: "/tmp/openforge-foreign-project",
      aiTool: "claude"
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "status",
      projectId: foreignProject.id
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 403);
    assert.equal(res.body.details.code, "feishu_project_not_visible");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
  });

  it("does not create a new inbound run while a user run is waiting for approval", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-active-run@example.com", "hash");
    seedFeishuInboundPolicy(db, user.id);
    const repo = new CopilotRepository(db, user.id);
    repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Approve a pending action"
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "status"
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.details.code, "copilot_run_already_active");
    assert.equal(repo.listRuns().length, 1);
  });

  it("does not approve pending actions from free-form Feishu approval text", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-freeform-approval@example.com", "hash");
    seedFeishuInboundPolicy(db, user.id);
    const repo = new CopilotRepository(db, user.id);
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Approve a pending action"
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_session_input",
      input: { sessionId: "session-1", input: "continue" }
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: `/approve ${action.id}`
    }, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 409);
    assert.equal(repo.getPendingAction(action.id)?.status, "pending");
  });

  it("does not create duplicate runs when an accepted Feishu message id is replayed", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-replay@example.com", "hash");
    seedFeishuInboundPolicy(db, user.id);
    seedCopilotProvider(db, user.id);
    const app = createTestApp(db, {
      masterKey: secret,
      modelClientFactory: () => ({
        async createResponse() {
          return [{ type: "assistant_message", text: "ok" }];
        }
      })
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const body = {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "status",
      messageId: "om_replay"
    };

    const first = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", body, {
      Authorization: `Bearer ${token}`
    });
    const second = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", body, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.equal(second.body.details.code, "feishu_message_replayed");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 1);
  });

  it("rate-limits inbound commands per allowed Feishu chat without calling Copilot", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("inbound-rate-limit@example.com", "hash");
    seedFeishuInboundPolicy(db, user.id);
    seedCopilotProvider(db, user.id);
    let modelCallCount = 0;
    const app = createTestApp(db, {
      masterKey: secret,
      inboundRateLimit: { max: 1, windowMs: 60_000 },
      modelClientFactory: () => ({
        async createResponse() {
          modelCallCount += 1;
          return [{ type: "assistant_message", text: "ok" }];
        }
      })
    });
    const token = signJwt({ userId: user.id, email: user.email }, secret);
    const headers = { Authorization: `Bearer ${token}` };

    const first = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "first",
      messageId: "om_rate_1"
    }, headers);
    const second = await makeRequest(app, "POST", "/api/v1/integrations/feishu/inbound", {
      chatId: "oc_allowed",
      feishuUserId: "ou_allowed",
      text: "second",
      messageId: "om_rate_2"
    }, headers);

    assert.equal(first.status, 201);
    assert.equal(second.status, 429);
    assert.equal(second.body.details.code, "feishu_inbound_rate_limited");
    assert.equal(modelCallCount, 1);
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 1);
  });

  it("rejects unknown or disabled public webhook ids before creating a Copilot run", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("public-disabled@example.com", "hash");
    const repo = seedFeishuPublicWebhookPolicy(db, user.id, {
      publicWebhookId: "public-disabled",
      publicWebhookEnabled: false
    });
    assert.equal(repo.publicWebhookId, "public-disabled");
    const app = createTestApp(db);
    const event = publicMessageEvent({
      text: "status api_key=sk-public-webhook-secret",
      messageId: "om_disabled",
      eventId: "ev_disabled"
    });

    const unknown = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-missing", event, {
      ...signedFeishuHeaders(event)
    });
    const disabled = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-disabled", event, {
      ...signedFeishuHeaders(event)
    });

    assert.equal(unknown.status, 404);
    assert.equal(disabled.status, 403);
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
    assert.equal(JSON.stringify(unknown.body).includes("sk-public-webhook-secret"), false);
    assert.equal(JSON.stringify(disabled.body).includes("sk-public-webhook-secret"), false);
  });

  it("handles public url_verification without Copilot side effects", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("public-challenge@example.com", "hash");
    seedFeishuPublicWebhookPolicy(db, user.id);
    const app = createTestApp(db);

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", {
      type: "url_verification",
      token: "verify-token",
      challenge: "challenge-value"
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { challenge: "challenge-value" });
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
  });

  it("rejects unsigned and stale public webhook events without creating Copilot runs", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("public-auth-fail@example.com", "hash");
    seedFeishuPublicWebhookPolicy(db, user.id);
    const app = createTestApp(db);
    const event = publicMessageEvent({
      text: "status api_key=sk-public-webhook-secret",
      messageId: "om_auth_fail",
      eventId: "ev_auth_fail"
    });

    const unsigned = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", event);
    const staleTimestamp = `${Math.floor(Date.now() / 1000) - 600}`;
    const stale = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", event, {
      ...signedFeishuHeaders(event, { timestamp: staleTimestamp })
    });

    assert.equal(unsigned.status, 401);
    assert.equal(stale.status, 401);
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 0);
    assert.equal(JSON.stringify(unsigned.body).includes("sk-public-webhook-secret"), false);
    assert.equal(JSON.stringify(stale.body).includes("sk-public-webhook-secret"), false);
  });

  it("creates one Feishu-sourced Copilot run for a valid signed public webhook message", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("public-valid@example.com", "hash");
    seedFeishuPublicWebhookPolicy(db, user.id);
    seedCopilotProvider(db, user.id);
    const modelRequests: CopilotModelRequest[] = [];
    const app = createTestApp(db, {
      masterKey: secret,
      modelClientFactory: () => ({
        async createResponse(request: CopilotModelRequest) {
          modelRequests.push(request);
          return [{ type: "assistant_message", text: "Public webhook accepted." }];
        }
      })
    });
    const event = publicMessageEvent({
      text: "status api_key=sk-public-webhook-secret",
      messageId: "om_public_valid",
      eventId: "ev_public_valid"
    });

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", event, {
      ...signedFeishuHeaders(event)
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.msg, "ok");
    assert.equal(res.body.code, undefined);
    assert.equal(JSON.stringify(res.body).includes("sk-public-webhook-secret"), false);
    const runs = new CopilotRepository(db, user.id).listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].source, "feishu");
    assert.equal(runs[0].goal.includes("sk-public-webhook-secret"), false);
    assert.equal(modelRequests.length, 1);
    assert.equal(modelRequests[0].input.includes("sk-public-webhook-secret"), false);
  });

  it("does not create duplicate public webhook runs for replayed event ids", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("public-replay@example.com", "hash");
    seedFeishuPublicWebhookPolicy(db, user.id);
    seedCopilotProvider(db, user.id);
    const app = createTestApp(db, {
      masterKey: secret,
      modelClientFactory: () => ({
        async createResponse() {
          return [{ type: "assistant_message", text: "ok" }];
        }
      })
    });
    const event = publicMessageEvent({
      text: "status",
      messageId: "om_public_replay",
      eventId: "ev_public_replay"
    });
    const headers = signedFeishuHeaders(event);

    const first = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", event, headers);
    const second = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", event, headers);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.msg, "replayed");
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 1);
  });

  it("rate-limits public webhook commands with persistent chat and mapped-user windows", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("public-rate-limit@example.com", "hash");
    seedFeishuPublicWebhookPolicy(db, user.id);
    seedCopilotProvider(db, user.id);
    let modelCallCount = 0;
    const app = createTestApp(db, {
      masterKey: secret,
      publicWebhookRateLimit: { max: 1, windowMs: 60_000 },
      modelClientFactory: () => ({
        async createResponse() {
          modelCallCount += 1;
          return [{ type: "assistant_message", text: "ok" }];
        }
      })
    });
    const firstEvent = publicMessageEvent({ text: "first", messageId: "om_public_rate_1", eventId: "ev_public_rate_1" });
    const secondEvent = publicMessageEvent({ text: "second", messageId: "om_public_rate_2", eventId: "ev_public_rate_2" });

    const first = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", firstEvent, signedFeishuHeaders(firstEvent));
    const second = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", secondEvent, signedFeishuHeaders(secondEvent));

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.msg, "ignored");
    assert.equal(modelCallCount, 1);
    assert.equal(new CopilotRepository(db, user.id).listRuns().length, 1);
  });

  it("does not approve pending actions from public webhook free-form approval text", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("public-freeform-approval@example.com", "hash");
    seedFeishuPublicWebhookPolicy(db, user.id);
    const repo = new CopilotRepository(db, user.id);
    const run = repo.createRun({
      status: "waiting_for_approval",
      source: "copilot",
      goal: "Approve a pending action"
    });
    const action = repo.createPendingAction(run.id, {
      type: "openforge.propose_session_input",
      input: { sessionId: "session-1", input: "continue" }
    });
    const app = createTestApp(db);
    const event = publicMessageEvent({
      text: `/approve ${action.id}`,
      messageId: "om_public_approve",
      eventId: "ev_public_approve"
    });

    const res = await makeRequest(app, "POST", "/api/v1/integrations/feishu/webhook/public-test", event, signedFeishuHeaders(event));

    assert.equal(res.status, 200);
    assert.equal(repo.getPendingAction(action.id)?.status, "pending");
    assert.equal(repo.listRuns().length, 1);
  });
});

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

type TestFeishuRouteOptions = Parameters<typeof createFeishuIntegrationRoutes>[0] & Record<string, unknown>;

function createTestApp(db: Database, routeOptions: TestFeishuRouteOptions = {}): express.Express {
  const app = express();
  app.locals.jwtSecret = secret;
  app.use(express.json({
    verify: (req, _res, buffer) => {
      (req as { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    }
  }));
  app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
    db,
    masterKey: secret,
    getStatus: async () => ({
      available: true,
      version: "lark-cli 1.2.3",
      authState: "authenticated",
      identityMode: "user",
      enabled: false
    }),
    ...routeOptions
  } as Parameters<typeof createFeishuIntegrationRoutes>[0]));
  return app;
}

function seedFeishuInboundPolicy(db: Database, userId: string): void {
  const repo = new FeishuIntegrationRepository(db, userId);
  repo.upsertConfig({
    enabled: true,
    identityMode: "bot",
    allowedChatIds: ["oc_allowed"]
  });
  repo.replaceUserMappings([
    { feishuUserId: "ou_allowed", openforgeUserId: userId, displayName: "Allowed User" }
  ]);
}

function seedFeishuPublicWebhookPolicy(
  db: Database,
  userId: string,
  options: {
    publicWebhookId?: string;
    publicWebhookEnabled?: boolean;
    verificationToken?: string;
    eventEncryptKey?: string;
  } = {}
) {
  seedFeishuInboundPolicy(db, userId);
  return new FeishuIntegrationRepository(db, userId, secret).configurePublicWebhook({
    publicWebhookId: options.publicWebhookId ?? "public-test",
    publicWebhookEnabled: options.publicWebhookEnabled ?? true,
    verificationToken: options.verificationToken ?? "verify-token",
    eventEncryptKey: options.eventEncryptKey ?? "encrypt-key"
  });
}

function publicMessageEvent(input: {
  text: string;
  messageId: string;
  eventId: string;
  chatId?: string;
  feishuUserId?: string;
}): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      event_id: input.eventId,
      event_type: "im.message.receive_v1",
      token: "verify-token"
    },
    event: {
      sender: {
        sender_id: {
          open_id: input.feishuUserId ?? "ou_allowed"
        }
      },
      message: {
        message_id: input.messageId,
        chat_id: input.chatId ?? "oc_allowed",
        message_type: "text",
        content: JSON.stringify({ text: input.text })
      }
    }
  };
}

function signedFeishuHeaders(
  body: unknown,
  options: { timestamp?: string; nonce?: string; eventEncryptKey?: string } = {}
): Record<string, string> {
  const timestamp = options.timestamp ?? `${Math.floor(Date.now() / 1000)}`;
  const nonce = options.nonce ?? "nonce-public-test";
  const rawBody = JSON.stringify(body);
  const signature = createHash("sha256")
    .update(`${timestamp}${nonce}${options.eventEncryptKey ?? "encrypt-key"}${rawBody}`, "utf8")
    .digest("hex");
  return {
    "X-Lark-Request-Timestamp": timestamp,
    "X-Lark-Request-Nonce": nonce,
    "X-Lark-Signature": signature
  };
}

function seedCopilotProvider(db: Database, userId: string): void {
  const repo = new ModelProviderRepository(db, userId, secret);
  const provider = repo.createProviderProfile({
    name: "Local OpenAI-compatible provider",
    providerKey: "local-openai-compatible",
    baseUrl: "http://127.0.0.1:1/v1",
    openaiBaseUrl: "http://127.0.0.1:1/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["claude", "opencode"]
  });
  repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Local Chat",
    modelId: "local-chat",
    isDefault: true
  });
  repo.createCredential({
    providerProfileId: provider.id,
    plaintextSecret: "sk-local-provider"
  });
}

async function makeRequest(
  app: express.Express,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              body: data ? JSON.parse(data) : undefined
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
