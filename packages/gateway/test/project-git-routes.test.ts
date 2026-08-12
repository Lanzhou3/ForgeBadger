import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
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

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

const execFileAsync = promisify(execFile);

interface GitChangesResponseBody {
  code: number;
  message: string;
  data?: {
    projectId: string;
    git: {
      isGitRepo: boolean;
      branch?: string;
      changed: { path: string; status: string; staged: boolean }[];
      commits: { hash: string; subject: string; author: string; relativeDate: string }[];
    };
  };
}

interface GitDiffResponseBody {
  code: number;
  message: string;
  data?: {
    projectId: string;
    file: {
      path: string;
      kind: "diff" | "untracked";
      diff?: string;
      content?: string;
      truncated: boolean;
    };
  };
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

describe("project git-changes routes", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;

  before(async () => {
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db: createTestDb(),
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

  after(() => {
    server.close();
  });

  it("reports branch, working tree changes, and recent commits", async () => {
    const token = await register("git-owner@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-git-repo-"));
    await git(rootPath, "init", "-b", "main");
    await writeFile(path.join(rootPath, "tracked.ts"), "export const v = 1;\n", "utf8");
    await git(rootPath, "add", "tracked.ts");
    await git(rootPath, "-c", "user.email=test@openforge.local", "-c", "user.name=Test", "commit", "-m", "initial commit");
    await writeFile(path.join(rootPath, "tracked.ts"), "export const v = 2;\n", "utf8");
    await writeFile(path.join(rootPath, "untracked notes.md"), "notes\n", "utf8");
    const projectId = await importProject(token, rootPath);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git-changes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as GitChangesResponseBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.code, 0);
    assert.equal(body.data?.projectId, projectId);
    assert.equal(body.data?.git.isGitRepo, true);
    assert.equal(body.data?.git.branch, "main");
    const modified = body.data?.git.changed.find((entry) => entry.path === "tracked.ts");
    assert.equal(modified?.status.trim(), "M");
    assert.equal(modified?.staged, false);
    const untracked = body.data?.git.changed.find((entry) => entry.path === "untracked notes.md");
    assert.equal(untracked?.status, "??");
    assert.equal(body.data?.git.commits.length, 1);
    assert.equal(body.data?.git.commits[0]?.subject, "initial commit");
    assert.equal(body.data?.git.commits[0]?.author, "Test");
  });

  it("reports isGitRepo=false for directories without git", async () => {
    const token = await register("git-plain@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-git-plain-"));
    await writeFile(path.join(rootPath, "README.md"), "# Plain\n", "utf8");
    const projectId = await importProject(token, rootPath);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git-changes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as GitChangesResponseBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.git.isGitRepo, false);
    assert.deepEqual(body.data?.git.changed, []);
    assert.deepEqual(body.data?.git.commits, []);
  });

  it("serves per-file diffs and untracked file previews", async () => {
    const token = await register("git-diff@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-git-diff-"));
    await git(rootPath, "init", "-b", "main");
    await writeFile(path.join(rootPath, "tracked.ts"), "export const v = 1;\n", "utf8");
    await git(rootPath, "add", "tracked.ts");
    await git(rootPath, "-c", "user.email=test@openforge.local", "-c", "user.name=Test", "commit", "-m", "initial commit");
    await writeFile(path.join(rootPath, "tracked.ts"), "export const v = 2;\n", "utf8");
    await writeFile(path.join(rootPath, "fresh.ts"), "export const f = 1;\n", "utf8");
    const projectId = await importProject(token, rootPath);

    const diffRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/git-diff?path=${encodeURIComponent("tracked.ts")}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const diffBody = (await diffRes.json()) as GitDiffResponseBody;
    assert.equal(diffRes.status, 200, JSON.stringify(diffBody));
    assert.equal(diffBody.data?.file.kind, "diff");
    assert.match(diffBody.data?.file.diff ?? "", /-export const v = 1;/);
    assert.match(diffBody.data?.file.diff ?? "", /\+export const v = 2;/);
    assert.equal(diffBody.data?.file.truncated, false);

    const untrackedRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/git-diff?path=fresh.ts&untracked=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const untrackedBody = (await untrackedRes.json()) as GitDiffResponseBody;
    assert.equal(untrackedRes.status, 200, JSON.stringify(untrackedBody));
    assert.equal(untrackedBody.data?.file.kind, "untracked");
    assert.equal(untrackedBody.data?.file.content, "export const f = 1;\n");

    const traversalRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/git-diff?path=${encodeURIComponent("../outside.ts")}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(traversalRes.status, 400);
  });

  it("returns 404 for cross-tenant git-changes requests", async () => {
    const ownerToken = await register("git-cross-owner@test.com");
    const otherToken = await register("git-cross-other@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-git-cross-"));
    const projectId = await importProject(ownerToken, rootPath);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git-changes`, {
      headers: { Authorization: `Bearer ${otherToken}` }
    });
    const body = (await res.json()) as { code: number; message: string };

    assert.equal(res.status, 404);
    assert.deepEqual(body, { code: 1, message: "Project not found" });
  });

  async function git(cwd: string, ...args: string[]): Promise<void> {
    await execFileAsync("git", args, { cwd });
  }

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

  async function importProject(token: string, rootPath: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Git Changes",
        path: rootPath,
        aiTool: "codex"
      })
    });
    const body = (await res.json()) as { data: { project: { id: string } } };
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.project.id;
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
