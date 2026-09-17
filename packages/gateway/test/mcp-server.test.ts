import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { McpTokenRepository, type McpTokenScope } from "../src/db/repositories/mcp-token-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { signJwt } from "../src/auth/jwt.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { createServer } from "../src/server.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import type { InMemorySessionManager } from "../src/services/session-manager.js";
import { RuntimeAuthorizationInvalidator } from "../src/services/runtime-authorization-invalidation.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "0123456789abcdef0123456789abcdef";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

function createApp(db: Database, mcpEnabled: boolean) {
  return createServer({
    db,
    jwtSecret,
    masterKey,
    sessionManager: {} as InMemorySessionManager,
    apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
    eventBus: new ForgeBadgerEventBus(),
    appVersion: "0.0.0-test",
    runtimeAuthorizationInvalidator: new RuntimeAuthorizationInvalidator(),
    mcpEnabled
  });
}

interface RpcResult {
  status: number;
  messages: Array<Record<string, any>>;
}

async function mcpRpc(port: number, token: string | undefined, method: string, params?: unknown): Promise<RpcResult> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) })
  });
  const text = await res.text();
  return { status: res.status, messages: parseJsonRpcMessages(text) };
}

function parseJsonRpcMessages(text: string): Array<Record<string, any>> {
  const messages: Array<Record<string, any>> = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      messages.push(JSON.parse(line.slice(5).trim()));
    } catch {
      // Ignore non-JSON SSE payloads (e.g. priming events).
    }
  }
  if (messages.length === 0 && text.trim()) {
    try {
      messages.push(JSON.parse(text));
    } catch {
      // Leave empty; assertions treat it as no JSON-RPC response.
    }
  }
  return messages;
}

describe("mcp endpoint", () => {
  let db: Database;
  let server: Server;
  let port: number;
  let userId: string;
  let readToken: string;
  let operateToken: string;

  before(async () => {
    db = createTestDb();
    const users = new UserRepository(db);
    userId = users.create("owner@example.com", "hash", { role: "admin" }).id;
    const tokens = new McpTokenRepository(db);
    readToken = tokens.create({ userId, name: "reader", scopes: ["read"] }).token;
    operateToken = tokens.create({ userId, name: "operator", scopes: ["read", "operate"] }).token;
    new ProjectRepository(db, userId).create({
      name: "mcp-demo",
      path: `/tmp/mcp-demo-${randomUUID()}`,
      aiTool: "claude"
    });

    const app = createApp(db, true);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  it("rejects requests without a token, with an unknown token, and after revocation", async () => {
    // Arrange
    const tokens = new McpTokenRepository(db);
    const revoked = tokens.create({ userId, name: "revoked", scopes: ["read"] });
    tokens.revokeByIdAndUser(revoked.record.id, userId);

    // Act
    const missing = await mcpRpc(port, undefined, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" }
    });
    const unknown = await mcpRpc(port, "fbmcp_deadbeef", "tools/list");
    const revokedRes = await mcpRpc(port, revoked.token, "tools/list");

    // Assert
    assert.equal(missing.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(revokedRes.status, 401);
  });

  it("rejects tokens of disabled users", async () => {
    // Arrange
    const users = new UserRepository(db);
    const disabled = users.create("disabled@example.com", "hash", { role: "user" });
    const { token } = new McpTokenRepository(db).create({ userId: disabled.id, name: "d", scopes: ["read"] });
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(disabled.id);

    // Act
    const res = await mcpRpc(port, token, "tools/list");

    // Assert
    assert.equal(res.status, 401);
  });

  it("answers initialize with the gateway server info", async () => {
    const res = await mcpRpc(port, readToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0" }
    });

    assert.equal(res.status, 200);
    assert.equal(res.messages[0]?.result?.serverInfo?.name, "forgebadger-gateway");
    assert.equal(res.messages[0]?.result?.capabilities?.tools !== undefined, true);
  });

  it("filters tools/list by token scope", async () => {
    // Act
    const reader = await mcpRpc(port, readToken, "tools/list");
    const operator = await mcpRpc(port, operateToken, "tools/list");

    // Assert
    const readerNames = reader.messages[0]?.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
    const operatorNames = operator.messages[0]?.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
    assert.ok(readerNames.includes("list_projects"));
    assert.ok(readerNames.includes("list_sessions"));
    assert.equal(readerNames.includes("dispatch_task_to_session"), false);
    assert.equal(readerNames.includes("stop_session"), false);
    assert.ok(operatorNames.includes("dispatch_task_to_session"));
    assert.ok(operatorNames.includes("stop_session"));
  });

  it("executes read tools with tenant-scoped results", async () => {
    // Act
    const res = await mcpRpc(port, readToken, "tools/call", { name: "list_projects", arguments: {} });

    // Assert
    assert.equal(res.status, 200);
    const result = res.messages[0]?.result;
    assert.equal(result?.isError, undefined);
    const payload = JSON.parse(result?.content?.[0]?.text ?? "{}");
    assert.equal(payload.count, 1);
    assert.equal(payload.projects[0].name, "mcp-demo");
  });

  it("rejects operate tools for read-only tokens", async () => {
    const res = await mcpRpc(port, readToken, "tools/call", {
      name: "dispatch_task_to_session",
      arguments: { sessionId: "s-1", message: "hello" }
    });

    const result = res.messages[0]?.result;
    assert.equal(result?.isError, true);
    assert.match(result?.content?.[0]?.text ?? "", /unavailable tool/i);
  });

  it("rejects invalid tool input with an isError result", async () => {
    const res = await mcpRpc(port, readToken, "tools/call", { name: "get_session", arguments: {} });

    const result = res.messages[0]?.result;
    assert.equal(result?.isError, true);
    assert.match(result?.content?.[0]?.text ?? "", /invalid/i);
  });

  it("surfaces platform command failures as tool errors, not crashes", async () => {
    // Arrange: an operate token calling dispatch against a session that does
    // not exist must fail cleanly through the command pipeline.
    const res = await mcpRpc(port, operateToken, "tools/call", {
      name: "dispatch_task_to_session",
      arguments: { sessionId: `missing-${randomUUID()}`, message: "hello" }
    });

    const result = res.messages[0]?.result;
    assert.equal(result?.isError, true);
  });

  it("rejects GET and DELETE in stateless mode", async () => {
    const getRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: { authorization: `Bearer ${readToken}` }
    });
    const deleteRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${readToken}` }
    });

    assert.equal(getRes.status, 405);
    assert.equal(deleteRes.status, 405);
  });
});

describe("mcp endpoint disabled", () => {
  it("does not mount /mcp or the token management routes", async () => {
    // Arrange
    const db = createTestDb();
    const app = createApp(db, false);
    const disabledServer = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const disabledPort = (disabledServer.address() as { port: number }).port;

    try {
      // Act: an authenticated request must fall through to 404 — anything else
      // means the MCP routes are mounted while disabled.
      const user = new UserRepository(db).create("owner@example.com", "hash", { role: "admin" });
      const jwt = signJwt({ userId: user.id, email: user.email }, jwtSecret);
      const mcpRes = await mcpRpc(disabledPort, "fbmcp_whatever", "tools/list");
      const tokensRes = await fetch(`http://127.0.0.1:${disabledPort}/api/v1/mcp/tokens`, {
        headers: { authorization: `Bearer ${jwt}` }
      });

      // Assert
      assert.equal(mcpRes.status, 404);
      assert.equal(tokensRes.status, 404);
    } finally {
      await new Promise<void>((resolve) => disabledServer.close(() => resolve()));
      db.close();
    }
  });
});
