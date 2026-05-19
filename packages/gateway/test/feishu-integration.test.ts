import assert from "node:assert/strict";
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
import { FeishuIntegrationRepository } from "../src/db/repositories/feishu-integration-repository.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import {
  getFeishuCliStatus,
  type FeishuCliCommandRunner
} from "../src/services/integrations/feishu-cli.js";
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
      commandPrefix: "/openforge"
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
    assert.equal(rows.some((row) => /secret|token|credential|cookie|password/i.test(row.name)), false);
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
      commandPrefix: "/openforge"
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

function createTestApp(db: Database): express.Express {
  const app = express();
  app.locals.jwtSecret = secret;
  app.use(express.json());
  app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
    db,
    getStatus: async () => ({
      available: true,
      version: "lark-cli 1.2.3",
      authState: "authenticated",
      identityMode: "user",
      enabled: false
    })
  }));
  return app;
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
