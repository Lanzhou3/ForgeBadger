import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

interface ProjectBody {
  code?: number;
  message?: string;
  data?: {
    project?: { id: string; templateId: string | null };
  };
}

interface ExtractBody {
  code?: number;
  message?: string;
  data?: {
    template?: { id: string; name: string; adapter: string };
    extracted?: Array<{ filePath: string; sizeBytes: number }>;
    skipped?: Array<{ path: string; reason: string }>;
  };
}

interface TemplateListBody {
  data?: {
    templates?: Array<{ id: string; name: string }>;
  };
}

async function makeProjectRoot(
  files: Record<string, string | Buffer>
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "forgebadger-extract-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  return root;
}

describe("extract project template (POST /projects/:id/templates)", () => {
  let db: Database;
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;

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
    return body.data.token as string;
  }

  async function createProject(token: string, rootPath: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: "Extract Fixture", path: rootPath })
    });
    const body = (await res.json()) as ProjectBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data?.project?.id as string;
  }

  async function extract(
    token: string,
    projectId: string,
    payload: Record<string, unknown>
  ): Promise<{ status: number; body: ExtractBody }> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let body: ExtractBody = {};
    try {
      body = JSON.parse(text) as ExtractBody;
    } catch {
      body = { code: -1, message: text };
    }
    return { status: res.status, body };
  }

  async function getProject(token: string, projectId: string) {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as ProjectBody;
    return body.data?.project ?? null;
  }

  it("extracts root files and the adapter config dir, reporting skips with reasons", async () => {
    const token = await register("extract-happy@test.com");
    const rootPath = await makeProjectRoot({
      "CLAUDE.md": "# Root instructions\n",
      ".claude/CLAUDE.md": "# Duplicated root instruction\n",
      ".claude/settings.json": "{\"model\": \"sonnet\"}\n",
      ".claude/settings.local.json": "{\"apiKey\": \"secret\"}\n",
      ".claude/.env": "ANTHROPIC_API_KEY=sk-test\n",
      ".claude/node_modules/junk.js": "module.exports = 1;\n",
      ".claude/skills/alpha/SKILL.md": "---\nname: alpha\n---\nDo alpha.\n",
      ".claude/skills/deep/nested/file/x.md": "too deep\n",
      ".claude/big.md": "x".repeat(128 * 1024 + 1),
      ".claude/binary.bin": Buffer.from([0xff, 0xfe, 0x00, 0x80])
    });
    const projectId = await createProject(token, rootPath);

    const { status, body } = await extract(token, projectId, {
      name: "Extracted Fixture",
      description: "Captured from a live project",
      adapter: "claude"
    });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.data?.template?.name, "Extracted Fixture");
    assert.equal(body.data?.template?.adapter, "claude");
    assert.deepEqual(
      body.data?.extracted,
      [
        { filePath: ".claude/settings.json", sizeBytes: Buffer.byteLength("{\"model\": \"sonnet\"}\n", "utf8") },
        { filePath: ".claude/skills/alpha/SKILL.md", sizeBytes: Buffer.byteLength("---\nname: alpha\n---\nDo alpha.\n", "utf8") },
        { filePath: "CLAUDE.md", sizeBytes: Buffer.byteLength("# Root instructions\n", "utf8") }
      ]
    );
    assert.deepEqual(body.data?.skipped, [
      { path: ".claude/.env", reason: "excluded_file" },
      { path: ".claude/CLAUDE.md", reason: "maps_to_existing_root_file" },
      { path: ".claude/big.md", reason: "file_too_large" },
      { path: ".claude/binary.bin", reason: "not_utf8" },
      { path: ".claude/node_modules", reason: "excluded_directory" },
      { path: ".claude/settings.local.json", reason: "excluded_file" },
      { path: ".claude/skills/deep/nested/file/x.md", reason: "depth_exceeded" }
    ]);

    const project = await getProject(token, projectId);
    assert.equal(project?.templateId, body.data?.template?.id, "bind defaults to true");
  });

  it("does not bind the project when bind is false", async () => {
    const token = await register("extract-nobind@test.com");
    const rootPath = await makeProjectRoot({ "CLAUDE.md": "# Keep unbound\n" });
    const projectId = await createProject(token, rootPath);

    const { status, body } = await extract(token, projectId, {
      name: "Unbound Template",
      adapter: "claude",
      bind: false
    });
    assert.equal(status, 201, JSON.stringify(body));

    const project = await getProject(token, projectId);
    assert.equal(project?.templateId, null, "bind=false must leave the project unbound");
  });

  it("infers the adapter from a legacy project aiTool designation", async () => {
    const token = await register("extract-legacy@test.com");
    const rootPath = await makeProjectRoot({ "CLAUDE.md": "# Legacy claude project\n" });
    const projectId = await createProject(token, rootPath);
    db.prepare("UPDATE projects SET ai_tool = 'claude' WHERE id = ?").run(projectId);

    const { status, body } = await extract(token, projectId, {
      name: "Legacy Infer"
    });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.data?.template?.adapter, "claude");
  });

  it("rejects extraction without an adapter for CLI-agnostic projects", async () => {
    const token = await register("extract-agnostic@test.com");
    const rootPath = await makeProjectRoot({ "CLAUDE.md": "# Agnostic project\n" });
    const projectId = await createProject(token, rootPath);

    const { status, body } = await extract(token, projectId, {
      name: "Needs Adapter"
    });
    assert.equal(status, 400);
    assert.equal(
      body.message,
      "An explicit adapter in the request body is required for CLI-agnostic projects"
    );
  });

  it("rejects a project root with no extractable AI config files", async () => {
    const token = await register("extract-empty@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-extract-empty-"));
    const projectId = await createProject(token, rootPath);

    const { status, body } = await extract(token, projectId, {
      name: "Nothing Here",
      adapter: "claude"
    });
    assert.equal(status, 400);
    assert.equal(body.message, "No extractable AI config files found in project");
  });

  it("rejects invalid bodies and unknown projects", async () => {
    const token = await register("extract-invalid@test.com");
    const rootPath = await makeProjectRoot({ "CLAUDE.md": "# Invalid\n" });
    const projectId = await createProject(token, rootPath);

    const missingName = await extract(token, projectId, { adapter: "claude" });
    assert.equal(missingName.status, 400);
    assert.equal(missingName.body.message, "Invalid input");

    const badAdapter = await extract(token, projectId, { name: "Bad", adapter: "gemini" });
    assert.equal(badAdapter.status, 400);
    assert.equal(badAdapter.body.message, "Invalid input");

    const unknown = await extract(token, "nonexistent-project", { name: "X", adapter: "claude" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.message, "Project not found");
  });

  it("keeps extracted templates isolated per tenant", async () => {
    const ownerToken = await register("extract-tenant-owner@test.com");
    const otherToken = await register("extract-tenant-other@test.com");
    const rootPath = await makeProjectRoot({ "CLAUDE.md": "# Owner template source\n" });
    const projectId = await createProject(ownerToken, rootPath);
    const { status, body } = await extract(ownerToken, projectId, {
      name: "Owner Extract",
      adapter: "claude"
    });
    assert.equal(status, 201, JSON.stringify(body));
    const templateId = body.data?.template?.id as string;

    const otherProject = await getProject(otherToken, projectId);
    assert.equal(otherProject, null, "other tenant must not see the project");

    const otherExtract = await extract(otherToken, projectId, { name: "Sneaky", adapter: "claude" });
    assert.equal(otherExtract.status, 404);

    const listRes = await fetch(`${baseUrl}/api/v1/templates`, {
      headers: { Authorization: `Bearer ${otherToken}` }
    });
    const list = (await listRes.json()) as TemplateListBody;
    assert.equal(listRes.status, 200);
    assert.ok(
      !list.data?.templates?.some((template) => template.id === templateId),
      "other tenant must not see the extracted template"
    );
  });
});
