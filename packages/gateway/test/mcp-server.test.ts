import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { isAllowedMcpOrigin } from "../src/routes/mcp.js";
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
  headers: Record<string, string>;
  messages: Array<Record<string, any>>;
}

async function mcpRpc(port: number, token: string | undefined, method: string, params?: unknown, extraHeaders: Record<string, string> = {}): Promise<RpcResult> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) })
  });
  const text = await res.text();
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), messages: parseJsonRpcMessages(text) };
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
  let root: string;
  let readToken: string;
  let operateToken: string;
  let cliToken: string;

  before(async () => {
    db = createTestDb();
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-mcp-server-")));
    const users = new UserRepository(db);
    userId = users.create("owner@example.com", "hash", { role: "admin" }).id;
    const tokens = new McpTokenRepository(db);
    readToken = tokens.create({ userId, name: "reader", scopes: ["read"] }).token;
    operateToken = tokens.create({ userId, name: "operator", scopes: ["read", "operate"] }).token;
    // A complete legacy CLI grant: canonical root + finite lifetime.
    cliToken = tokens.create({ userId, name: "cli", scopes: ["read", "operate", "cli_dispatch"], allowedRoot: root, expiresAt: new Date(Date.now() + 3_600_000) }).token;
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
    rmSync(root, { recursive: true, force: true });
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

    // Assert: status + RFC 6750 challenge + JSON-RPC envelope (not the REST one)
    for (const res of [missing, unknown, revokedRes]) {
      assert.equal(res.status, 401);
      assert.match(res.headers["www-authenticate"] ?? "", /^Bearer /);
      const body = res.messages[0];
      assert.equal(body?.jsonrpc, "2.0");
      assert.equal(body?.error?.code, -32000);
    }
  });

  it("rejects disallowed Origin headers before authentication", async () => {
    // A rebinding attacker's page presents its own origin: 403, with the
    // JSON-RPC error shape the spec allows on this endpoint.
    const evil = await mcpRpc(port, readToken, "tools/list", undefined, { origin: "https://evil.example" });
    assert.equal(evil.status, 403);
    assert.equal(evil.messages[0]?.error?.code, -32000);
    // A malformed origin is rejected the same way.
    const malformed = await mcpRpc(port, readToken, "tools/list", undefined, { origin: "not a url" });
    assert.equal(malformed.status, 403);
    // Loopback origins pass the guard (and then fail auth without a token).
    const local = await mcpRpc(port, undefined, "tools/list", undefined, { origin: "http://127.0.0.1:48732" });
    assert.equal(local.status, 401);
    // The guard covers GET/405 traffic as well.
    const getRes = await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { origin: "https://evil.example" } });
    assert.equal(getRes.status, 403);
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
    const cli = await mcpRpc(port, cliToken, "tools/list");

    // Assert
    const readerNames = reader.messages[0]?.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
    const operatorNames = operator.messages[0]?.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
    const cliNames = cli.messages[0]?.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
    assert.ok(readerNames.includes("list_projects"));
    assert.ok(readerNames.includes("list_sessions"));
    assert.equal(readerNames.includes("dispatch_task_to_session"), false);
    assert.equal(readerNames.includes("stop_session"), false);
    // CLI control (including direct session dispatch) needs cli_dispatch, not
    // operate alone.
    assert.equal(operatorNames.includes("dispatch_task_to_session"), false);
    assert.ok(operatorNames.includes("pm_prepare_task_packet"));
    assert.ok(operatorNames.includes("stop_session"));
    assert.ok(cliNames.includes("dispatch_task_to_session"));
    assert.ok(cliNames.includes("pm_execute_task_packet"));
  });

  it('does not expand old account tokens to raw Shell execution', async () => {
    for (const token of [readToken, operateToken]) {
      const listing = await mcpRpc(port, token, 'tools/list');
      const names = listing.messages[0]?.result?.tools?.map((tool: { name: string }) => tool.name) ?? [];
      for (const name of ['terminal_run', 'terminal_open', 'terminal_close']) {
        assert.equal(names.includes(name), false, name);
        const result = await mcpRpc(port, token, 'tools/call', { name, arguments: { projectId: 'fixture', command: 'printf harmless' } });
        assert.equal(result.messages[0]?.result?.isError, true);
      }
    }
  });

  it("annotates tools with risk-derived execution hints", async () => {
    // Act
    const reader = await mcpRpc(port, readToken, "tools/list");
    const operator = await mcpRpc(port, operateToken, "tools/list");
    const cli = await mcpRpc(port, cliToken, "tools/list");
    const byToken = (res: RpcResult) => (res.messages[0]?.result?.tools ?? []) as Array<{ name: string; annotations?: Record<string, boolean> }>;

    // Assert: every listed tool carries annotations with boolean hints.
    for (const tools of [byToken(reader), byToken(operator), byToken(cli)]) {
      assert.ok(tools.length > 0);
      for (const tool of tools) {
        assert.ok(tool.annotations, `${tool.name} needs annotations`);
        for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
          assert.equal(typeof tool.annotations[key], "boolean", `${tool.name} ${key}`);
        }
      }
    }
    const listProjects = byToken(reader).find((tool) => tool.name === "list_projects");
    assert.deepEqual(listProjects?.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    const stopSession = byToken(operator).find((tool) => tool.name === "stop_session");
    assert.deepEqual(stopSession?.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
    const receipt = byToken(cli).find((tool) => tool.name === "get_mcp_operation");
    assert.deepEqual(receipt?.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
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
    // Structured output mirrors the text payload for object-shaped results.
    assert.deepEqual(result?.structuredContent, payload);
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

  it("refuses direct dispatch for operate tokens without cli_dispatch", async () => {
    const res = await mcpRpc(port, operateToken, "tools/call", {
      name: "dispatch_task_to_session",
      arguments: { sessionId: "s-1", message: "hello", operationId: "op-only-dispatch" }
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
    // Arrange: a CLI token calling dispatch against a session that does not
    // exist must fail cleanly through the command pipeline, before any
    // durable intent exists.
    const res = await mcpRpc(port, cliToken, "tools/call", {
      name: "dispatch_task_to_session",
      arguments: { sessionId: `missing-${randomUUID()}`, message: "hello", operationId: "missing-session-dispatch" }
    });

    const result = res.messages[0]?.result;
    assert.equal(result?.isError, true);
    assert.match(result?.content?.[0]?.text ?? "", /Session not found/);
  });

  it("refuses high-risk approval-gated operations instead of auto-approving them", async (t) => {
    // Arrange: the security policy marks project creation outside the home
    // directory as require_approval + high risk. With no human in the loop,
    // MCP must refuse rather than silently approve.
    if (process.platform === "win32") {
      t.skip("POSIX-only absolute path fixture");
      return;
    }

    // Act
    const res = await mcpRpc(port, operateToken, "tools/call", {
      name: "create_project",
      arguments: { name: "outside-home", path: `/mcp-denied-${randomUUID()}` }
    });

    // Assert
    const result = res.messages[0]?.result;
    assert.equal(result?.isError, true);
    assert.match(result?.content?.[0]?.text ?? "", /Denied by security policy/i);
  });

  it("rejects session-scoped memory writes with an actionable message", async () => {
    const res = await mcpRpc(port, operateToken, "tools/call", {
      name: "write_memory",
      arguments: { kind: "fact", scope: "session", text: "hello over mcp" }
    });

    const result = res.messages[0]?.result;
    assert.equal(result?.isError, true);
    assert.match(result?.content?.[0]?.text ?? "", /requires a Copilot conversation/i);
  });

  it("answers malformed JSON bodies with a JSON-RPC parse error", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${readToken}`
      },
      body: "this is not json{{"
    });

    assert.equal(res.status, 400);
    const body = await res.json() as { jsonrpc?: string; error?: { code?: number } };
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.error?.code, -32700);
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

  it("serves an object-type inputSchema for union-shaped lifecycle tools", async () => {
    // Arrange: pm_manage_stage takes a top-level zod union, which serializes
    // without a top-level type. MCP clients (zod v4) reject the entire
    // tools/list payload unless every inputSchema declares type: "object".
    // Runs last: it adds a second project to the shared test database.
    const projectPath = path.join(root, `mcp-lc-${randomUUID()}`);
    mkdirSync(projectPath);
    const project = new ProjectRepository(db, userId).create({ name: "mcp-lc", path: projectPath, aiTool: "claude" });
    const lifecycle = new McpTokenRepository(db).create({
      userId, name: "lifecycle", scopes: ["read", "operate", "lifecycle"],
      allowedProjects: [{ id: project.id, root: projectPath }]
    });

    // Act
    const res = await mcpRpc(port, lifecycle.token, "tools/list");

    // Assert
    const tools = (res.messages[0]?.result?.tools ?? []) as Array<{ name: string; inputSchema: { type?: unknown } }>;
    const stage = tools.find((tool) => tool.name === "pm_manage_stage");
    assert.ok(stage, "pm_manage_stage should be listed for a lifecycle-scoped token");
    assert.equal(stage.inputSchema.type, "object");
    for (const tool of tools) assert.equal(tool.inputSchema.type, "object", `${tool.name} inputSchema`);
  });
});

describe("isAllowedMcpOrigin", () => {
  it("allows absent origins (non-browser clients)", () => {
    assert.equal(isAllowedMcpOrigin(undefined), true);
  });
  it("allows loopback http/https origins on any port", () => {
    assert.equal(isAllowedMcpOrigin("http://127.0.0.1:48732"), true);
    assert.equal(isAllowedMcpOrigin("http://localhost:3000"), true);
    assert.equal(isAllowedMcpOrigin("https://[::1]:8080"), true);
  });
  it("rejects non-loopback, malformed, and non-http origins", () => {
    assert.equal(isAllowedMcpOrigin("https://evil.example"), false);
    assert.equal(isAllowedMcpOrigin("http://10.0.0.5:8080"), false);
    assert.equal(isAllowedMcpOrigin("not a url"), false);
    assert.equal(isAllowedMcpOrigin("file:///etc/passwd"), false);
    assert.equal(isAllowedMcpOrigin(["http://127.0.0.1:48732"]), false);
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
