import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
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

interface ProviderResponseBody {
  data: {
    provider: {
      id: string;
    };
    models: Array<{
      id: string;
      modelId: string;
    }>;
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
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const db = createTestDb();
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
    gateway = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
      adapterCommandRunner: async (command): Promise<CommandResult> => ({
        exitCode: 0,
        stdout: `${command} test-version`,
        stderr: ""
      })
    });
    server = gateway.server;
    baseUrl = await listenOnLoopback(server);
  });

  after(async () => {
    await gateway.close();
  });

  it("creates project records without runtime CLI fields using a legacy config hint", async () => {
    const token = await register("adapter-project-default@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-project-default-"));

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
    assert.equal(projectData.data.project.aiTool, "claude");
    assert.equal(projectData.data.project.templateId, "builtin-claude-code");
  });

  it("keeps legacy project create/import adapter fields compatible", async () => {
    const token = await register("adapter-project-legacy@example.com");
    const createPath = await mkdtemp(path.join(tmpdir(), "openforge-project-legacy-create-"));
    const importPath = await mkdtemp(path.join(tmpdir(), "openforge-project-legacy-import-"));

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
        aiTool: "opencode"
      })
    });
    const importData = await importRes.json() as ProjectResponseBody;

    assert.equal(createRes.status, 201);
    assert.equal(createData.data.project.aiTool, "codex");
    assert.equal(createData.data.project.templateId, "builtin-codex");
    assert.equal(importRes.status, 201);
    assert.equal(importData.data.project.aiTool, "opencode");
    assert.equal(importData.data.project.templateId, "builtin-opencode");
  });

  it("launches a requested session adapter instead of the project default adapter", async () => {
    const token = await register("adapter-decoupling@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-adapter-session-"));

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
        credentialMode: "host_environment",
        aiTool: "codex"
      })
    });
    const sessionData = await sessionRes.json();

    assert.equal(sessionRes.status, 201);
    assert.equal(sessionData.data.session.aiTool, "codex");
    assert.equal(tmuxCreates.at(-1)?.command, "codex");
    assert.equal(tmuxCreates.at(-1)?.cwd, rootPath);
  });

  it("rejects provider credentials and model overrides for Codex terminal sessions", async () => {
    const beforeCreateCount = tmuxCreates.length;
    const token = await register("adapter-codex-provider-boundary@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-codex-provider-boundary-"));

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "Codex Provider Boundary",
        path: rootPath,
        aiTool: "codex"
      })
    });
    const projectData = await projectRes.json() as ProjectResponseBody;
    assert.equal(projectRes.status, 201);

    const modelRes = await fetch(`${baseUrl}/api/v1/models`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "GPT Codex",
        provider: "openai",
        modelId: "gpt-5.1-codex"
      })
    });
    const modelData = await modelRes.json() as { data: { model: { id: string } } };
    assert.equal(modelRes.status, 201);

    const keyRes = await fetch(`${baseUrl}/api/v1/api-keys`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        provider: "openai",
        name: "OpenAI",
        plaintextKey: "secret"
      })
    });
    const keyData = await keyRes.json() as { data: { apiKey: { id: string } } };
    assert.equal(keyRes.status, 201);

    const storedCredentialRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "stored_encrypted_key",
        aiTool: "codex",
        apiKeyId: keyData.data.apiKey.id,
        modelId: modelData.data.model.id
      })
    });
    const modelOverrideRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "host_environment",
        aiTool: "codex",
        modelId: modelData.data.model.id
      })
    });

    assert.equal(storedCredentialRes.status, 400);
    assert.match((await storedCredentialRes.json()).message, /subscription-managed/i);
    assert.equal(modelOverrideRes.status, 400);
    assert.match((await modelOverrideRes.json()).message, /subscription-managed/i);
    assert.equal(tmuxCreates.length, beforeCreateCount);
  });

  it("launches provider-backed OpenCode sessions without a legacy api key id", async () => {
    const token = await register("adapter-provider-credential@example.com");
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-provider-session-"));

    const providerRes = await fetch(`${baseUrl}/api/v1/model-providers`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ catalogId: "deepseek" })
    });
    const providerData = await providerRes.json() as ProviderResponseBody;
    assert.equal(providerRes.status, 201);
    const modelRes = await fetch(`${baseUrl}/api/v1/model-providers/${providerData.data.provider.id}/models`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        name: "DeepSeek Chat",
        modelId: "deepseek-chat",
        capabilities: ["chat", "code"]
      })
    });
    const modelData = await modelRes.json() as { data: { model: { id: string } } };
    assert.equal(modelRes.status, 201);

    const credentialRes = await fetch(`${baseUrl}/api/v1/model-providers/${providerData.data.provider.id}/credentials`, {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ plaintextSecret: "provider-secret" })
    });
    assert.equal(credentialRes.status, 201);

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
        modelId: modelData.data.model.id
      })
    });
    const sessionData = await sessionRes.json() as { data: { session: { aiTool: string } } };

    assert.equal(sessionRes.status, 201);
    assert.equal(sessionData.data.session.aiTool, "opencode");
    assert.equal(tmuxCreates.at(-1)?.command, "opencode");
    assert.deepEqual(tmuxCreates.at(-1)?.args, ["--model", "deepseek/deepseek-chat"]);
    assert.equal(tmuxCreates.at(-1)?.env.DEEPSEEK_API_KEY, "provider-secret");
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
