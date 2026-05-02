import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";

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
  async listSessions() {
    return [];
  }
};

interface AuthResponseBody {
  data: { token: string };
}

interface ProjectResponseBody {
  data: { project: { id: string } };
}

interface AgentResponseBody {
  data: { agent: { id: string; name: string } };
}

interface AgentSequenceResponseBody {
  code: number;
  message?: string;
  data?: {
    sequence: Array<{
      agentId: string;
      position: number;
      name: string;
      status: string;
    }>;
  };
}

interface AgentPackResponseBody {
  code: number;
  message?: string;
  data?: {
    agents: Array<{ id: string; name: string }>;
    created: Array<{ id: string; name: string }>;
    skipped: Array<{ id: string; name: string }>;
    sequence: Array<{ agentId: string; name: string; position: number }>;
  };
}

describe("project agent orchestration", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;
  let db: Database;

  before(async () => {
    db = createTestDb();
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager: new InMemorySessionManager(mockTmuxClient as never),
      apiKeyStore: new InMemoryApiKeyStore({ masterKey })
    });
    await new Promise<void>((resolve) => {
      server = app.server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address !== "string") {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    db.close();
  });

  it("stores and returns an ordered project Agent sequence", async () => {
    const token = await register("orchestration-owner@example.com");
    const projectId = await createProject(token, "Orchestration Project");
    const planner = await createAgent(token, projectId, "Planner");
    const reviewer = await createAgent(token, projectId, "Reviewer");

    const update = await putSequence(token, projectId, [reviewer.id, planner.id]);

    assert.equal(update.status, 200);
    assert.ok(update.body.data);
    assert.deepEqual(
      update.body.data.sequence.map((item) => [item.agentId, item.position, item.name]),
      [
        [reviewer.id, 0, "Reviewer"],
        [planner.id, 1, "Planner"]
      ]
    );

    const listed = await getSequence(token, projectId);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.data);
    assert.deepEqual(
      listed.body.data.sequence.map((item) => item.agentId),
      [reviewer.id, planner.id]
    );
  });

  it("rejects duplicate and out-of-project Agents in a project sequence", async () => {
    const token = await register("orchestration-invalid@example.com");
    const projectId = await createProject(token, "Primary Project");
    const otherProjectId = await createProject(token, "Other Project");
    const agent = await createAgent(token, projectId, "Project Agent");
    const otherAgent = await createAgent(token, otherProjectId, "Other Agent");

    const duplicate = await putSequence(token, projectId, [agent.id, agent.id]);
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.message ?? "", /duplicate/i);

    const crossProject = await putSequence(token, projectId, [agent.id, otherAgent.id]);
    assert.equal(crossProject.status, 400);
    assert.match(crossProject.body.message ?? "", /project/i);
  });

  it("does not expose another user's project Agent sequence", async () => {
    const ownerToken = await register("orchestration-private-owner@example.com");
    const otherToken = await register("orchestration-private-other@example.com");
    const projectId = await createProject(ownerToken, "Private Project");
    const agent = await createAgent(ownerToken, projectId, "Private Agent");
    await putSequence(ownerToken, projectId, [agent.id]);

    const listed = await getSequence(otherToken, projectId);
    assert.equal(listed.status, 404);
    assert.equal(listed.body.code, 1);

    const updated = await putSequence(otherToken, projectId, [agent.id]);
    assert.equal(updated.status, 404);
    assert.equal(updated.body.code, 1);
  });

  it("creates an idempotent default Agent pack for a project", async () => {
    const token = await register("orchestration-pack@example.com");
    const projectId = await createProject(token, "Pack Project");

    const created = await postDefaultAgentPack(token, projectId);

    assert.equal(created.status, 201);
    assert.ok(created.body.data);
    assert.deepEqual(
      created.body.data.created.map((agent) => agent.name),
      ["Planner", "Backend Developer", "Frontend Developer", "Code Reviewer", "Test Writer", "Security Reviewer"]
    );
    assert.deepEqual(
      created.body.data.sequence.map((item) => item.name),
      ["Planner", "Backend Developer", "Frontend Developer", "Code Reviewer", "Test Writer", "Security Reviewer"]
    );

    const repeated = await postDefaultAgentPack(token, projectId);

    assert.equal(repeated.status, 200);
    assert.ok(repeated.body.data);
    assert.equal(repeated.body.data.created.length, 0);
    assert.equal(repeated.body.data.skipped.length, 6);
  });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as AuthResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.token;
  }

  async function createProject(token: string, name: string): Promise<string> {
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-orchestration-"));
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        path: rootPath,
        aiTool: "claude"
      })
    });
    const body = (await res.json()) as ProjectResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.project.id;
  }

  async function createAgent(token: string, projectId: string, name: string): Promise<{ id: string; name: string }> {
    const res = await fetch(`${baseUrl}/api/v1/agents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ projectId, name })
    });
    const body = (await res.json()) as AgentResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.agent;
  }

  async function getSequence(
    token: string,
    projectId: string
  ): Promise<{ status: number; body: AgentSequenceResponseBody }> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agent-sequence`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return {
      status: res.status,
      body: (await res.json()) as AgentSequenceResponseBody
    };
  }

  async function putSequence(
    token: string,
    projectId: string,
    agentIds: string[]
  ): Promise<{ status: number; body: AgentSequenceResponseBody }> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agent-sequence`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ agentIds })
    });
    return {
      status: res.status,
      body: (await res.json()) as AgentSequenceResponseBody
    };
  }

  async function postDefaultAgentPack(
    token: string,
    projectId: string
  ): Promise<{ status: number; body: AgentPackResponseBody }> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/agents/default-pack`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    return {
      status: res.status,
      body: (await res.json()) as AgentPackResponseBody
    };
  }
});
