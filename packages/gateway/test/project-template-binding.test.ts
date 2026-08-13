import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

interface ProjectDetailBody {
  code?: number;
  message?: string;
  data?: {
    project?: { id: string; templateId: string | null };
  };
}

interface UsageBody {
  data?: {
    usageCount?: number;
    projects?: Array<{ id: string }>;
  };
}

interface SyncPreviewBody {
  data?: {
    projects?: Array<{ projectId: string }>;
  };
}

interface TemplateResponseBody {
  data: {
    template: { id: string };
  };
}

describe("project <-> template binding lifecycle", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;

  before(async () => {
    const db = createTestDb();
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

  async function createProject(
    token: string,
    input: { name: string; path: string; templateId: string }
  ): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: input.name,
        path: input.path,
        aiTool: "claude",
        templateId: input.templateId
      })
    });
    const body = (await res.json()) as ProjectDetailBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data?.project?.id as string;
  }

  async function createCustomTemplate(token: string, name: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        files: [{ filePath: "CLAUDE.md", content: `# ${name}\n` }]
      })
    });
    const body = (await res.json()) as TemplateResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.template.id as string;
  }

  async function patchTemplate(
    token: string,
    projectId: string,
    payload: object
  ): Promise<{ status: number; body: ProjectDetailBody }> {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let body: ProjectDetailBody = {};
    try {
      body = JSON.parse(text) as ProjectDetailBody;
    } catch {
      body = { code: -1, message: text };
    }
    return { status: res.status, body };
  }

  async function getProject(token: string, projectId: string) {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await res.json()) as ProjectDetailBody;
    return body.data?.project ?? null;
  }

  it("rejects a body that is not an object with templateId", async () => {
    const token = await register("patch-invalid@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-binding-invalid-"));
    const projectId = await createProject(token, {
      name: "Invalid Patch",
      path: rootPath,
      templateId: "builtin-claude-code"
    });
    const res = await patchTemplate(token, projectId, { templateId: 42 });
    assert.equal(res.status, 400);
  });

  it("binds the template via PATCH and leaves it unchanged when templateId is omitted", async () => {
    const token = await register("patch-omitted@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-binding-omitted-"));
    const projectId = await createProject(token, {
      name: "Omitted Patch",
      path: rootPath,
      templateId: "builtin-claude-code"
    });

    const bindRes = await patchTemplate(token, projectId, { templateId: "builtin-claude-code" });
    assert.equal(bindRes.status, 200);
    assert.equal(bindRes.body.data?.project?.templateId, "builtin-claude-code");

    const res = await patchTemplate(token, projectId, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.data?.project?.templateId, "builtin-claude-code");

    const fresh = await getProject(token, projectId);
    assert.equal(fresh?.templateId, "builtin-claude-code");
  });

  it("unbinds with an explicit null templateId and keeps project files untouched", async () => {
    const token = await register("patch-unbind@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-binding-unbind-"));
    const projectId = await createProject(token, {
      name: "Unbind Patch",
      path: rootPath,
      templateId: "builtin-claude-code"
    });

    const applyRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/config/sync/apply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ templateId: "builtin-claude-code" })
    });
    assert.equal(applyRes.status, 200);
    const claudeMdPath = path.join(rootPath, "CLAUDE.md");
    assert.ok(existsSync(claudeMdPath));
    const beforeContent = await readFile(claudeMdPath, "utf8");

    const res = await patchTemplate(token, projectId, { templateId: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.data?.project?.templateId, null);

    const fresh = await getProject(token, projectId);
    assert.equal(fresh?.templateId, null);
    assert.equal(await readFile(claudeMdPath, "utf8"), beforeContent, "files must not be touched by unbind");
  });

  it("switches to a different template with a non-empty templateId", async () => {
    const token = await register("patch-switch@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-binding-switch-"));
    const customTemplateId = await createCustomTemplate(token, "Switch Target");
    const projectId = await createProject(token, {
      name: "Switch Patch",
      path: rootPath,
      templateId: "builtin-claude-code"
    });

    const res = await patchTemplate(token, projectId, { templateId: customTemplateId });
    assert.equal(res.status, 200);
    assert.equal(res.body.data?.project?.templateId, customTemplateId);
  });

  it("rejects switching to a template that does not exist", async () => {
    const token = await register("patch-switch-missing@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-binding-missing-"));
    const projectId = await createProject(token, {
      name: "Switch Missing",
      path: rootPath,
      templateId: "builtin-claude-code"
    });
    await patchTemplate(token, projectId, { templateId: "builtin-claude-code" });

    const res = await patchTemplate(token, projectId, { templateId: "does-not-exist" });
    assert.equal(res.status, 404);
    const fresh = await getProject(token, projectId);
    assert.equal(fresh?.templateId, "builtin-claude-code");
  });

  it("rejects switching to another tenant's template", async () => {
    const ownerToken = await register("patch-tenant-owner@test.com");
    const otherToken = await register("patch-tenant-other@test.com");
    const ownerTemplateId = await createCustomTemplate(ownerToken, "Owner Only");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-binding-tenant-"));
    const projectId = await createProject(otherToken, {
      name: "Tenant Project",
      path: rootPath,
      templateId: "builtin-claude-code"
    });

    const res = await patchTemplate(otherToken, projectId, { templateId: ownerTemplateId });
    assert.equal(res.status, 404);
  });

  it("excludes an unbound project from template usage and bulk sync", async () => {
    const token = await register("patch-usage-exclude@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-binding-usage-"));
    const projectId = await createProject(token, {
      name: "Usage Exclude",
      path: rootPath,
      templateId: "builtin-claude-code"
    });
    await patchTemplate(token, projectId, { templateId: "builtin-claude-code" });

    const usageBeforeRes = await fetch(`${baseUrl}/api/v1/templates/builtin-claude-code/usage`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const usageBefore = (await usageBeforeRes.json()) as UsageBody;
    assert.ok(
      usageBefore.data?.projects?.some((project) => project.id === projectId),
      "bound project should appear in usage"
    );

    await patchTemplate(token, projectId, { templateId: null });

    const usageAfterRes = await fetch(`${baseUrl}/api/v1/templates/builtin-claude-code/usage`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const usageAfter = (await usageAfterRes.json()) as UsageBody;
    assert.ok(
      !usageAfter.data?.projects?.some((project) => project.id === projectId),
      "unbound project must not appear in template usage"
    );

    const previewRes = await fetch(`${baseUrl}/api/v1/templates/builtin-claude-code/sync/preview`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    assert.equal(previewRes.status, 200);
    const preview = (await previewRes.json()) as SyncPreviewBody;
    assert.ok(
      !preview.data?.projects?.some((entry) => entry.projectId === projectId),
      "unbound project must be excluded from bulk sync preview"
    );
  });
});