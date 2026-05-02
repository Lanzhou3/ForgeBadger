import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

process.env.OPENFORGE_JWT_SECRET = jwtSecret;
process.env.OPENFORGE_MASTER_KEY = masterKey;

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

interface AuthContext {
  token: string;
  userId: string;
}

interface PreviewTemplateData {
  files: Array<{ filePath: string; content: string; sizeBytes: number }>;
}

interface CreatedTemplateData {
  template: {
    name: string;
    files: Array<{ filePath: string; content: string }>;
  };
}

interface TestEnvelope<TData = unknown> {
  data: TData;
  message?: string;
}

describe("template creation from existing project config", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;
  let db: Database;

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

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    db.close();
  });

  it("previews and creates a template from project config files", async () => {
    const auth = await register("template-from-project@example.com");
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-template-project-"));
    await writeConfig(projectRoot, ".claude/CLAUDE.md", "# Claude Memory\n");
    await writeConfig(projectRoot, ".claude/settings.json", "{\"hooks\":{}}\n");
    await writeConfig(projectRoot, ".opencode/AGENTS.md", "# OpenCode Agents\n");
    await writeConfig(projectRoot, ".codex/config.toml", "model = \"gpt\"\n");
    await writeConfig(projectRoot, "README.md", "# Ignore me\n");
    const project = await createProject(auth.token, projectRoot, "Template Source");

    const previewRes = await fetch(`${baseUrl}/api/v1/templates/from-project/preview`, {
      method: "POST",
      headers: jsonHeaders(auth.token),
      body: JSON.stringify({ projectId: project.id })
    });
    const previewBody = await readResponse<PreviewTemplateData>(previewRes);

    assert.equal(previewRes.status, 200, JSON.stringify(previewBody));
    assert.deepEqual(
      previewBody.data.files.map((file) => file.filePath),
      [
        ".claude/CLAUDE.md",
        ".claude/settings.json",
        ".codex/config.toml",
        ".opencode/AGENTS.md"
      ]
    );
    assert.equal(previewBody.data.files[0].content, "# Claude Memory\n");
    assert.equal(previewBody.data.files[0].sizeBytes, Buffer.byteLength("# Claude Memory\n"));

    const createRes = await fetch(`${baseUrl}/api/v1/templates/from-project`, {
      method: "POST",
      headers: jsonHeaders(auth.token),
      body: JSON.stringify({
        projectId: project.id,
        name: "Extracted Project Template",
        description: "Created from existing config",
        version: "1.0.0"
      })
    });
    const createBody = await readResponse<CreatedTemplateData>(createRes);

    assert.equal(createRes.status, 201, JSON.stringify(createBody));
    assert.equal(createBody.data.template.name, "Extracted Project Template");
    assert.equal(createBody.data.template.files.length, 4);
    assert.equal(
      createBody.data.template.files.find((file) => file.filePath === ".codex/config.toml")?.content,
      "model = \"gpt\"\n"
    );
  });

  it("does not expose another user's project config", async () => {
    const owner = await register("template-source-owner@example.com");
    const other = await register("template-source-other@example.com");
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-template-private-"));
    await writeConfig(projectRoot, ".claude/CLAUDE.md", "# Private\n");
    const project = await createProject(owner.token, projectRoot, "Private Template Source");

    const previewRes = await fetch(`${baseUrl}/api/v1/templates/from-project/preview`, {
      method: "POST",
      headers: jsonHeaders(other.token),
      body: JSON.stringify({ projectId: project.id })
    });
    const previewBody = await readResponse(previewRes);

    assert.equal(previewRes.status, 404);
    assert.equal(previewBody.message, "Project not found");
  });

  it("rejects config files that resolve outside the project root", async () => {
    const auth = await register("template-symlink@example.com");
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-template-symlink-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "openforge-template-outside-"));
    await writeConfig(projectRoot, ".claude/CLAUDE.md", "# Safe\n");
    await writeConfig(outsideRoot, "escape.md", "# Outside\n");
    await symlink(path.join(outsideRoot, "escape.md"), path.join(projectRoot, ".claude", "escape.md"));
    const project = await createProject(auth.token, projectRoot, "Symlink Template Source");

    const previewRes = await fetch(`${baseUrl}/api/v1/templates/from-project/preview`, {
      method: "POST",
      headers: jsonHeaders(auth.token),
      body: JSON.stringify({ projectId: project.id })
    });
    const previewBody = await readResponse(previewRes);

    assert.equal(previewRes.status, 400);
    assert.match(previewBody.message, /escapes approved project root/i);
  });

  it("rejects oversized config files", async () => {
    const auth = await register("template-oversized@example.com");
    const projectRoot = await mkdtemp(path.join(tmpdir(), "openforge-template-oversized-"));
    await writeConfig(projectRoot, ".claude/CLAUDE.md", "x".repeat(129 * 1024));
    const project = await createProject(auth.token, projectRoot, "Oversized Template Source");

    const previewRes = await fetch(`${baseUrl}/api/v1/templates/from-project/preview`, {
      method: "POST",
      headers: jsonHeaders(auth.token),
      body: JSON.stringify({ projectId: project.id })
    });
    const previewBody = await readResponse(previewRes);

    assert.equal(previewRes.status, 400);
    assert.match(previewBody.message, /exceeds maximum size/i);
  });

  async function register(email: string): Promise<AuthContext> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as { data: { token: string; user: { id: string } } };
    return { token: body.data.token, userId: body.data.user.id };
  }

  async function createProject(token: string, projectRoot: string, name: string): Promise<{ id: string }> {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ name, path: projectRoot, aiTool: "claude" })
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.project;
  }
});

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function writeConfig(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function readResponse<TData = unknown>(response: Response): Promise<TestEnvelope<TData>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<TestEnvelope<TData>>;
  }
  return { data: undefined as TData, message: await response.text() };
}
