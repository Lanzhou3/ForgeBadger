import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import {
  buildEmptyProject,
  buildGraphFixture,
  makeTempRoot
} from "./helpers/project-graph-fixture.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

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

const mockTmuxClient = {
  async createSession() {},
  async killSession() {},
  async capturePane() {
    return "";
  },
  async hasSession() {
    return true;
  },
  async showEnvironment() {
    return {};
  },
  async listSessions() {
    return [];
  }
};

interface TestContext {
  baseUrl: string;
  tokenA: string;
  tokenB: string;
  graphProjectId: string;
  emptyProjectId: string;
  deniedProjectId: string;
}

async function registerUser(
  baseUrl: string,
  email: string
): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  const data = await res.json();
  return { token: data.data.token as string, userId: data.data.user.id as string };
}

async function createProject(
  baseUrl: string,
  token: string,
  name: string,
  projectPath: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name, path: projectPath })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  return data.data.project.id as string;
}

/** Bypasses route validation to simulate a legacy misconfigured record. */
function insertRawProject(
  db: Database,
  userId: string,
  name: string,
  projectPath: string
): string {
  const id = `raw-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO projects (id, user_id, name, path, ai_tool, status, is_imported, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'claude', 'active', 0, strftime('%s','now') * 1000, strftime('%s','now') * 1000)`
  ).run(id, userId, name, projectPath);
  return id;
}

describe("project-graph routes", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let testDb: Database;
  let ctx: TestContext;
  let fixtureRoots: Array<{ cleanup: () => void }> = [];

  before(async () => {
    testDb = createTestDb();
    const sessionManager = new InMemorySessionManager(mockTmuxClient as never);
    const apiKeyStore = new InMemoryApiKeyStore({ masterKey });
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db: testDb,
      sessionManager,
      apiKeyStore
    });

    // Fixture projects on disk.
    const graphRoot = makeTempRoot("routes-graph");
    buildGraphFixture(graphRoot.root);
    const emptyRoot = makeTempRoot("routes-empty");
    buildEmptyProject(emptyRoot.root);
    fixtureRoots = [graphRoot, emptyRoot];

    await new Promise<void>((resolve) => {
      server = app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${
      address && typeof address !== "string" ? address.port : 0
    }`;

    const userA = await registerUser(baseUrl, "graph-a@test.com");
    const userB = await registerUser(baseUrl, "graph-b@test.com");

    ctx = {
      baseUrl,
      tokenA: userA.token,
      tokenB: userB.token,
      graphProjectId: await createProject(baseUrl, userA.token, "graph-project", graphRoot.root),
      emptyProjectId: await createProject(baseUrl, userA.token, "empty-project", emptyRoot.root),
      // Simulates a legacy/misconfigured record whose path is a denied system
      // root (the create route would reject it today).
      deniedProjectId: insertRawProject(testDb, userA.userId, "denied-project", "/etc")
    };
  });

  after(() => {
    server?.close();
    for (const fixture of fixtureRoots) fixture.cleanup();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/overview`
    );
    assert.equal(res.status, 401);
  });

  it("isolates tenants: user B cannot read user A's project graph", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/overview`,
      { headers: { Authorization: `Bearer ${ctx.tokenB}` } }
    );
    assert.equal(res.status, 404);
  });

  it("returns a graph overview envelope for the owning user", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/overview`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.code, 0);
    assert.equal(data.data.available, true);
    assert.equal(data.data.files.total, 3);
    assert.equal(data.data.indexState, "complete");
  });

  it("reports not_initialized for projects without a codegraph index", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.emptyProjectId}/graph/overview`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.data, { available: false, reason: "not_initialized" });
  });

  it("maps unsafe configured roots to 400", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.deniedProjectId}/graph/overview`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 1);
  });

  it("validates search parameters before touching the service", async () => {
    const headers = {
      Authorization: `Bearer ${ctx.tokenA}`
    };
    const missingQ = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/search`,
      { headers }
    );
    assert.equal(missingQ.status, 400);

    const longQ = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/search?q=${"x".repeat(101)}`,
      { headers }
    );
    assert.equal(longQ.status, 400);

    const badLimit = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/search?q=greet&limit=51`,
      { headers }
    );
    assert.equal(badLimit.status, 400);
  });

  it("searches symbols over HTTP", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/search?q=greet`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.data.available, true);
    assert.equal(data.data.symbols.length, 1);
    assert.equal(data.data.symbols[0].id, "fn:greet");
  });

  it("returns symbol detail with callers/callees", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/symbols/${encodeURIComponent("fn:main")}`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.data.available, true);
    assert.equal(data.data.symbol.id, "fn:main");
    assert.equal(data.data.callees.length, 1);
    assert.equal(data.data.callees[0].id, "fn:greet");
  });

  it("reports unknown symbols as not_found without server errors", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/symbols/${encodeURIComponent("x' OR 1=1 --")}`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.data, { available: false, reason: "not_found" });
  });

  it("computes impact over HTTP with bounded depth", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/symbols/${encodeURIComponent("fn:greet")}/impact?depth=2`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.data.available, true);
    const ids = data.data.nodes.map((node: { id: string }) => node.id).sort();
    // depth 1: fn:main (calls greet); depth 2: fn:entry (calls main) + file:c
    // (references main).
    assert.deepEqual(ids, ["file:c", "fn:entry", "fn:greet", "fn:main"]);

    const badDepth = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/symbols/${encodeURIComponent("fn:greet")}/impact?depth=9`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(badDepth.status, 400);
  });

  it("serves the file-level graph over HTTP", async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/file-graph`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.data.available, true);
    assert.equal(data.data.nodes.length, 3);
    assert.equal(data.data.edges.length, 2);

    const badLimit = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/file-graph?limit=201`,
      { headers: { Authorization: `Bearer ${ctx.tokenA}` } }
    );
    assert.equal(badLimit.status, 400);
  });

  it("computes changed-paths impact over HTTP", async () => {
    const post = (body: unknown) =>
      fetch(`${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/affected`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ctx.tokenA}`
        },
        body: JSON.stringify(body)
      });

    const res = await post({ paths: ["src/b.ts"], depth: 2 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.data.available, true);
    assert.equal(data.data.seededFiles, 1);
    // Affected set: main itself + its dependents (entry via calls, file:c via
    // references). Callee greet is unaffected.
    const ids = data.data.nodes.map((node: { id: string }) => node.id).sort();
    assert.deepEqual(ids, ["file:c", "fn:entry", "fn:main"]);

    // Tenant isolation on the new endpoint.
    const foreign = await fetch(
      `${ctx.baseUrl}/api/v1/projects/${ctx.graphProjectId}/graph/affected`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ctx.tokenB}`
        },
        body: JSON.stringify({ paths: ["src/b.ts"] })
      }
    );
    assert.equal(foreign.status, 404);

    // Traversal payloads are rejected at the boundary.
    const traversal = await post({ paths: ["../../etc/passwd"] });
    assert.equal(traversal.status, 400);

    // Absolute paths are rejected.
    const absolute = await post({ paths: ["/etc/passwd"] });
    assert.equal(absolute.status, 400);

    // Empty path list is rejected.
    const emptyList = await post({ paths: [] });
    assert.equal(emptyList.status, 400);
  });
});
