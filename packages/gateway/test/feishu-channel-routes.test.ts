import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import http from "node:http";

import { signJwt } from "../src/auth/jwt.js";
import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { FeishuChannelRepository } from "../src/db/repositories/feishu-channel-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createFeishuIntegrationRoutes } from "../src/routes/integrations-feishu.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "12".repeat(32);

describe("Feishu channel management routes", () => {
  let db: Database.Database;
  let app: express.Express;
  let ownerId: string;
  let ownerToken: string;
  let otherToken: string;
  const reconciled: string[] = [];

  beforeEach(() => {
    reconciled.length = 0;
    db = new Database(":memory:");
    migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
    const users = new UserRepository(db);
    const owner = users.create("feishu-channel-owner@example.com", "hash");
    const other = users.create("feishu-channel-other@example.com", "hash");
    ownerId = owner.id;
    ownerToken = signJwt({ userId: owner.id, email: owner.email }, jwtSecret);
    otherToken = signJwt({ userId: other.id, email: other.email }, jwtSecret);
    app = express();
    app.locals.jwtSecret = jwtSecret;
    app.use(express.json());
    app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
      db, masterKey,
      channelRuntime: {
        reconcileAccount: async (userId) => { reconciled.push(userId); },
        getHealth: () => ({ state: "connected", accountId: "account", lastErrorMessage: null })
      }
    }));
  });

  it("stores the App Secret write-only and reconciles account revisions", async () => {
    const saved = await request("PUT", "/api/v1/integrations/feishu/account", {
      appId: "cli_test", appSecret: "super-secret", enabled: true
    });
    const rotatedWithoutEcho = await request("PUT", "/api/v1/integrations/feishu/account", {
      appId: "cli_test_2", enabled: true
    });
    const read = await request("GET", "/api/v1/integrations/feishu/account");

    assert.equal(saved.status, 200);
    assert.equal(JSON.stringify(saved.body).includes("super-secret"), false);
    assert.equal(JSON.stringify(rotatedWithoutEcho.body).includes("super-secret"), false);
    assert.equal(JSON.stringify(read.body).includes("super-secret"), false);
    assert.equal(read.body.data.account.secretConfigured, true);
    assert.deepEqual(reconciled, [ownerId, ownerId]);
    const raw = db.prepare("SELECT app_secret_encrypted FROM feishu_channel_accounts WHERE user_id = ?")
      .get(ownerId) as { app_secret_encrypted: string };
    assert.doesNotMatch(raw.app_secret_encrypted, /super-secret/u);
  });

  it("scopes bindings and queue summaries by tenant and supports emergency stop", async () => {
    await request("PUT", "/api/v1/integrations/feishu/account", {
      appId: "cli_test", appSecret: "super-secret", enabled: true
    });
    const channel = new FeishuChannelRepository(db, ownerId, masterKey);
    const account = channel.getAccount();
    assert.ok(account);
    const conversation = new CopilotRepository(db, ownerId).createConversation({ title: "Feishu", source: "feishu" });
    channel.createConversationBinding({
      accountId: account.id, chatId: "oc_chat", threadKey: "root", conversationId: conversation.id
    });

    const bindings = await request("GET", "/api/v1/integrations/feishu/bindings");
    const hidden = await request("GET", "/api/v1/integrations/feishu/bindings", undefined, otherToken);
    const health = await request("GET", "/api/v1/integrations/feishu/health");
    const queues = await request("GET", "/api/v1/integrations/feishu/queue-summary");
    const stopped = await request("POST", "/api/v1/integrations/feishu/emergency-stop", {});

    assert.equal(bindings.body.data.bindings.length, 1);
    assert.equal(hidden.body.data.bindings.length, 0);
    assert.equal(health.body.data.health.state, "connected");
    assert.deepEqual(queues.body.data.queues, { inbox: {}, outbox: {} });
    assert.equal(stopped.body.data.stopped, true);
    assert.equal(channel.getAccount()?.enabled, false);
  });

  it("manually creates a binding with a tenant-owned project scope", async () => {
    await request("PUT", "/api/v1/integrations/feishu/account", {
      appId: "cli_test", appSecret: "super-secret", enabled: true
    });
    const project = new ProjectRepository(db, ownerId).create({
      name: "OpenForge",
      path: "/tmp/openforge",
      aiTool: "claude"
    });

    const created = await request("POST", "/api/v1/integrations/feishu/bindings", {
      chatId: "oc_manual",
      threadKey: "root",
      scope: { type: "project", id: project.id }
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.data.binding.chatId, "oc_manual");
    assert.deepEqual(created.body.data.binding.scope, { type: "project", id: project.id });
    assert.equal(new CopilotRepository(db, ownerId).listConversations().length, 1);
  });

  async function request(method: string, pathname: string, body?: unknown, token = ownerToken) {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
        method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});
