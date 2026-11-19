import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

const execFileAsync = promisify(execFile);

const mockBackendClient = {
  async createSession() {},
  async killSession() {},
  async capturePane() {
    return "";
  },
  async listSessions() {
    return [];
  }
};

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

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

describe("project metadata, git mutations, and workspace file create/rename routes", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;

  before(async () => {
    const app = createGatewayApp({
      sessionServerIpcPath: "/tmp/forgebadger-test-session-server.sock",
      jwtSecret,
      masterKey,
      db: createTestDb(),
      sessionManager: new InMemorySessionManager(mockBackendClient as never),
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

  after(() => {
    server.close();
  });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as { data: { token: string } };
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.token;
  }

  async function api(token: string, pathname: string, init: RequestInit = {}) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
    const body = (await res.json()) as { code: number; message: string; data?: Record<string, unknown> };
    return { status: res.status, body };
  }

  it("scans git/codegraph readiness, initializes git on create, updates metadata, and returns git summaries", async () => {
    const token = await register("scan-init-owner@test.com");
    const otherToken = await register("scan-init-other@test.com");

    const scanDir = await mkdtemp(path.join(tmpdir(), "forgebadger-scan-git-"));
    await git(scanDir, "init", "-b", "feat/vibe");
    await writeFile(path.join(scanDir, "CLAUDE.md"), "# Rules\n", "utf8");
    await mkdir(path.join(scanDir, ".codegraph"), { recursive: true });
    await writeFile(path.join(scanDir, ".codegraph", "codegraph.db"), "", "utf8");

    const scan = await api(token, "/api/v1/projects/scan", {
      method: "POST",
      body: JSON.stringify({ path: scanDir })
    });
    assert.equal(scan.status, 200);
    assert.deepEqual(scan.body.data?.instructionFiles, ["CLAUDE.md"]);
    assert.equal(scan.body.data?.isGitRepo, true);
    assert.equal(scan.body.data?.gitBranch, "feat/vibe");
    assert.equal(scan.body.data?.gitChangedCount, 2);
    assert.equal(scan.body.data?.hasCodeGraph, true);

    const newRoot = path.join(await mkdtemp(path.join(tmpdir(), "forgebadger-create-git-")), "app");
    const created = await api(token, "/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Init Git App",
        path: newRoot,
        description: "Initial description",
        initGit: true
      })
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const project = created.body.data?.project as { id: string; name: string; description: string | null };
    assert.equal(existsSync(path.join(newRoot, ".git")), true);

    const updated = await api(token, `/api/v1/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed App", description: "Updated summary" })
    });
    assert.equal(updated.status, 200);
    assert.equal((updated.body.data?.project as { name: string }).name, "Renamed App");
    assert.equal((updated.body.data?.project as { description: string | null }).description, "Updated summary");

    const crossUpdate = await api(otherToken, `/api/v1/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Hijacked" })
    });
    assert.equal(crossUpdate.status, 404);

    const summaries = await api(token, "/api/v1/projects/git-summaries");
    assert.equal(summaries.status, 200);
    const map = summaries.body.data?.summaries as Record<string, { isGitRepo: boolean; branch: string | null }>;
    assert.equal(map[project.id]?.isGitRepo, true);
  });

  it("supports controlled git stage, unstage, commit, and discard operations", async () => {
    const token = await register("git-mutate@test.com");
    const repoDir = await mkdtemp(path.join(tmpdir(), "forgebadger-git-mutate-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "test@forgebadger.local");
    await git(repoDir, "config", "user.name", "Tester");
    await writeFile(path.join(repoDir, "app.ts"), "export const v = 1;\n", "utf8");
    await git(repoDir, "add", "app.ts");
    await git(repoDir, "commit", "-m", "init");

    const imported = await api(token, "/api/v1/projects/import", {
      method: "POST",
      body: JSON.stringify({ name: "Git Mutate", path: repoDir })
    });
    const projectId = (imported.body.data?.project as { id: string }).id;

    await writeFile(path.join(repoDir, "app.ts"), "export const v = 2;\n", "utf8");
    await writeFile(path.join(repoDir, "junk.txt"), "remove me\n", "utf8");

    const nothingStaged = await api(token, `/api/v1/projects/${projectId}/git-commit`, {
      method: "POST",
      body: JSON.stringify({ message: "Should fail" })
    });
    assert.equal(nothingStaged.status, 409);

    const staged = await api(token, `/api/v1/projects/${projectId}/git-stage`, {
      method: "POST",
      body: JSON.stringify({ paths: ["app.ts"] })
    });
    assert.equal(staged.status, 200);

    const unstaged = await api(token, `/api/v1/projects/${projectId}/git-unstage`, {
      method: "POST",
      body: JSON.stringify({ paths: ["app.ts"] })
    });
    assert.equal(unstaged.status, 200);

    await api(token, `/api/v1/projects/${projectId}/git-stage`, {
      method: "POST",
      body: JSON.stringify({ paths: ["app.ts"] })
    });
    const committed = await api(token, `/api/v1/projects/${projectId}/git-commit`, {
      method: "POST",
      body: JSON.stringify({ message: "update app" })
    });
    assert.equal(committed.status, 200);
    assert.ok(committed.body.data?.hash);

    await writeFile(path.join(repoDir, "app.ts"), "export const v = 999;\n", "utf8");
    const discardedTracked = await api(token, `/api/v1/projects/${projectId}/git-discard`, {
      method: "POST",
      body: JSON.stringify({ path: "app.ts", untracked: false })
    });
    assert.equal(discardedTracked.status, 200);
    assert.equal(await readFile(path.join(repoDir, "app.ts"), "utf8"), "export const v = 2;\n");

    const discardedUntracked = await api(token, `/api/v1/projects/${projectId}/git-discard`, {
      method: "POST",
      body: JSON.stringify({ path: "junk.txt", untracked: true })
    });
    assert.equal(discardedUntracked.status, 200);
    assert.equal(existsSync(path.join(repoDir, "junk.txt")), false);

    const unsafeDiscard = await api(token, `/api/v1/projects/${projectId}/git-discard`, {
      method: "POST",
      body: JSON.stringify({ path: ".git/config", untracked: true })
    });
    assert.equal(unsafeDiscard.status, 400);

    const upperGitDiscard = await api(token, `/api/v1/projects/${projectId}/git-discard`, {
      method: "POST",
      body: JSON.stringify({ path: ".GIT/config", untracked: true })
    });
    assert.equal(upperGitDiscard.status, 400);

    // Stale untracked=true against a tracked modified file must refuse without deleting the file.
    await writeFile(path.join(repoDir, "app.ts"), "export const v = 3;\n", "utf8");
    const staleUntrackedDiscard = await api(token, `/api/v1/projects/${projectId}/git-discard`, {
      method: "POST",
      body: JSON.stringify({ path: "app.ts", untracked: true })
    });
    assert.equal(staleUntrackedDiscard.status, 400);
    assert.equal(existsSync(path.join(repoDir, "app.ts")), true);
    assert.equal(await readFile(path.join(repoDir, "app.ts"), "utf8"), "export const v = 3;\n");

    // Cleanly discards a newly staged and edited ("AM") file without failing git checkout.
    await writeFile(path.join(repoDir, "draft.ts"), "export const d = 1;\n", "utf8");
    await api(token, `/api/v1/projects/${projectId}/git-stage`, {
      method: "POST",
      body: JSON.stringify({ paths: ["draft.ts"] })
    });
    await writeFile(path.join(repoDir, "draft.ts"), "export const d = 2;\n", "utf8");
    const discardedAddedModified = await api(token, `/api/v1/projects/${projectId}/git-discard`, {
      method: "POST",
      body: JSON.stringify({ path: "draft.ts", untracked: false })
    });
    assert.equal(discardedAddedModified.status, 200, JSON.stringify(discardedAddedModified.body));
    assert.equal(existsSync(path.join(repoDir, "draft.ts")), false);
  });

  it("creates and renames workspace files safely while blocking symlink escapes and collisions", async () => {
    const token = await register("workspace-create@test.com");
    const rootDir = await mkdtemp(path.join(tmpdir(), "forgebadger-ws-create-"));
    const outsideDir = await mkdtemp(path.join(tmpdir(), "forgebadger-ws-outside-"));
    await symlink(outsideDir, path.join(rootDir, "linked-dir"));

    const imported = await api(token, "/api/v1/projects/import", {
      method: "POST",
      body: JSON.stringify({ name: "Workspace Create", path: rootDir })
    });
    const projectId = (imported.body.data?.project as { id: string }).id;

    const created = await api(token, `/api/v1/projects/${projectId}/workspace/file`, {
      method: "POST",
      body: JSON.stringify({ path: "src/hello.ts", content: "export const hi = true;\n" })
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(await readFile(path.join(rootDir, "src", "hello.ts"), "utf8"), "export const hi = true;\n");

    const duplicate = await api(token, `/api/v1/projects/${projectId}/workspace/file`, {
      method: "POST",
      body: JSON.stringify({ path: "src/hello.ts", content: "overwrite" })
    });
    assert.equal(duplicate.status, 400);

    const escaped = await api(token, `/api/v1/projects/${projectId}/workspace/file`, {
      method: "POST",
      body: JSON.stringify({ path: "linked-dir/pwned.txt", content: "bad" })
    });
    assert.equal(escaped.status, 400);
    assert.equal(existsSync(path.join(outsideDir, "pwned.txt")), false);

    const upperGitCreate = await api(token, `/api/v1/projects/${projectId}/workspace/file`, {
      method: "POST",
      body: JSON.stringify({ path: ".GIT/hooks/pre-commit", content: "#!/bin/sh\n" })
    });
    assert.equal(upperGitCreate.status, 400);

    const moveIntoSelf = await api(token, `/api/v1/projects/${projectId}/workspace/rename`, {
      method: "POST",
      body: JSON.stringify({ fromPath: "src", toPath: "src/nested/src" })
    });
    assert.equal(moveIntoSelf.status, 400);
    assert.equal(existsSync(path.join(rootDir, "src", "nested")), false);

    const renamed = await api(token, `/api/v1/projects/${projectId}/workspace/rename`, {
      method: "POST",
      body: JSON.stringify({ fromPath: "src/hello.ts", toPath: "src/renamed.ts" })
    });
    assert.equal(renamed.status, 200);
    assert.equal(existsSync(path.join(rootDir, "src", "hello.ts")), false);
    assert.equal(await readFile(path.join(rootDir, "src", "renamed.ts"), "utf8"), "export const hi = true;\n");
  });
});
