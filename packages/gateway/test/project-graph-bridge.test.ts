/**
 * Internal copilot-bridge project-graph endpoints: the read-only CodeGraph
 * queries the dsh plugin exposes as project_graph_* tools. Covers tool-gate
 * wiring, tenant isolation, degraded states, and boundary validation.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createGatewayApp, type GatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import {
  buildEmptyProject,
  buildGraphFixture,
  makeTempRoot
} from "./helpers/project-graph-fixture.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const bridgeToken = "copilot-bridge-graph-token-0123456789abcdef";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

const mockTmuxClient = {
  async createSession() {},
  async killSession() {},
  async capturePane() {
    return "";
  },
  async listSessions() {
    return [];
  }
};

interface Envelope {
  code: number;
  data?: Record<string, unknown>;
  message?: string;
}

describe("copilot-bridge project graph endpoints", () => {
  let app: GatewayApp;
  let baseUrl: string;
  let owner: { id: string };
  let stranger: { id: string };
  let graphProjectId: string;
  let emptyProjectId: string;
  const cleanups: Array<() => void> = [];

  function bridgeHeaders(userId: string): Record<string, string> {
    return {
      authorization: `Bearer ${bridgeToken}`,
      "x-forgebadger-user-id": userId,
      "content-type": "application/json"
    };
  }

  before(async () => {
    const db = createTestDb();
    app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager(mockTmuxClient as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      copilotBridgeToken: bridgeToken
    });
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${address.port}`;

    owner = new UserRepository(db).create("graph-bridge-owner@example.com", "hash");
    stranger = new UserRepository(db).create("graph-bridge-stranger@example.com", "hash");

    const graphRoot = makeTempRoot("bridge-graph");
    buildGraphFixture(graphRoot.root);
    const emptyRoot = makeTempRoot("bridge-empty");
    buildEmptyProject(emptyRoot.root);
    cleanups.push(graphRoot.cleanup, emptyRoot.cleanup);

    const repo = new ProjectRepository(db, owner.id);
    graphProjectId = repo.create({ name: "graph", path: graphRoot.root, aiTool: "" }).id;
    emptyProjectId = repo.create({ name: "empty", path: emptyRoot.root, aiTool: "" }).id;
  });

  after(() => {
    app.server.close();
    for (const cleanup of cleanups) cleanup();
  });

  it("rejects requests without the bridge token", async () => {
    const res = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${graphProjectId}/graph/search?q=greet`,
      { headers: { "x-forgebadger-user-id": owner.id } }
    );
    assert.equal(res.status, 401);
  });

  it("searches symbols for the owning user", async () => {
    const res = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${graphProjectId}/graph/search?q=greet`,
      { headers: bridgeHeaders(owner.id) }
    );
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.equal(body.code, 0);
    const result = body.data?.result as { available: boolean; symbols: Array<{ id: string }> };
    assert.equal(result.available, true);
    assert.equal(result.symbols.length, 1);
    assert.equal(result.symbols[0].id, "fn:greet");
  });

  it("isolates tenants on every graph endpoint", async () => {
    const headers = bridgeHeaders(stranger.id);
    const search = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${graphProjectId}/graph/search?q=greet`,
      { headers }
    );
    // Foreign projects degrade to an unavailable index rather than leaking data.
    const searchBody = await search.json() as Envelope;
    const result = searchBody.data?.result as { available: boolean; reason?: string };
    assert.equal(result.available, false);

    const affected = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${graphProjectId}/graph/affected`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ paths: ["src/b.ts"] })
      }
    );
    const affectedBody = await affected.json() as Envelope;
    const affectedResult = affectedBody.data?.result as { available: boolean };
    assert.equal(affectedResult.available, false);
  });

  it("returns symbol detail with callers and callees", async () => {
    const res = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${graphProjectId}/graph/symbols/${encodeURIComponent("fn:main")}`,
      { headers: bridgeHeaders(owner.id) }
    );
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    const result = body.data?.result as {
      available: boolean;
      symbol: { id: string };
      callees: Array<{ id: string }>;
      callers: Array<{ id: string }>;
    };
    assert.equal(result.available, true);
    assert.equal(result.symbol.id, "fn:main");
    assert.deepEqual(result.callees.map((entry) => entry.id), ["fn:greet"]);
  });

  it("computes symbol impact over the internal API", async () => {
    const res = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${graphProjectId}/graph/symbols/${encodeURIComponent("fn:greet")}/impact?depth=2`,
      { headers: bridgeHeaders(owner.id) }
    );
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    const result = body.data?.result as { available: boolean; nodes: Array<{ id: string }> };
    assert.equal(result.available, true);
    const ids = result.nodes.map((node) => node.id).sort();
    // greet's dependents: main (calls) at depth 1, entry + file:c at depth 2.
    assert.deepEqual(ids, ["file:c", "fn:entry", "fn:greet", "fn:main"]);
  });

  it("computes changed-paths impact and validates traversal payloads", async () => {
    const ok = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${graphProjectId}/graph/affected`,
      {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ paths: ["src/b.ts"], depth: 2 })
      }
    );
    assert.equal(ok.status, 200);
    const okBody = await ok.json() as Envelope;
    const result = okBody.data?.result as { available: boolean; seededFiles: number; nodes: unknown[] };
    assert.equal(result.available, true);
    assert.equal(result.seededFiles, 1);

    const traversal = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${graphProjectId}/graph/affected`,
      {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ paths: ["../escape.ts"] })
      }
    );
    assert.equal(traversal.status, 400);
  });

  it("degrades to available:false for projects without an index", async () => {
    const res = await fetch(
      `${baseUrl}/api/internal/v1/copilot-bridge/projects/${emptyProjectId}/graph/search?q=anything`,
      { headers: bridgeHeaders(owner.id) }
    );
    assert.equal(res.status, 200);
    const body = await res.json() as Envelope;
    assert.deepEqual(body.data?.result, { available: false, reason: "not_initialized" });
  });
});
