import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import type { LaunchPlan } from "../src/adapters/claude.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

interface AuthContext {
  token: string;
  userId: string;
}

interface OutputBody {
  code: number;
  message?: string;
  data?: { output: string; truncated: boolean; lineCount: number };
}

let baseUrl: string;

describe("session output route", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let db: Database;
  let sessionManager: InMemorySessionManager;
  const tmuxSessions: string[] = [];

  before(async () => {
    db = createTestDb();
    sessionManager = new InMemorySessionManager({
      async createSession(options) {
        tmuxSessions.push(options.name);
      },
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return tmuxSessions;
      }
    });
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      adapterCommandRunner: async () => ({ exitCode: 0, stdout: "test", stderr: "" })
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

  it("returns 401 without authentication", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/session-missing/output`);
    assert.equal(res.status, 401);
  });

  it("returns 404 for a session that does not exist", async () => {
    const auth = await register("output-missing@example.com");
    const res = await fetch(`${baseUrl}/api/v1/sessions/session-missing/output`, {
      headers: jsonHeaders(auth.token)
    });
    assert.equal(res.status, 404);
  });

  it("returns 404 for another user's session", async () => {
    const owner = await register("output-owner@example.com");
    const other = await register("output-other@example.com");
    const sessionId = createDbSession(owner);

    const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/output`, {
      headers: jsonHeaders(other.token)
    });
    assert.equal(res.status, 404);
  });

  it("returns the buffered tail with truncated and lineCount", async () => {
    const auth = await register("output-tail@example.com");
    const sessionId = createDbSession(auth);
    await seedLiveSession(auth.userId, sessionId, ["first\n", "second\n", "third\n"]);

    const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/output`, {
      headers: jsonHeaders(auth.token)
    });
    const body = (await res.json()) as OutputBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.code, 0);
    assert.equal(body.data?.output, "first\nsecond\nthird\n");
    assert.equal(body.data?.truncated, false);
    assert.equal(body.data?.lineCount, 3);
  });

  it("honors the maxLines query parameter", async () => {
    const auth = await register("output-maxlines@example.com");
    const sessionId = createDbSession(auth);
    await seedLiveSession(auth.userId, sessionId, ["one\n", "two\n", "three\n", "four\n", "five\n"]);

    const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/output?maxLines=2`, {
      headers: jsonHeaders(auth.token)
    });
    const body = (await res.json()) as OutputBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.output, "four\nfive\n");
  });

  it("returns 200 with empty output when a session has no buffer", async () => {
    const auth = await register("output-empty@example.com");
    const sessionId = createDbSession(auth);

    const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/output`, {
      headers: jsonHeaders(auth.token)
    });
    const body = (await res.json()) as OutputBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.data, { output: "", truncated: false, lineCount: 0 });
  });

  it("rejects invalid maxLines with 400", async () => {
    const auth = await register("output-invalid@example.com");
    const sessionId = createDbSession(auth);

    const tooSmall = await fetch(
      `${baseUrl}/api/v1/sessions/${sessionId}/output?maxLines=0`,
      { headers: jsonHeaders(auth.token) }
    );
    assert.equal(tooSmall.status, 400);

    const nonNumeric = await fetch(
      `${baseUrl}/api/v1/sessions/${sessionId}/output?maxLines=abc`,
      { headers: jsonHeaders(auth.token) }
    );
    assert.equal(nonNumeric.status, 400);
  });

  it("clears the buffer when the session is deleted", async () => {
    const auth = await register("output-delete@example.com");
    const sessionId = createDbSession(auth);
    await seedLiveSession(auth.userId, sessionId, ["hello\n"]);

    const before = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/output`, {
      headers: jsonHeaders(auth.token)
    });
    assert.equal(((await before.json()) as OutputBody).data?.output, "hello\n");

    const del = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: jsonHeaders(auth.token)
    });
    assert.equal(del.status, 200);

    assert.equal(sessionManager.getSessionOutput(sessionId), undefined);
  });

  function createDbSession(auth: AuthContext): string {
    const project = new ProjectRepository(db, auth.userId).create({
      name: "Output Project",
      path: "/tmp/openforge-session-output",
      aiTool: "claude"
    });
    const session = new SessionRepository(db, auth.userId).create({
      projectId: project.id,
      name: "Output Session",
      aiTool: "claude",
      workingDir: project.path
    });
    return session.id;
  }

  async function seedLiveSession(userId: string, sessionId: string, chunks: string[]): Promise<void> {
    await sessionManager.createSession({
      userId,
      sessionId,
      launchPlan: minimalLaunchPlan()
    });
    for (const chunk of chunks) {
      sessionManager.appendSessionOutput(sessionId, chunk);
    }
  }
});

function minimalLaunchPlan(): LaunchPlan {
  return {
    command: "bash",
    args: [],
    cwd: "/tmp",
    env: { OPENFORGE_SESSION_ID: "session-output-test" },
    secretEnvNames: [],
    credentialMode: "host_environment"
  };
}

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

async function register(email: string): Promise<AuthContext> {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  const body = (await res.json()) as { data: { token: string; user: { id: string } } };
  return { token: body.data.token, userId: body.data.user.id };
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}
