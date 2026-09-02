import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

interface AuthBody {
  data: { token: string };
}

interface ProjectBody {
  data: { project: { id: string } };
}

interface SessionBody {
  data?: {
    session: {
      id: string;
      attachToken?: string;
    };
  };
  message?: string;
}

describe("session launch hook credentials", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let db: Database;
  let baseUrl: string;
  const observedLaunches: Array<{
    sessionId: string;
    envAttachToken?: string;
    secretEnvNames: string[];
    persistedAttachToken?: string | null;
  }> = [];

  before(async () => {
    db = createTestDb();
    const sessionManager = new InMemorySessionManager({
      async createSession(input: { env: Record<string, string>; secretEnvNames?: string[] }) {
        const sessionId = input.env.FORGEBADGER_SESSION_ID;
        const row = db
          .prepare("SELECT attach_token as attachToken FROM sessions WHERE id = ?")
          .get(sessionId) as { attachToken: string | null } | undefined;
        observedLaunches.push({
          sessionId,
          envAttachToken: input.env.FORGEBADGER_ATTACH_TOKEN,
          secretEnvNames: input.secretEnvNames ?? [],
          persistedAttachToken: row?.attachToken
        });
      },
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return [];
      }
    } as never);
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      adapterCommandRunner: async (command: string) => ({ exitCode: 0, stdout: `${command} 3.3.8`, stderr: "" })
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

  it("persists the Claude hook attach token before tmux can emit early hook events", async () => {
    const token = await register("session-launch-hooks@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-session-hook-project-"));
    await mkdir(rootPath, { recursive: true });
    const project = await createProject(token, rootPath);

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        projectId: project.id,
        aiTool: "claude"
      })
    });
    const sessionBody = (await sessionRes.json()) as SessionBody;

    assert.equal(sessionRes.status, 201, sessionBody.message);
    const observed = observedLaunches.at(-1);
    assert.ok(observed);
    assert.equal(observed?.sessionId, sessionBody.data?.session.id);
    assert.equal(typeof observed?.envAttachToken, "string");
    assert.ok(observed?.envAttachToken);
    assert.equal(observed?.persistedAttachToken, observed?.envAttachToken);
  });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as AuthBody;
    return body.data.token;
  }

  async function createProject(token: string, rootPath: string): Promise<ProjectBody["data"]["project"]> {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        name: "Session Hook Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const body = (await res.json()) as ProjectBody;
    return body.data.project;
  }
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

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}
