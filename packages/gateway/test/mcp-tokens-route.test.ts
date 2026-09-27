import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import path from "node:path";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { signJwt } from "../src/auth/jwt.js";
import { MCP_TOKEN_PREFIX } from "../src/db/repositories/mcp-token-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createMcpTokenRoutes } from "../src/routes/mcp-tokens.js";

const secret = "0123456789abcdef0123456789abcdef";

process.env.FORGEBADGER_JWT_SECRET = secret;
process.env.FORGEBADGER_MASTER_KEY = "abcdef0123456789abcdef0123456789";

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("mcp token management routes", () => {
  let db: Database;
  let users: UserRepository;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDb();
    users = new UserRepository(db);
    app = express();
    app.locals.jwtSecret = secret;
    app.locals.db = db;
    app.use(express.json());
    app.use("/api/v1/mcp/tokens", createMcpTokenRoutes(db));
  });

  function bearer(userId: string, email: string): Record<string, string> {
    return { Authorization: `Bearer ${signJwt({ userId, email }, secret)}` };
  }

  it("creates a token, returns the plaintext exactly once, and lists it without secrets", async () => {
    // Arrange
    const user = users.create("owner@example.com", "hash", { role: "admin" });

    // Act
    const created = await makeRequest(app, "POST", "/api/v1/mcp/tokens", { name: "ci-agent" }, bearer(user.id, user.email));
    const listed = await makeRequest(app, "GET", "/api/v1/mcp/tokens", undefined, bearer(user.id, user.email));

    // Assert
    assert.equal(created.status, 201);
    assert.equal(created.body.code, 0);
    assert.ok(created.body.data.plaintext.startsWith(MCP_TOKEN_PREFIX));
    assert.deepEqual(created.body.data.token.scopes, ["read"]);

    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.tokens.length, 1);
    const row = listed.body.data.tokens[0];
    assert.equal(row.name, "ci-agent");
    assert.equal("plaintext" in row, false);
    assert.equal("tokenHash" in row, false);
    assert.equal(row.revoked, false);
  });

  it("rejects invalid payloads with the project envelope", async () => {
    // Arrange
    const user = users.create("owner@example.com", "hash", { role: "admin" });

    // Act
    const emptyName = await makeRequest(app, "POST", "/api/v1/mcp/tokens", { name: "" }, bearer(user.id, user.email));
    const badScope = await makeRequest(app, "POST", "/api/v1/mcp/tokens", { name: "x", scopes: ["admin"] }, bearer(user.id, user.email));

    // Assert
    assert.equal(emptyName.status, 400);
    assert.equal(emptyName.body.code, 1);
    assert.equal(badScope.status, 400);
    assert.equal(badScope.body.code, 1);
  });

  it("issues time-limited, root-bound CLI tokens only with explicit operate scope", async () => {
    const user = users.create("owner@example.com", "hash", { role: "admin" });
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-mcp-token-")));
    try {
      const headers = bearer(user.id, user.email);
      const missingOperate = await makeRequest(app, "POST", "/api/v1/mcp/tokens", {
        name: "bad", scopes: ["cli_dispatch"], allowedRoot: root, expiresInHours: 24
      }, headers);
      const missingRoot = await makeRequest(app, "POST", "/api/v1/mcp/tokens", {
        name: "bad", scopes: ["operate", "cli_dispatch"], expiresInHours: 24
      }, headers);
      const silentlyUnbounded = await makeRequest(app, "POST", "/api/v1/mcp/tokens", {
        name: "bad", scopes: ["operate"], allowedRoot: root, expiresInHours: 1
      }, headers);
      const created = await makeRequest(app, "POST", "/api/v1/mcp/tokens", {
        name: "dev", scopes: ["read", "operate", "cli_dispatch"], allowedRoot: root, expiresInHours: 24
      }, headers);
      assert.equal(missingOperate.status, 400);
      assert.equal(missingRoot.status, 400);
      assert.equal(silentlyUnbounded.status, 400);
      assert.equal(created.status, 201);
      assert.equal(created.body.data.token.allowedRoot, root);
      assert.ok(Date.parse(created.body.data.token.expiresAt) > Date.now());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates permanent multi-project tokens and rejects foreign or empty selections", async () => {
    const owner = users.create("multi@example.com", "hash");
    const other = users.create("foreign@example.com", "hash");
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fb-mcp-projects-")));
    try {
      const repo = new ProjectRepository(db, owner.id);
      mkdirSync(path.join(root, "a"));
      mkdirSync(path.join(root, "b"));
      const a = repo.create({ name: "A", path: path.join(root, "a"), aiTool: "codex" });
      const b = repo.create({ name: "B", path: path.join(root, "b"), aiTool: "codex" });
      const foreign = new ProjectRepository(db, other.id).create({ name: "Foreign", path: path.join(root, "foreign"), aiTool: "codex" });
      const headers = bearer(owner.id, owner.email);
      const body = { name: "full", scopes: ["read", "operate", "cli_dispatch"], projectIds: [a.id, b.id], expiresInHours: null };
      const created = await makeRequest(app, "POST", "/api/v1/mcp/tokens", body, headers);
      assert.equal(created.status, 201);
      assert.deepEqual(created.body.data.token.projectIds, [a.id, b.id]);
      assert.equal(created.body.data.token.expiresAt, null);
      assert.equal(created.body.data.token.allowedRoot, null);
      for (const projectIds of [[], [foreign.id], [a.id, "missing"]]) {
        const rejected = await makeRequest(app, "POST", "/api/v1/mcp/tokens", { ...body, projectIds }, headers);
        assert.equal(rejected.status, 400);
      }
      const mixed = await makeRequest(app, "POST", "/api/v1/mcp/tokens", { ...body, allowedRoot: root }, headers);
      assert.equal(mixed.status, 400);
      const listed = await makeRequest(app, "GET", "/api/v1/mcp/tokens", undefined, headers);
      assert.deepEqual(listed.body.data.tokens[0].projectIds, [a.id, b.id]);
      const readOnly = await makeRequest(app, "POST", "/api/v1/mcp/tokens", { name: "read", projectIds: [a.id], expiresInHours: 24 }, headers);
      assert.equal(readOnly.status, 201);
      assert.ok(Date.parse(readOnly.body.data.token.expiresAt) > Date.now());
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("hides and protects tokens across tenants", async () => {
    // Arrange
    const owner = users.create("owner@example.com", "hash", { role: "admin" });
    const other = users.create("other@example.com", "hash", { role: "user" });
    const created = await makeRequest(app, "POST", "/api/v1/mcp/tokens", { name: "ci" }, bearer(owner.id, owner.email));
    const tokenId = created.body.data.token.id as string;

    // Act
    const otherList = await makeRequest(app, "GET", "/api/v1/mcp/tokens", undefined, bearer(other.id, other.email));
    const otherDelete = await makeRequest(app, "DELETE", `/api/v1/mcp/tokens/${tokenId}`, undefined, bearer(other.id, other.email));
    const ownerDelete = await makeRequest(app, "DELETE", `/api/v1/mcp/tokens/${tokenId}`, undefined, bearer(owner.id, owner.email));

    // Assert
    assert.equal(otherList.body.data.tokens.length, 0);
    assert.equal(otherDelete.status, 404);
    assert.equal(ownerDelete.status, 200);
    assert.equal(ownerDelete.body.data.revoked, true);
  });

  it("requires authentication", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/mcp/tokens");
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 1);
  });
});

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
            resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : undefined });
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
