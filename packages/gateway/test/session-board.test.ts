import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

interface AuthContext {
  token: string;
  userId: string;
}

interface SessionPayload {
  id: string;
  projectId: string;
  name: string;
  status: string;
  projectName?: string | null;
  lastPrompt?: string | null;
  attachToken?: string;
}

interface BoardTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  projectId: string;
  updatedAt: number;
}

interface BoardBody {
  code: number;
  message?: string;
  data?: {
    board: {
      projects: Array<{ id: string; name: string; path: string; status: string; aiTool: string }>;
      sessions: SessionPayload[];
      sessionTasks: Record<string, BoardTask[]>;
    };
  };
}

interface SessionBody {
  code: number;
  message?: string;
  data?: { session: SessionPayload };
}

let baseUrl: string;

describe("session board and last-prompt routes", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let db: Database.Database;

  before(async () => {
    db = createTestDb();
    const sessionManager = new InMemorySessionManager({
      async createSession() {},
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return [];
      }
    });
    const app = createGatewayApp({
      sessionServerIpcPath: "/tmp/forgebadger-test-session-board.sock",
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

  describe("PUT /api/v1/sessions/:id/last-prompt", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/sessions/any/last-prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hello" })
      });
      assert.equal(res.status, 401);
    });

    it("persists the prompt and returns it in the session payload", async () => {
      const auth = await register("last-prompt-write@example.com");
      const sessionId = createDbSession(auth, "Prompt Session");

      const res = await putLastPrompt(auth.token, sessionId, " 修一下登录页 ");
      const body = (await res.json()) as SessionBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.code, 0);
      assert.equal(body.data?.session.lastPrompt, "修一下登录页");
      assert.equal(body.data?.session.attachToken, undefined);

      const read = (await (
        await fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, { headers: jsonHeaders(auth.token) })
      ).json()) as SessionBody;
      assert.equal(read.data?.session.lastPrompt, "修一下登录页");
    });

    it("returns 404 for a missing session or another user's session", async () => {
      const owner = await register("last-prompt-owner@example.com");
      const other = await register("last-prompt-other@example.com");
      const sessionId = createDbSession(owner, "Owned Session");

      const missing = await putLastPrompt(owner.token, "no-such-session", "hello");
      assert.equal(missing.status, 404);

      const foreign = await putLastPrompt(other.token, sessionId, "hello");
      assert.equal(foreign.status, 404);

      const read = (await (
        await fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, { headers: jsonHeaders(owner.token) })
      ).json()) as SessionBody;
      assert.equal(read.data?.session.lastPrompt ?? null, null);
    });

    it("rejects empty prompts with 400", async () => {
      const auth = await register("last-prompt-empty@example.com");
      const sessionId = createDbSession(auth, "Empty Prompt Session");

      for (const prompt of ["", "   ", "\n\t "]) {
        const res = await putLastPrompt(auth.token, sessionId, prompt);
        assert.equal(res.status, 400, `prompt=${JSON.stringify(prompt)}`);
      }
    });

    it("rejects non-string prompts with 400", async () => {
      const auth = await register("last-prompt-type@example.com");
      const sessionId = createDbSession(auth, "Typed Prompt Session");

      const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/last-prompt`, {
        method: "PUT",
        headers: jsonHeaders(auth.token),
        body: JSON.stringify({ prompt: 42 })
      });
      assert.equal(res.status, 400);
    });

    it("truncates prompts longer than 500 characters", async () => {
      const auth = await register("last-prompt-truncate@example.com");
      const sessionId = createDbSession(auth, "Truncate Session");
      const longPrompt = "x".repeat(600);

      const res = await putLastPrompt(auth.token, sessionId, longPrompt);
      const body = (await res.json()) as SessionBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.data?.session.lastPrompt, "x".repeat(500));
    });

    it("is idempotent for repeated writes of the same value", async () => {
      const auth = await register("last-prompt-idempotent@example.com");
      const sessionId = createDbSession(auth, "Idempotent Session");

      const first = await putLastPrompt(auth.token, sessionId, "same prompt");
      const second = await putLastPrompt(auth.token, sessionId, "same prompt");
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const body = (await second.json()) as SessionBody;
      assert.equal(body.data?.session.lastPrompt, "same prompt");
    });
  });

  describe("GET /api/v1/sessions/board", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/sessions/board`);
      assert.equal(res.status, 401);
    });

    it("returns an empty board for a user with no projects or sessions", async () => {
      const auth = await register("board-empty@example.com");
      const res = await fetch(`${baseUrl}/api/v1/sessions/board`, { headers: jsonHeaders(auth.token) });
      const body = (await res.json()) as BoardBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.code, 0);
      assert.deepEqual(body.data?.board.projects, []);
      assert.deepEqual(body.data?.board.sessions, []);
      assert.deepEqual(body.data?.board.sessionTasks, {});
    });

    it("aggregates projects, sessions, and linked work items for the owner", async () => {
      const auth = await register("board-owner@example.com");
      const projectA = new ProjectRepository(db, auth.userId).create({
        name: "Board Alpha",
        path: "/tmp/board-alpha",
        aiTool: "claude"
      });
      const projectB = new ProjectRepository(db, auth.userId).create({
        name: "Board Beta",
        path: "/tmp/board-beta",
        aiTool: "kimi"
      });
      const sessionA = new SessionRepository(db, auth.userId).create({
        projectId: projectA.id,
        name: "Board Alpha",
        aiTool: "claude",
        workingDir: projectA.path
      });
      const sessionB1 = new SessionRepository(db, auth.userId).create({
        projectId: projectB.id,
        name: "Board Beta",
        aiTool: "kimi",
        workingDir: projectB.path
      });
      const sessionB2 = new SessionRepository(db, auth.userId).create({
        projectId: projectB.id,
        name: "Board Beta 2",
        aiTool: "kimi",
        workingDir: projectB.path
      });
      await putLastPrompt(auth.token, sessionA.id, "board prompt alpha");

      const pm = new ProjectManagerRepository(db, auth.userId);
      const taskA1 = pm.createWorkItem(projectA.id, {
        title: "Alpha task one",
        priority: 1,
        details: { taskPacket: { sessionId: sessionA.id } }
      });
      const taskA2 = pm.createWorkItem(projectA.id, {
        title: "Alpha task two",
        priority: 2,
        details: { taskPacket: { sessionId: sessionA.id } }
      });
      pm.createWorkItem(projectB.id, {
        title: "Beta task one",
        priority: 3,
        details: { taskPacket: { sessionId: sessionB1.id } }
      });
      pm.createWorkItem(projectB.id, {
        title: "Unlinked beta task",
        priority: 4
      });
      // Deterministic updatedAt ordering for the sessionA summary.
      db.prepare("UPDATE project_manager_work_items SET updated_at = ? WHERE id = ?")
        .run(taskA1.updatedAt + 60_000, taskA1.id);
      db.prepare("UPDATE project_manager_work_items SET updated_at = ? WHERE id = ?")
        .run(taskA2.updatedAt + 120_000, taskA2.id);

      const res = await fetch(`${baseUrl}/api/v1/sessions/board`, { headers: jsonHeaders(auth.token) });
      const body = (await res.json()) as BoardBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      const board = body.data?.board;
      assert.ok(board);
      assert.equal(board.projects.length, 2);
      assert.deepEqual(
        board.projects.map((project) => project.name).sort(),
        ["Board Alpha", "Board Beta"]
      );
      assert.equal(board.sessions.length, 3);
      const sessionById = new Map(board.sessions.map((session) => [session.id, session]));
      assert.equal(sessionById.get(sessionA.id)?.projectName, "Board Alpha");
      assert.equal(sessionById.get(sessionA.id)?.lastPrompt, "board prompt alpha");
      assert.equal(sessionById.get(sessionB1.id)?.projectName, "Board Beta");
      assert.equal(sessionById.get(sessionB2.id)?.lastPrompt ?? null, null);

      assert.deepEqual(Object.keys(board.sessionTasks).sort(), [sessionA.id, sessionB1.id].sort());
      const alphaTasks = board.sessionTasks[sessionA.id];
      assert.ok(alphaTasks);
      assert.deepEqual(
        alphaTasks.map((task) => task.title),
        ["Alpha task two", "Alpha task one"]
      );
      assert.equal(alphaTasks[0].status, "todo");
      assert.equal(alphaTasks[0].priority, 2);
      assert.equal(alphaTasks[0].projectId, projectA.id);
      assert.equal(typeof alphaTasks[0].updatedAt, "number");
      const betaTasks = board.sessionTasks[sessionB1.id];
      assert.ok(betaTasks);
      assert.deepEqual(
        betaTasks.map((task) => task.title),
        ["Beta task one"]
      );
    });

    it("never leaks work items bound to another user's session id", async () => {
      const owner = await register("board-tenant-owner@example.com");
      const other = await register("board-tenant-other@example.com");
      const ownerProject = new ProjectRepository(db, owner.userId).create({
        name: "Tenant Alpha",
        path: "/tmp/board-tenant-alpha",
        aiTool: "claude"
      });
      const ownerSession = new SessionRepository(db, owner.userId).create({
        projectId: ownerProject.id,
        name: "Tenant Alpha",
        aiTool: "claude",
        workingDir: ownerProject.path
      });
      const otherProject = new ProjectRepository(db, other.userId).create({
        name: "Tenant Beta",
        path: "/tmp/board-tenant-beta",
        aiTool: "claude"
      });
      new ProjectManagerRepository(db, other.userId).createWorkItem(otherProject.id, {
        title: "Foreign bound task",
        details: { taskPacket: { sessionId: ownerSession.id } }
      });

      const res = await fetch(`${baseUrl}/api/v1/sessions/board`, { headers: jsonHeaders(owner.token) });
      const body = (await res.json()) as BoardBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      const board = body.data?.board;
      assert.ok(board);
      assert.equal(board.sessions.length, 1);
      assert.deepEqual(board.sessionTasks, {});
      assert.equal(JSON.stringify(board).includes("Foreign bound task"), false);
    });

    it("strips attachToken, apiKeyId, modelId, and credentialMode from board sessions", async () => {
      const auth = await register("board-sanitize@example.com");
      const project = new ProjectRepository(db, auth.userId).create({
        name: "Sanitize Alpha",
        path: "/tmp/board-sanitize-alpha",
        aiTool: "claude"
      });
      const session = new SessionRepository(db, auth.userId).create({
        projectId: project.id,
        name: "Sanitize Alpha",
        aiTool: "claude",
        workingDir: project.path
      });

      const res = await fetch(`${baseUrl}/api/v1/sessions/board`, { headers: jsonHeaders(auth.token) });
      const body = (await res.json()) as BoardBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      const boardSession = body.data?.board.sessions.find((item) => item.id === session.id);
      assert.ok(boardSession);
      const leakedKeys = ["attachToken", "apiKeyId", "modelId", "credentialMode"]
        .filter((key) => key in boardSession);
      assert.deepEqual(leakedKeys, []);
    });

    it("skips work items whose details JSON is corrupt", async () => {
      const auth = await register("board-corrupt@example.com");
      const project = new ProjectRepository(db, auth.userId).create({
        name: "Corrupt Alpha",
        path: "/tmp/board-corrupt-alpha",
        aiTool: "claude"
      });
      const session = new SessionRepository(db, auth.userId).create({
        projectId: project.id,
        name: "Corrupt Alpha",
        aiTool: "claude",
        workingDir: project.path
      });
      const pm = new ProjectManagerRepository(db, auth.userId);
      pm.createWorkItem(project.id, {
        title: "Healthy task",
        details: { taskPacket: { sessionId: session.id } }
      });
      db.prepare(`
        INSERT INTO project_manager_work_items (
          id, user_id, project_id, title, status, priority,
          acceptance_criteria_json, evidence_refs_json, feishu_refs_json,
          details_json, stage_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        "corrupt-details-item",
        auth.userId,
        project.id,
        "Corrupt task",
        "todo",
        0,
        "[]",
        "[]",
        "[]",
        "{not-valid-json",
        Date.now(),
        Date.now()
      );

      const res = await fetch(`${baseUrl}/api/v1/sessions/board`, { headers: jsonHeaders(auth.token) });
      const body = (await res.json()) as BoardBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      const tasks = body.data?.board.sessionTasks[session.id];
      assert.ok(tasks);
      assert.deepEqual(
        tasks.map((task) => task.title),
        ["Healthy task"]
      );
    });

    it("caps session task summaries at 10 ordered by updatedAt desc", async () => {
      const auth = await register("board-cap@example.com");
      const project = new ProjectRepository(db, auth.userId).create({
        name: "Cap Alpha",
        path: "/tmp/board-cap-alpha",
        aiTool: "claude"
      });
      const session = new SessionRepository(db, auth.userId).create({
        projectId: project.id,
        name: "Cap Alpha",
        aiTool: "claude",
        workingDir: project.path
      });
      const pm = new ProjectManagerRepository(db, auth.userId);
      for (let index = 0; index < 12; index += 1) {
        pm.createWorkItem(project.id, {
          title: `Cap task ${index}`,
          details: { taskPacket: { sessionId: session.id } }
        });
      }
      const rows = db.prepare(
        "SELECT id, updated_at AS updatedAt FROM project_manager_work_items WHERE project_id = ? ORDER BY updated_at ASC, title ASC"
      ).all(project.id) as Array<{ id: string; updatedAt: number }>;
      rows.forEach((row, index) => {
        db.prepare("UPDATE project_manager_work_items SET updated_at = ? WHERE id = ?")
          .run(1_700_000_000_000 + index * 10_000, row.id);
      });

      const res = await fetch(`${baseUrl}/api/v1/sessions/board`, { headers: jsonHeaders(auth.token) });
      const body = (await res.json()) as BoardBody;

      assert.equal(res.status, 200, JSON.stringify(body));
      const tasks = body.data?.board.sessionTasks[session.id];
      assert.ok(tasks);
      assert.equal(tasks.length, 10);
      const updatedAts = tasks.map((task) => task.updatedAt);
      assert.deepEqual(updatedAts, [...updatedAts].sort((a, b) => b - a));
    });
  });

  function createDbSession(auth: AuthContext, name: string): string {
    const project = new ProjectRepository(db, auth.userId).create({
      name,
      path: `/tmp/forgebadger-${auth.userId}-${name.toLowerCase().replaceAll(" ", "-")}`,
      aiTool: "claude"
    });
    return new SessionRepository(db, auth.userId).create({
      projectId: project.id,
      name,
      aiTool: "claude",
      workingDir: project.path
    }).id;
  }

  async function putLastPrompt(token: string, sessionId: string, prompt: string) {
    return fetch(`${baseUrl}/api/v1/sessions/${sessionId}/last-prompt`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ prompt })
    });
  }
});

function createTestDb(): Database.Database {
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
