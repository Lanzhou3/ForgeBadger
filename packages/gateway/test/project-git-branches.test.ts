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

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

const execFileAsync = promisify(execFile);

interface GitBranchesResponseBody {
  code: number;
  message: string;
  data?: {
    projectId: string;
    git: {
      isGitRepo: boolean;
      current: string | null;
      branches: { name: string; isCurrent: boolean }[];
      workingTree: { clean: boolean; changedCount: number; sample: string[] };
    };
  };
}

interface GitCheckoutResponseBody {
  code: number;
  message: string;
  details?: { changedCount?: number; sample?: string[] };
  data?: { projectId: string; current: string; created: boolean };
}

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

describe("project git branch routes", () => {
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

  it("lists branches with the current marker and a clean working tree", async () => {
    // Arrange
    const token = await register("git-branch-list@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-git-branch-list-"));
    await initRepo(rootPath);
    await git(rootPath, "branch", "feature-x");
    const projectId = await importProject(token, rootPath);

    // Act
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git-branches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as GitBranchesResponseBody;

    // Assert
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.data?.git.isGitRepo, true);
    assert.equal(body.data?.git.current, "main");
    assert.deepEqual(
      body.data?.git.branches.map((branch) => [branch.name, branch.isCurrent]),
      [["feature-x", false], ["main", true]]
    );
    assert.deepEqual(body.data?.git.workingTree, { clean: true, changedCount: 0, sample: [] });
  });

  it("switches to an existing branch when the working tree is clean", async () => {
    // Arrange
    const token = await register("git-branch-switch@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-git-branch-switch-"));
    await initRepo(rootPath);
    await git(rootPath, "branch", "feature-x");
    const projectId = await importProject(token, rootPath);

    // Act
    const res = await checkout(projectId, token, { branch: "feature-x" });
    const after1 = await fetchBranches(projectId, token);

    // Assert
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data?.current, "feature-x");
    assert.equal(res.body.data?.created, false);
    assert.equal(after1.data?.git.current, "feature-x");
  });

  it("creates a branch from HEAD and switches to it", async () => {
    // Arrange
    const token = await register("git-branch-create@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-git-branch-create-"));
    await initRepo(rootPath);
    const projectId = await importProject(token, rootPath);

    // Act
    const res = await checkout(projectId, token, { branch: "feature-new", create: true });
    const after1 = await fetchBranches(projectId, token);

    // Assert
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data?.created, true);
    assert.equal(after1.data?.git.current, "feature-new");
  });

  it("refuses to switch with uncommitted changes and reports the blockers", async () => {
    // Arrange
    const token = await register("git-branch-dirty@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-git-branch-dirty-"));
    await initRepo(rootPath);
    await git(rootPath, "branch", "feature-x");
    await writeFile(path.join(rootPath, "tracked.ts"), "export const v = 2;\n", "utf8");
    await writeFile(path.join(rootPath, "untracked.md"), "notes\n", "utf8");
    const projectId = await importProject(token, rootPath);

    // Act
    const res = await checkout(projectId, token, { branch: "feature-x" });

    // Assert
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 1);
    assert.match(res.body.message, /uncommitted/i);
    assert.equal((res.body.details?.changedCount ?? 0) >= 2, true);
    assert.ok(res.body.details?.sample?.includes("untracked.md"));
  });

  it("rejects unknown branches, invalid names, and duplicate creation", async () => {
    // Arrange
    const token = await register("git-branch-invalid@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-git-branch-invalid-"));
    await initRepo(rootPath);
    const projectId = await importProject(token, rootPath);

    // Act
    const missing = await checkout(projectId, token, { branch: "no-such-branch" });
    const optionInjection = await checkout(projectId, token, { branch: "--force" });
    const badRef = await checkout(projectId, token, { branch: "bad..name" });
    const duplicate = await checkout(projectId, token, { branch: "main", create: true });

    // Assert
    assert.equal(missing.status, 404);
    assert.equal(optionInjection.status, 400);
    assert.equal(badRef.status, 400);
    assert.equal(duplicate.status, 409);
  });

  it("returns 400 when the project is not a git repository", async () => {
    // Arrange
    const token = await register("git-branch-plain@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-git-branch-plain-"));
    await writeFile(path.join(rootPath, "README.md"), "# Plain\n", "utf8");
    const projectId = await importProject(token, rootPath);

    // Act
    const listRes = await fetchBranches(projectId, token);
    const switchRes = await checkout(projectId, token, { branch: "main" });

    // Assert
    assert.equal(listRes.data?.git.isGitRepo, false);
    assert.equal(switchRes.status, 400);
    assert.match(switchRes.body.message, /not a git repository/i);
  });

  it("returns 404 for cross-tenant branch operations", async () => {
    // Arrange
    const ownerToken = await register("git-branch-owner@test.com");
    const otherToken = await register("git-branch-other@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-git-branch-cross-"));
    await initRepo(rootPath);
    const projectId = await importProject(ownerToken, rootPath);

    // Act
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git-branches`, {
      headers: { Authorization: `Bearer ${otherToken}` }
    });
    const switchRes = await checkout(projectId, otherToken, { branch: "main" });

    // Assert
    assert.equal(listRes.status, 404);
    assert.equal(switchRes.status, 404);
  });

  async function fetchBranches(projectId: string, token: string): Promise<GitBranchesResponseBody> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git-branches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return (await res.json()) as GitBranchesResponseBody;
  }

  async function checkout(
    projectId: string,
    token: string,
    input: { branch: string; create?: boolean }
  ): Promise<{ status: number; body: GitCheckoutResponseBody }> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/git-checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    return { status: res.status, body: (await res.json()) as GitCheckoutResponseBody };
  }

  async function git(cwd: string, ...args: string[]): Promise<void> {
    await execFileAsync("git", args, { cwd });
  }

  async function initRepo(rootPath: string): Promise<void> {
    await git(rootPath, "init", "-b", "main");
    await writeFile(path.join(rootPath, "tracked.ts"), "export const v = 1;\n", "utf8");
    await git(rootPath, "add", "tracked.ts");
    await git(rootPath, "-c", "user.email=test@forgebadger.local", "-c", "user.name=Test", "commit", "-m", "initial commit");
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
        name: "Git Branches",
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
