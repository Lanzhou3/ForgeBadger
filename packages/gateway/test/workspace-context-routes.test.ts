import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
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

process.env.FORGEBADGER_JWT_SECRET = jwtSecret;
process.env.FORGEBADGER_MASTER_KEY = masterKey;

interface AuthResponseBody {
  data: {
    token: string;
  };
}

interface ProjectResponseBody {
  data: {
    project: {
      id: string;
    };
  };
}

interface WorkspaceTreeResponseBody {
  code: number;
  message: string;
  data?: {
    projectId: string;
    rootPath: string;
    path: string;
    entries: WorkspaceTreeEntry[];
    truncated: boolean;
  };
}

interface WorkspaceTreeEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  sizeBytes?: number;
  children?: WorkspaceTreeEntry[];
}

interface WorkspaceFileResponseBody {
  code: number;
  message: string;
  data?: {
    projectId: string;
    path: string;
    name: string;
    sizeBytes: number;
    encoding: "utf8";
    content: string;
    truncated: boolean;
    binary: boolean;
  };
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

describe("workspace context routes", () => {
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

  it("lists a project-rooted file tree and reads bounded text content", async () => {
    const token = await register("workspace-owner@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-workspace-tree-"));
    await mkdir(path.join(rootPath, "src"), { recursive: true });
    await writeFile(path.join(rootPath, "README.md"), "# Workspace\n", "utf8");
    await writeFile(path.join(rootPath, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const canonicalRootPath = await realpath(rootPath);
    const projectId = await importProject(token, rootPath);

    const treeRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/workspace/tree?depth=2&limit=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const treeBody = (await treeRes.json()) as WorkspaceTreeResponseBody;

    assert.equal(treeRes.status, 200, JSON.stringify(treeBody));
    assert.equal(treeBody.code, 0);
    assert.equal(treeBody.message, "");
    assert.equal(treeBody.data?.projectId, projectId);
    assert.equal(treeBody.data?.rootPath, canonicalRootPath);
    assert.equal(treeBody.data?.path, "");
    assert.equal(treeBody.data?.truncated, false);
    const readme = treeBody.data?.entries.find((entry) => entry.path === "README.md");
    assert.equal(readme?.kind, "file");
    assert.equal(readme?.sizeBytes, Buffer.byteLength("# Workspace\n"));
    const src = treeBody.data?.entries.find((entry) => entry.path === "src");
    assert.equal(src?.kind, "directory");
    assert.ok(src?.children?.some((entry) => entry.path === "src/index.ts"));

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/workspace/file?path=${encodeURIComponent("src/index.ts")}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const fileBody = (await fileRes.json()) as WorkspaceFileResponseBody;

    assert.equal(fileRes.status, 200, JSON.stringify(fileBody));
    assert.equal(fileBody.code, 0);
    assert.equal(fileBody.data?.projectId, projectId);
    assert.equal(fileBody.data?.path, "src/index.ts");
    assert.equal(fileBody.data?.name, "index.ts");
    assert.equal(fileBody.data?.content, "export const value = 1;\n");
    assert.equal(fileBody.data?.truncated, false);
    assert.equal(fileBody.data?.binary, false);
  });

  it("rejects traversal, absolute paths, symlink escapes, and binary text reads", async () => {
    const token = await register("workspace-boundary@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-workspace-boundary-"));
    const outsidePath = await mkdtemp(path.join(tmpdir(), "forgebadger-workspace-outside-"));
    await writeFile(path.join(rootPath, "README.md"), "# Safe\n", "utf8");
    await writeFile(path.join(rootPath, "asset.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(outsidePath, "secret.txt"), "secret\n", "utf8");
    await symlink(path.join(outsidePath, "secret.txt"), path.join(rootPath, "secret-link.txt"));
    const projectId = await importProject(token, rootPath);

    const traversal = await requestWorkspace(token, projectId, "/workspace/tree?path=..");
    const absolute = await requestWorkspace(
      token,
      projectId,
      `/workspace/file?path=${encodeURIComponent(path.join(rootPath, "README.md"))}`
    );
    const symlinkEscape = await requestWorkspace(token, projectId, "/workspace/file?path=secret-link.txt");
    const binary = await requestWorkspace(token, projectId, "/workspace/file?path=asset.bin");

    for (const response of [traversal, absolute, symlinkEscape, binary]) {
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.equal(response.body.code, 1);
      assert.equal(typeof response.body.message, "string");
      assert.ok(!("data" in response.body));
    }
  });

  it("saves workspace file content for the owning tenant only", async () => {
    const token = await register("workspace-editor@test.com");
    const otherToken = await register("workspace-editor-other@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-workspace-edit-"));
    await writeFile(path.join(rootPath, "README.md"), "# Before\n", "utf8");
    const projectId = await importProject(token, rootPath);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/workspace/file`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: "README.md", content: "# After\n" })
    });
    const body = (await res.json()) as WorkspaceFileResponseBody;

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.code, 0);
    assert.equal(body.data?.projectId, projectId);
    assert.equal(body.data?.path, "README.md");
    assert.equal(body.data?.content, "# After\n");
    assert.equal(body.data?.sizeBytes, Buffer.byteLength("# After\n"));
    assert.equal(body.data?.truncated, false);
    assert.equal(body.data?.binary, false);
    assert.equal(await readFile(path.join(rootPath, "README.md"), "utf8"), "# After\n");

    const crossTenant = await fetch(`${baseUrl}/api/v1/projects/${projectId}/workspace/file`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${otherToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: "README.md", content: "# Hacked\n" })
    });
    const crossBody = (await crossTenant.json()) as { code: number; message: string };
    assert.equal(crossTenant.status, 404);
    assert.deepEqual(crossBody, { code: 1, message: "Project not found" });
    assert.equal(await readFile(path.join(rootPath, "README.md"), "utf8"), "# After\n");
  });

  it("rejects oversized, binary, missing, and escaping workspace file writes", async () => {
    const token = await register("workspace-edit-boundary@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-workspace-edit-boundary-"));
    const outsidePath = await mkdtemp(path.join(tmpdir(), "forgebadger-workspace-edit-outside-"));
    await writeFile(path.join(rootPath, "README.md"), "# Safe\n", "utf8");
    await writeFile(path.join(rootPath, "big.bin"), Buffer.alloc(64 * 1024 + 1, 1));
    await writeFile(path.join(outsidePath, "secret.txt"), "secret\n", "utf8");
    await symlink(path.join(outsidePath, "secret.txt"), path.join(rootPath, "write-link.txt"));
    const projectId = await importProject(token, rootPath);

    const oversized = await requestWorkspaceWrite(
      token,
      projectId,
      { path: "README.md", content: "x".repeat(1024 * 1024 + 1) },
    );
    const tooLargeToLoad = await requestWorkspaceWrite(token, projectId, { path: "big.bin", content: "shrink\n" });
    const binary = await requestWorkspaceWrite(token, projectId, { path: "README.md", content: "a\u0000b" });
    const missing = await requestWorkspaceWrite(token, projectId, { path: "does-not-exist.md", content: "new\n" });
    const absolute = await requestWorkspaceWrite(
      token,
      projectId,
      { path: path.join(rootPath, "README.md"), content: "x\n" },
    );
    const symlinkEscape = await requestWorkspaceWrite(token, projectId, { path: "write-link.txt", content: "x\n" });
    const invalid = await requestWorkspaceWrite(token, projectId, { path: "README.md" });

    for (const response of [oversized, tooLargeToLoad, binary, missing, absolute, symlinkEscape, invalid]) {
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.equal(response.body.code, 1);
      assert.equal(typeof response.body.message, "string");
      assert.ok(!("data" in response.body));
    }
    assert.equal(await readFile(path.join(rootPath, "README.md"), "utf8"), "# Safe\n");
    assert.equal(await readFile(path.join(outsidePath, "secret.txt"), "utf8"), "secret\n");
  });

  it("returns 404 for cross-tenant workspace context requests", async () => {
    const ownerToken = await register("workspace-cross-owner@test.com");
    const otherToken = await register("workspace-cross-other@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-workspace-cross-"));
    await writeFile(path.join(rootPath, "README.md"), "# Private\n", "utf8");
    const projectId = await importProject(ownerToken, rootPath);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/workspace/tree`, {
      headers: { Authorization: `Bearer ${otherToken}` }
    });
    const body = (await res.json()) as { code: number; message: string };

    assert.equal(res.status, 404);
    assert.deepEqual(body, { code: 1, message: "Project not found" });
  });

  async function requestWorkspace(token: string, projectId: string, suffix: string) {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as { code: number; message: string };
    return { status: res.status, body };
  }

  async function requestWorkspaceWrite(token: string, projectId: string, payload: unknown) {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/workspace/file`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const body = (await res.json()) as { code: number; message: string };
    return { status: res.status, body };
  }

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

  async function importProject(token: string, rootPath: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Workspace Context",
        path: rootPath,
        aiTool: "codex"
      })
    });
    const body = (await res.json()) as ProjectResponseBody;
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
