import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";

import { createMvp0Api } from "../src/mvp0/api.js";
import type { LaunchPlan } from "../src/adapters/claude.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";

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

describe("Gate D auth and project API contracts", () => {
  let api: ReturnType<typeof createMvp0Api>;
  const launched: Array<{ userId: string; sessionId: string; launchPlan: LaunchPlan }> = [];

  beforeEach(() => {
    const db = createTestDb();
    launched.length = 0;
    api = createMvp0Api({
      jwtSecret,
      db,
      sessionLauncher: {
        async createSession(input) {
          launched.push(input);
          return {
            id: input.sessionId,
            userId: input.userId,
            attachToken: "attach-token",
            tmuxName: `of-${input.userId.slice(0, 8)}-${input.sessionId}`,
            launchPlan: input.launchPlan,
            status: "running",
            createdAt: "2026-04-27T00:00:00.000Z",
            updatedAt: "2026-04-27T00:00:00.000Z"
          };
        }
      }
    });
  });

  it("registers and logs in a user with a JWT", async () => {
    const registered = await api.register({
      email: "dev@example.com",
      password: "correct horse battery staple"
    });

    assert.equal(registered.status, 201);
    assert.equal(registered.body.code, 0);
    assert.equal(registered.body.data.user.email, "dev@example.com");
    assert.match(registered.body.data.token, /^[^.]+\.[^.]+\.[^.]+$/u);

    const loggedIn = await api.login({
      email: "DEV@example.com",
      password: "correct horse battery staple"
    });
    assert.equal(loggedIn.status, 200);
    assert.equal(loggedIn.body.data.user.id, registered.body.data.user.id);
  });

  it("rejects invalid login credentials", async () => {
    await api.register({
      email: "dev@example.com",
      password: "correct horse battery staple"
    });

    const response = await api.login({
      email: "dev@example.com",
      password: "wrong password"
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.code, 1);
  });

  it("creates, imports, and lists projects only for the authenticated user", async () => {
    const alpha = await api.register({
      email: "alpha@example.com",
      password: "correct horse battery staple"
    });
    const beta = await api.register({
      email: "beta@example.com",
      password: "correct horse battery staple"
    });
    const createdRoot = await mkdtemp(path.join(tmpdir(), "forgebadger-created-project-"));
    const importedRoot = await mkdtemp(path.join(tmpdir(), "forgebadger-imported-project-"));
    const canonicalCreatedRoot = await realpath(createdRoot);
    const canonicalImportedRoot = await realpath(importedRoot);

    const created = await api.createProject(alpha.body.data.user.id, {
      name: "Created Project",
      rootPath: createdRoot
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.project.name, "Created Project");
    assert.equal(created.body.data.project.rootPath, canonicalCreatedRoot);

    const imported = await api.importProject(alpha.body.data.user.id, {
      name: "Imported Project",
      rootPath: importedRoot
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.data.project.name, "Imported Project");
    assert.equal(imported.body.data.project.rootPath, canonicalImportedRoot);

    const alphaProjects = await api.listProjects(alpha.body.data.user.id);
    assert.deepEqual(
      alphaProjects.body.data.projects.map((project) => project.id).sort(),
      [created.body.data.project.id, imported.body.data.project.id].sort()
    );

    const betaProjects = await api.listProjects(beta.body.data.user.id);
    assert.deepEqual(betaProjects.body.data.projects, []);
  });

  it("creates missing remote project directories before recording the project", async () => {
    const user = await api.register({
      email: "create-dir@example.com",
      password: "correct horse battery staple"
    });
    const parent = await mkdtemp(path.join(tmpdir(), "forgebadger-create-parent-"));
    const rootPath = path.join(parent, "missing", "project");

    const created = await api.createProject(user.body.data.user.id, {
      name: "Created Directory",
      rootPath
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.data.project.rootPath, await realpath(rootPath));
    assert.equal(created.body.data.project.source, "created");
    assert.equal((await stat(rootPath)).isDirectory(), true);
  });

  it("requires imported project directories to already exist", async () => {
    const user = await api.register({
      email: "import-dir@example.com",
      password: "correct horse battery staple"
    });
    const parent = await mkdtemp(path.join(tmpdir(), "forgebadger-import-parent-"));
    const rootPath = path.join(parent, "missing-project");

    const imported = await api.importProject(user.body.data.user.id, {
      name: "Missing Import",
      rootPath
    });

    assert.equal(imported.status, 400);
    assert.equal(imported.body.code, 1);
    assert.match(imported.body.message, /must already exist/i);
  });

  it("previews and writes the built-in Claude template with conflict decisions", async () => {
    const user = await api.register({
      email: "template@example.com",
      password: "correct horse battery staple"
    });
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-template-project-"));
    await writeFile(path.join(rootPath, "CLAUDE.md"), "existing", "utf8");
    const project = await api.createProject(user.body.data.user.id, {
      name: "Template Project",
      rootPath
    });

    const templates = await api.listTemplates();
    assert.equal(templates.body.data.templates[0].id, "builtin-claude-code");

    const preview = await api.previewProjectConfig(user.body.data.user.id, {
      projectId: project.body.data.project.id,
      templateId: "builtin-claude-code",
      credentialMode: "host_environment"
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.plan.files[0].relativePath, "CLAUDE.md");
    assert.equal(preview.body.data.conflicts[0].relativePath, "CLAUDE.md");

    const skipped = await api.writeProjectConfig(user.body.data.user.id, {
      projectId: project.body.data.project.id,
      templateId: "builtin-claude-code",
      credentialMode: "host_environment",
      decisions: { "CLAUDE.md": "skip" }
    });
    assert.equal(skipped.status, 200);
    assert.deepEqual(skipped.body.data.result.skippedFiles, ["CLAUDE.md"]);
    assert.equal(await readFile(path.join(rootPath, "CLAUDE.md"), "utf8"), "existing");
  });

  it("creates and lists Claude sessions for the authenticated user's project", async () => {
    const user = await api.register({
      email: "sessions@example.com",
      password: "correct horse battery staple"
    });
    const otherUser = await api.register({
      email: "other@example.com",
      password: "correct horse battery staple"
    });
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-session-project-"));
    const project = await api.createProject(user.body.data.user.id, {
      name: "Session Project",
      rootPath
    });

    const created = await api.createSession(user.body.data.user.id, {
      projectId: project.body.data.project.id,
      credentialMode: "host_environment"
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.session.status, "running");
    assert.equal(launched[0].launchPlan.command, "claude");
    assert.equal(launched[0].launchPlan.cwd, await realpath(rootPath));

    const sessions = await api.listSessions(user.body.data.user.id);
    assert.deepEqual(sessions.body.data.sessions.map((session) => session.id), [
      created.body.data.session.id
    ]);
    assert.equal(sessions.body.data.sessions[0].tmuxName, created.body.data.session.tmuxName);
    const otherSessions = await api.listSessions(otherUser.body.data.user.id);
    assert.deepEqual(otherSessions.body.data.sessions, []);
  });
});
