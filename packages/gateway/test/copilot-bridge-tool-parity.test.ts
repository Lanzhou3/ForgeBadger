/**
 * Integration tests for the tool-parity endpoints added to the internal
 * copilot-bridge API (projects / portfolio requests+dossier / memory), plus
 * the dsh-path capabilities surface. Pattern mirrors copilot-bridge-routes.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp, type GatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { UserRepository, type User } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { createPortfolioPhase4Fixture } from "./portfolio-phase4-fixture.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const bridgeToken = "copilot-bridge-parity-token-0123456789abcdef";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

const FAKE_LAUNCHER = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "fake-dsh-runtime.mjs");

const mockTmuxClient = {
  async createSession() {},
  async killSession() {},
  async capturePane() { return ""; },
  async listSessions() { return []; }
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

interface Envelope {
  code: number;
  data?: Record<string, unknown>;
  message?: string;
  details?: { code?: string };
}

async function listen(app: GatewayApp): Promise<string> {
  await new Promise<void>((resolve) => {
    app.server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

function bridgeHeaders(userId: string): Record<string, string> {
  return {
    authorization: `Bearer ${bridgeToken}`,
    "x-openforge-user-id": userId,
    "content-type": "application/json"
  };
}

describe("copilot bridge tool-parity endpoints", () => {
  let db: Database.Database;
  let app: GatewayApp;
  let baseUrl: string;
  let owner: User;
  let stranger: User;

  before(async () => {
    db = createTestDb();
    app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager(mockTmuxClient as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      copilotBridgeToken: bridgeToken
    });
    baseUrl = await listen(app);
    owner = new UserRepository(db).create("parity-owner@example.com", "hash");
    stranger = new UserRepository(db).create("parity-stranger@example.com", "hash");
  });

  after(async () => {
    await app.close();
  });

  describe("projects", () => {
    it("lists only the acting user's projects with the tool field shape", async () => {
      const created = new ProjectRepository(db, owner.id).create({
        name: "Parity project",
        path: "/tmp/openforge-parity-project",
        aiTool: "claude",
        description: "tool parity target"
      });
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/projects`, {
        headers: bridgeHeaders(owner.id)
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 200, JSON.stringify(body));
      const projects = body.data?.projects as Array<Record<string, unknown>>;
      const listed = projects.find((p) => p.id === created.id);
      assert.ok(listed, "owner project should be listed");
      assert.deepEqual(Object.keys(listed).sort(), ["aiTool", "description", "id", "name", "path", "status"]);
      assert.equal(listed.description, "tool parity target");

      const foreign = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/projects`, {
        headers: bridgeHeaders(stranger.id)
      });
      const foreignBody = (await foreign.json()) as Envelope;
      assert.equal(foreignBody.data?.count, 0);
    });

    it("gets a project detail and answers found:false for foreign or missing ids", async () => {
      const created = new ProjectRepository(db, owner.id).create({
        name: "Parity detail project",
        path: "/tmp/openforge-parity-detail",
        aiTool: "claude"
      });
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/projects/${created.id}`, {
        headers: bridgeHeaders(owner.id)
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data?.found, true);
      const project = body.data?.project as Record<string, unknown>;
      assert.equal(project.name, "Parity detail project");
      assert.ok("isImported" in project && "templateId" in project, "detail carries the full tool field set");

      const foreign = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/projects/${created.id}`, {
        headers: bridgeHeaders(stranger.id)
      });
      const foreignBody = (await foreign.json()) as Envelope;
      assert.equal(foreign.status, 200);
      assert.deepEqual(foreignBody.data, { found: false, project: null });

      const missing = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/projects/no-such-project`, {
        headers: bridgeHeaders(owner.id)
      });
      const missingBody = (await missing.json()) as Envelope;
      assert.equal(missingBody.data?.found, false);
    });

    it("creates a project for the acting user and validates input", async () => {
      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/projects`, {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ name: "Bridge created", path: "/tmp/openforge-bridge-created", description: "via bridge" })
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.data?.created, true);
      const projectId = body.data?.projectId as string;
      const row = db.prepare("SELECT user_id, name, description FROM projects WHERE id = ?").get(projectId) as Record<string, unknown>;
      assert.equal(row.user_id, owner.id);
      assert.equal(row.description, "via bridge");

      for (const bad of [{ name: "x" }, { path: "/tmp/x" }, { name: "", path: "/tmp/x" }, { name: "x", path: "/tmp/x", rogue: 1 }]) {
        const invalidRes = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/projects`, {
          method: "POST",
          headers: bridgeHeaders(owner.id),
          body: JSON.stringify(bad)
        });
        assert.equal(invalidRes.status, 400, JSON.stringify(bad));
      }
    });
  });

  describe("portfolio requests and dossier", () => {
    it("lists requests and reads the dossier for the acting user only", async () => {
      const fixture = createPortfolioPhase4Fixture({
        db,
        ownerEmail: "parity-portfolio-owner@example.com",
        fixtureKey: "parity-portfolio"
      });

      const res = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/portfolio/requests?projectId=${fixture.projectId}`, {
        headers: bridgeHeaders(fixture.owner.id)
      });
      const body = (await res.json()) as Envelope;
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.ok((body.data?.count as number) >= 1);

      const dossierRes = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/portfolio/projects/${fixture.projectId}/dossier`, {
        headers: bridgeHeaders(fixture.owner.id)
      });
      const dossierBody = (await dossierRes.json()) as Envelope;
      assert.equal(dossierRes.status, 200, JSON.stringify(dossierBody));
      assert.ok(dossierBody.data?.dossier, "dossier payload present");

      // Cross-user isolation: the facade is user-scoped, so the stranger sees nothing.
      const foreign = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/portfolio/requests`, {
        headers: bridgeHeaders(stranger.id)
      });
      const foreignBody = (await foreign.json()) as Envelope;
      assert.equal(foreignBody.data?.count, 0);

      const invalid = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/portfolio/requests?limit=0`, {
        headers: bridgeHeaders(fixture.owner.id)
      });
      assert.equal(invalid.status, 400);
    });
  });

  describe("memory", () => {
    it("writes, lists and searches scoped entries with tenant isolation", async () => {
      const write = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/memory/entries`, {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ kind: "fact", scope: "global", text: "singularity release freeze on friday" })
      });
      const writeBody = (await write.json()) as Envelope;
      assert.equal(write.status, 201, JSON.stringify(writeBody));
      assert.equal(writeBody.data?.saved, true);
      assert.ok(typeof writeBody.data?.id === "string");

      const list = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/memory/entries?scope=global`, {
        headers: bridgeHeaders(owner.id)
      });
      const listBody = (await list.json()) as Envelope;
      const entries = listBody.data?.entries as Array<Record<string, unknown>>;
      assert.ok(entries.some((e) => e.text === "singularity release freeze on friday" && e.kind === "fact"));

      const search = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/memory/search?q=singularity`, {
        headers: bridgeHeaders(owner.id)
      });
      const searchBody = (await search.json()) as Envelope;
      assert.ok((searchBody.data?.entries as unknown[]).length >= 1);

      const foreign = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/memory/entries`, {
        headers: bridgeHeaders(stranger.id)
      });
      const foreignBody = (await foreign.json()) as Envelope;
      assert.equal((foreignBody.data?.entries as unknown[]).length, 0);
    });

    it("rejects invalid kind, bad scope and project-scope without projectId", async () => {
      const badKind = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/memory/entries`, {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ kind: "secret", scope: "global", text: "x" })
      });
      assert.equal(badKind.status, 400);

      const projectNoId = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/memory/entries`, {
        method: "POST",
        headers: bridgeHeaders(owner.id),
        body: JSON.stringify({ kind: "project_note", scope: "project", text: "缺 projectId" })
      });
      const projectNoIdBody = (await projectNoId.json()) as Envelope;
      assert.equal(projectNoId.status, 400);
      assert.equal(projectNoIdBody.details?.code, "AGENT_MEMORY_PROJECT_REQUIRED");

      const badScope = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/memory/entries?scope=bogus`, {
        headers: bridgeHeaders(owner.id)
      });
      assert.equal(badScope.status, 400);

      const missingQuery = await fetch(`${baseUrl}/api/internal/v1/copilot-bridge/memory/search`, {
        headers: bridgeHeaders(owner.id)
      });
      assert.equal(missingQuery.status, 400);
    });
  });
});

describe("copilot capabilities on the dsh path", () => {
  let app: GatewayApp;
  let baseUrl: string;
  let stateDir: string;

  before(async () => {
    stateDir = mkdtempSync(path.join(tmpdir(), "openforge-dsh-capabilities-test-"));
    app = createGatewayApp({
      jwtSecret,
      masterKey,
      db: createTestDb(),
      sessionManager: new InMemorySessionManager(mockTmuxClient as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      dshCopilot: {
        launcherPath: FAKE_LAUNCHER,
        gatewayUrl: "http://127.0.0.1:1",
        bridgeToken,
        stateDir,
        idleMs: 60_000
      }
    });
    baseUrl = await listen(app);
  });

  after(async () => {
    await app.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("reports the dsh tool surface (25 tools, 5 approval-gated) instead of the in-process registry", async () => {
    const register = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dsh-capabilities@example.com", password: "password123" })
    });
    const registerBody = (await register.json()) as { data: { token: string } };
    const token = registerBody.data.token;

    const res = await fetch(`${baseUrl}/api/v1/copilot/capabilities`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as Envelope;
    assert.equal(res.status, 200, JSON.stringify(body));
    const tools = body.data?.tools as Array<{ name: string; risk: string; requiresApproval: boolean }>;
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      [
        "advance_work_item", "create_project", "dispatch_task_to_session", "get_project",
        "get_project_dossier", "get_session_output", "get_usage_summary", "get_work_item",
        "list_memory", "list_portfolio_requests", "list_projects", "list_sessions",
        "list_skills", "list_work_items", "load_skill", "pm_get_task_packet",
        "pm_list_task_packets",
        "pm_start_task_packet", "portfolio_overview", "project_graph_affected_paths",
        "project_graph_impact", "project_graph_search", "project_graph_symbol_detail",
        "search_memory", "write_memory"
      ]
    );
    const gated = tools.filter((t) => t.requiresApproval).map((t) => t.name).sort();
    assert.deepEqual(gated, ["advance_work_item", "create_project", "dispatch_task_to_session", "pm_start_task_packet", "write_memory"]);
    for (const tool of tools) {
      assert.equal(tool.risk === "operate", tool.requiresApproval, `${tool.name} risk/approval split`);
    }
  });
});
