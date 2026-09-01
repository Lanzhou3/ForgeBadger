import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp, realpath } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createGatewayApp } from "../src/server.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import type { CommandResult } from "../src/lib/dependency-check.js";
import { RuntimeAuthorizationInvalidator } from "../src/services/runtime-authorization-invalidation.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

interface MockTmuxCreateInput {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
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
      aiTool?: string;
      templateId?: string | null;
    };
  };
}

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

describe("session adapter decoupling", () => {
  const tmuxCreates: MockTmuxCreateInput[] = [];
  let gateway: ReturnType<typeof createGatewayApp>;
  let db: Database;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    db = createTestDb();
    const sessionManager = new InMemorySessionManager({
      async createSession(input) {
        tmuxCreates.push(input);
      },
      async killSession() {},
      async capturePane() {
        return "";
      },
      async listSessions() {
        return [];
      }
    });
    const runtimeAuthorizationInvalidator = new RuntimeAuthorizationInvalidator();
    gateway = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      runtimeAuthorizationInvalidator,
      adapterCommandRunner: async (command): Promise<CommandResult> => {
        return { exitCode: 0, stdout: `${command} test-version`, stderr: "" };
      }
    });
    server = gateway.server;
    baseUrl = await listenOnLoopback(server);
  });

  after(async () => {
    await gateway.close();
  });

  it("creates project records without runtime CLI or template binding", async () => {
    const token = await register("adapter-project-default@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-project-default-"));

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Runtime Agnostic Project",
        path: rootPath
      })
    });
    const projectData = await projectRes.json() as ProjectResponseBody;

    assert.equal(projectRes.status, 201);
    assert.equal(projectData.data.project.aiTool, "");
    assert.equal(projectData.data.project.templateId, null);
  });

  it("ignores legacy runtime CLI/template fields on project create/import", async () => {
    const token = await register("adapter-project-legacy@example.com");
    const createPath = await mkdtemp(path.join(tmpdir(), "forgebadger-project-legacy-create-"));
    const importPath = await mkdtemp(path.join(tmpdir(), "forgebadger-project-legacy-import-"));

    const createRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Legacy Codex Project",
        path: createPath,
        aiTool: "codex"
      })
    });
    const createData = await createRes.json() as ProjectResponseBody;

    const importRes = await fetch(`${baseUrl}/api/v1/projects/import`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Legacy OpenCode Project",
        path: importPath,
        aiTool: "opencode",
        templateId: "builtin-opencode"
      })
    });
    const importData = await importRes.json() as ProjectResponseBody;

    assert.equal(createRes.status, 201);
    assert.equal(createData.data.project.aiTool, "");
    assert.equal(createData.data.project.templateId, null);
    assert.equal(importRes.status, 201);
    assert.equal(importData.data.project.aiTool, "");
    assert.equal(importData.data.project.templateId, null);
  });

  it("requires an explicit runtime CLI when the project has no adapter hint", async () => {
    const token = await register("adapter-explicit-required@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-adapter-explicit-"));

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Explicit Adapter Project",
        path: rootPath
      })
    });
    const projectData = await projectRes.json();

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id
      })
    });

    assert.equal(sessionRes.status, 400);
    const sessionBody = await sessionRes.json() as { message?: string };
    assert.match(sessionBody.message ?? "", /Runtime CLI selection is required/);
  });

  it("rejects config sync for projects tracking no template", async () => {
    const token = await register("adapter-sync-untracked@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-adapter-sync-untracked-"));

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Untracked Sync Project",
        path: rootPath
      })
    });
    const projectData = await projectRes.json();

    const previewRes = await fetch(`${baseUrl}/api/v1/projects/${projectData.data.project.id}/config/sync/preview`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ credentialMode: "host_environment" })
    });
    const applyRes = await fetch(`${baseUrl}/api/v1/projects/${projectData.data.project.id}/config/sync/apply`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ credentialMode: "host_environment" })
    });
    const previewBody = await previewRes.json() as { details?: { code?: string }; message?: string };

    assert.equal(previewRes.status, 404);
    assert.equal(applyRes.status, 404);
    assert.equal(previewBody.details?.code, "TEMPLATE_NOT_TRACKED");
  });

  it("launches a requested session adapter instead of the project default adapter", async () => {
    const token = await register("adapter-decoupling@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-adapter-session-"));

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Multi Adapter Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        aiTool: "codex"
      })
    });
    const sessionData = await sessionRes.json();

    assert.equal(sessionRes.status, 201);
    assert.equal(sessionData.data.session.aiTool, "codex");
    assert.equal(tmuxCreates.at(-1)?.command, "codex");
    assert.equal(tmuxCreates.at(-1)?.cwd, await realpath(rootPath));
  });

  it("creates Codex sessions in host_environment without provider or model fields", async () => {
    const beforeCreateCount = tmuxCreates.length;
    const token = await register("adapter-codex-host-env@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-codex-host-env-"));

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Codex Host Environment",
        path: rootPath,
        aiTool: "codex"
      })
    });
    const projectData = await projectRes.json() as ProjectResponseBody;
    assert.equal(projectRes.status, 201);

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        aiTool: "codex"
      })
    });
    const sessionData = await sessionRes.json();

    assert.equal(sessionRes.status, 201);
    assert.equal(sessionData.data.session.aiTool, "codex");
    assert.equal(sessionData.data.session.credentialMode, undefined);
    assert.equal(sessionData.data.session.launchModelId, undefined);
    assert.equal(tmuxCreates.length, beforeCreateCount + 1);
    assert.equal(tmuxCreates.at(-1)?.command, "codex");
    assert.equal(tmuxCreates.at(-1)?.env.OPENAI_API_KEY, undefined);
  });

  it("rejects legacy credential and model fields for Kimi Code terminal sessions", async () => {
    const beforeCreateCount = tmuxCreates.length;
    const token = await register("adapter-kimi-provider-boundary@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-kimi-provider-boundary-"));

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Kimi Provider Boundary",
        path: rootPath,
        aiTool: "kimi"
      })
    });
    const projectData = await projectRes.json() as ProjectResponseBody;
    assert.equal(projectRes.status, 201);

    const storedCredentialRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "stored_encrypted_key",
        aiTool: "kimi",
        apiKeyId: "key-id",
        modelId: "model-id"
      })
    });
    const modelOverrideRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        aiTool: "kimi",
        modelId: "model-id"
      })
    });
    const plainRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        aiTool: "kimi"
      })
    });

    assert.equal(storedCredentialRes.status, 400);
    assert.equal(modelOverrideRes.status, 400);
    assert.equal(plainRes.status, 201);
    assert.equal(tmuxCreates.length, beforeCreateCount + 1);
    assert.equal(tmuxCreates.at(-1)?.command, "kimi");
  });

  it("rejects legacy stored-credential fields for OpenCode sessions", async () => {
    const token = await register("adapter-provider-credential@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "forgebadger-provider-session-"));

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Provider Credential Project",
        path: rootPath,
        aiTool: "opencode"
      })
    });
    const projectData = await projectRes.json() as ProjectResponseBody;
    assert.equal(projectRes.status, 201);

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "stored_encrypted_key",
        aiTool: "opencode",
        modelId: "model-id"
      })
    });
    const sessionData = await sessionRes.json() as { message: string };

    assert.equal(sessionRes.status, 400);
    assert.equal(sessionData.message, "Invalid input");
    assert.equal(tmuxCreates.some((entry) => entry.cwd === rootPath), false);
  });
});

async function register(email: string): Promise<string> {
  const registerRes = await fetch(`${baseUrlForRegister}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123"
    })
  });
  const registerData = await registerRes.json() as AuthResponseBody;
  return registerData.data.token;
}

let baseUrlForRegister = "";

function jsonAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function listenOnLoopback(server: Server): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.off("error", onError);
      reject(new Error("Timed out listening on 127.0.0.1"));
    }, 5_000);
    const onError = (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      clearTimeout(timeout);
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Gateway test server did not return a TCP address"));
        return;
      }
      const url = `http://127.0.0.1:${address.port}`;
      baseUrlForRegister = url;
      resolve(url);
    });
  });
}
