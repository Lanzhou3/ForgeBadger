import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
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

interface ComplianceSummary {
  status: "compliant" | "needs_attention";
  totalFiles: number;
  missingFiles: string[];
  identicalFiles: string[];
  modifiedFiles: string[];
  staleFiles: string[];
  unsafeFiles: string[];
  requiresDecision: string[];
}

interface ComplianceResponseBody {
  code: number;
  message?: string;
  data?: {
    compliance: ComplianceSummary;
    conflicts: Array<{ relativePath: string; conflictType: string }>;
    files: Array<{ relativePath: string; sha256: string }>;
  };
  details?: { code?: string };
}

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

interface TemplateResponseBody {
  data: {
    template: {
      id: string;
    };
  };
}

describe("project config compliance", () => {
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

  it("reports missing, identical, modified, and stale generated config files", async () => {
    const token = await register("compliance@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-compliance-"));
    const projectId = await createProject(token, {
      name: "Compliance Project",
      path: rootPath,
      templateId: "builtin-claude-code"
    });

    const missing = await getCompliance(token, projectId);
    assert.equal(missing.status, 200);
    assert.ok(missing.body.data);
    assert.equal(missing.body.data.compliance.status, "needs_attention");
    assert.ok(missing.body.data.compliance.missingFiles.includes("CLAUDE.md"));
    assert.equal(missing.body.data.compliance.identicalFiles.length, 0);
    assert.equal(missing.body.data.compliance.staleFiles.length, 0);
    assert.ok(missing.body.data.files.some((file) => file.relativePath === "CLAUDE.md"));

    const applyRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/config/sync/apply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    assert.equal(applyRes.status, 200);

    const identical = await getCompliance(token, projectId);
    assert.equal(identical.status, 200);
    assert.ok(identical.body.data);
    assert.equal(identical.body.data.compliance.status, "compliant");
    assert.ok(identical.body.data.compliance.identicalFiles.includes("CLAUDE.md"));
    assert.equal(identical.body.data.compliance.missingFiles.length, 0);
    assert.equal(identical.body.data.compliance.modifiedFiles.length, 0);
    assert.equal(identical.body.data.compliance.staleFiles.length, 0);

    await writeFile(path.join(rootPath, "CLAUDE.md"), "local edit", "utf8");
    const stale = await getCompliance(token, projectId);
    assert.equal(stale.status, 200);
    assert.ok(stale.body.data);
    assert.equal(stale.body.data.compliance.status, "needs_attention");
    assert.ok(stale.body.data.compliance.modifiedFiles.includes("CLAUDE.md"));
    assert.ok(stale.body.data.compliance.staleFiles.includes("CLAUDE.md"));
    assert.ok(stale.body.data.compliance.requiresDecision.includes("CLAUDE.md"));
    assert.ok(stale.body.data.conflicts.some((conflict: { conflictType: string }) => conflict.conflictType === "modified"));
  });

  it("reports unsafe template paths without writing files", async () => {
    const token = await register("unsafe-compliance@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-compliance-unsafe-"));
    const templateRes = await fetch(`${baseUrl}/api/v1/templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Unsafe Template",
        files: [{ filePath: "../escape.md", content: "escape" }]
      })
    });
    const templateData = (await templateRes.json()) as TemplateResponseBody;
    assert.equal(templateRes.status, 201, JSON.stringify(templateData));
    const projectId = await createProject(token, {
      name: "Unsafe Compliance",
      path: rootPath,
      templateId: templateData.data.template.id
    });

    const compliance = await getCompliance(token, projectId, templateData.data.template.id);
    assert.equal(compliance.status, 200);
    assert.ok(compliance.body.data);
    assert.equal(compliance.body.data.compliance.status, "needs_attention");
    assert.deepEqual(compliance.body.data.compliance.unsafeFiles, ["../escape.md"]);
    assert.deepEqual(compliance.body.data.compliance.requiresDecision, ["../escape.md"]);
  });

  it("does not expose another user's project compliance report", async () => {
    const ownerToken = await register("owner-compliance@test.com");
    const otherToken = await register("other-compliance@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-compliance-owner-"));
    const projectId = await createProject(ownerToken, {
      name: "Private Compliance",
      path: rootPath,
      templateId: "builtin-claude-code"
    });

    const compliance = await getCompliance(otherToken, projectId);
    assert.equal(compliance.status, 404);
    assert.equal(compliance.body.code, 1);
  });

  it("returns 404 with TEMPLATE_NOT_TRACKED after the template binding is removed", async () => {
    const token = await register("untracked-compliance@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-compliance-untracked-"));
    const projectId = await createProject(token, {
      name: "Untracked Compliance",
      path: rootPath,
      templateId: "builtin-claude-code"
    });

    const unbindRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ templateId: null })
    });
    assert.equal(unbindRes.status, 200);

    const compliance = await getCompliance(token, projectId);
    assert.equal(compliance.status, 404);
    assert.equal(compliance.body.code, 1);
    assert.ok(compliance.body.message?.includes("not tracking"));
    assert.equal(compliance.body.details?.code, "TEMPLATE_NOT_TRACKED");
  });

  it("allows an explicit templateId query for an untracked project", async () => {
    const token = await register("explicit-query-compliance@test.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-compliance-explicit-"));
    const projectId = await createProject(token, {
      name: "Explicit Query Compliance",
      path: rootPath,
      templateId: "builtin-claude-code"
    });

    await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ templateId: null })
    });

    const compliance = await getCompliance(token, projectId, "builtin-claude-code");
    assert.equal(compliance.status, 200);
    assert.ok(compliance.body.data);
  });

  async function register(email: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" })
    });
    const body = (await res.json()) as AuthResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    return body.data.token as string;
  }

  async function createProject(
    token: string,
    input: { name: string; path: string; templateId: string }
  ): Promise<string> {
    if (input.templateId === "builtin-claude-code") {
      const builtins = await fetch(`${baseUrl}/api/v1/templates/builtins`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(builtins.status, 200);
    }
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
    const body = (await res.json()) as ProjectResponseBody;
    assert.equal(res.status, 201, JSON.stringify(body));
    const projectId = body.data.project.id as string;

    // Creation no longer binds a template; bind explicitly to keep the fixture tracked.
    const bindRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ templateId: input.templateId })
    });
    assert.equal(bindRes.status, 200);
    return projectId;
  }

  async function getCompliance(token: string, projectId: string, templateId?: string): Promise<{
    status: number;
    body: ComplianceResponseBody;
  }> {
    const query = templateId ? `?templateId=${encodeURIComponent(templateId)}` : "";
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/config/compliance${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const text = await res.text();
    return {
      status: res.status,
      body: parseJsonResponse(text)
    };
  }

  function parseJsonResponse(text: string): ComplianceResponseBody {
    try {
      return JSON.parse(text) as ComplianceResponseBody;
    } catch {
      return { code: -1, message: text };
    }
  }
});
