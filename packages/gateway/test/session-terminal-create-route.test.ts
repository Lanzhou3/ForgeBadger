import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createSessionRoutes } from "../src/routes/sessions.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { RuntimeAuthorizationInvalidator } from "../src/services/runtime-authorization-invalidation.js";
import type { TerminalBackendClient } from "../src/services/terminal-backend.js";
import { TERMINAL_SHELLS, type TerminalShell } from "../src/services/session-launch-plan.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789".repeat(2);

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

function fakeBackend(): TerminalBackendClient {
  return {
    async createSession() {},
    async killSession() {},
    async capturePane() {
      return "";
    },
    async listSessions() {
      return [];
    },
    async hasSession() {
      return true;
    },
    async showEnvironment() {
      return {};
    },
    async stageProgrammaticInput() {},
    async pressEnter() {}
  };
}

/** Always succeeds, so the shell probe is deterministic on any CI platform. */
const okRunner = async (): Promise<import("../src/lib/dependency-check.js").CommandResult> => ({
  exitCode: 0,
  stdout: "",
  stderr: ""
});

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

describe("POST /api/v1/sessions terminal shell validation", () => {
  let db: Database.Database;
  let userId: string;
  let token: string;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("terminal-route@example.com", "hash");
    userId = user.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use(
      "/api/v1/sessions",
      createSessionRoutes(
        db,
        masterKey,
        new InMemorySessionManager(fakeBackend()),
        new RuntimeAuthorizationInvalidator(),
        undefined,
        okRunner
      )
    );
  });

  async function createProject(): Promise<string> {
    return new ProjectRepository(db, userId).create({
      name: "term-p",
      path: "/tmp/term-p",
      aiTool: "claude"
    }).id;
  }

  async function postSession(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    const server = http.createServer(app);
    const baseUrl = await listen(server);
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("accepts every shell in the canonical TERMINAL_SHELLS list (no enum drift)", async () => {
    const projectId = await createProject();
    for (const shell of TERMINAL_SHELLS) {
      const res = await postSession({ projectId, aiTool: "terminal", shell });
      assert.equal(
        res.status,
        201,
        `shell "${shell}" should pass the route schema and probe, got ${res.status}: ${JSON.stringify(res.body)}`
      );
    }
  });

  it("creates a powershell session (regression: schema previously omitted 'powershell')", async () => {
    const projectId = await createProject();
    const res = await postSession({ projectId, aiTool: "terminal", shell: "powershell" });

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 0);
    const session = new SessionRepository(db, userId).getById(res.body.data.session.id);
    assert.equal(session?.aiTool, "terminal");
  });

  it("still rejects shells outside the canonical list", async () => {
    const projectId = await createProject();
    const res = await postSession({ projectId, aiTool: "terminal", shell: "fish" });
    assert.equal(res.status, 400);
    assert.equal(res.body.message, "Invalid input");
  });

  it("defaults to the platform shell when shell is omitted", async () => {
    const projectId = await createProject();
    const res = await postSession({ projectId, aiTool: "terminal" });
    assert.equal(res.status, 201);
    const session = new SessionRepository(db, userId).getById(res.body.data.session.id);
    assert.equal(session?.aiTool, "terminal");
  });
});

describe("GET /api/v1/sessions/shells (availability probe)", () => {
  let db: Database.Database;
  let token: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("shells-route@example.com", "hash");
    token = signJwt({ userId: user.id, email: user.email }, secret);
  });

  function buildApp(runner: import("../src/lib/dependency-check.js").CommandRunner): express.Express {
    const app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use(
      "/api/v1/sessions",
      createSessionRoutes(
        db,
        masterKey,
        new InMemorySessionManager(fakeBackend()),
        new RuntimeAuthorizationInvalidator(),
        undefined,
        runner
      )
    );
    return app;
  }

  it("reports every canonical shell with its availability", async () => {
    const app = buildApp(okRunner);
    const server = http.createServer(app);
    const baseUrl = await listen(server);
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions/shells`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.code, 0);
      const shells = body.data.shells as Array<{ shell: string; available: boolean; command: string }>;
      assert.deepEqual(
        shells.map((entry) => entry.shell).sort(),
        [...TERMINAL_SHELLS].sort()
      );
      for (const entry of shells) {
        assert.equal(entry.available, true, `${entry.shell} should be available under the ok runner`);
        assert.equal(typeof entry.command, "string");
        assert.ok(entry.command.length > 0);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("marks missing shells as unavailable (so the dialog can auto-fall-back)", async () => {
    const failingRunner: import("../src/lib/dependency-check.js").CommandRunner = async (command: string) =>
      command === "pwsh" || command === "zsh"
        ? { exitCode: 127, stdout: "", stderr: command + ": not found" }
        : { exitCode: 0, stdout: "", stderr: "" };
    const app = buildApp(failingRunner);
    const server = http.createServer(app);
    const baseUrl = await listen(server);
    try {
      const res = await fetch(`${baseUrl}/api/v1/sessions/shells`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      const byShell = new Map(
        (body.data.shells as Array<{ shell: string; available: boolean }>).map((entry) => [
          entry.shell,
          entry.available
        ])
      );
      assert.equal(byShell.get("pwsh"), false);
      assert.equal(byShell.get("zsh"), false);
      // Windows PowerShell 5.1 and cmd remain available on Windows.
      assert.equal(byShell.get("powershell"), true);
      assert.equal(byShell.get("cmd"), true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
