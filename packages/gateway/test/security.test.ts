import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import jwt from "jsonwebtoken";

import { createGatewayApp } from "../src/server.js";
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { TerminalInputRateLimiter } from "../src/websocket/terminal.js";
import { ApiKeyRepository } from "../src/db/repositories/api-key-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

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

interface MockTmuxCreateInput {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

const mockTmuxCalls: string[] = [];
const mockTmuxCreates: MockTmuxCreateInput[] = [];
const mockTmuxClient = {
  async createSession(input: MockTmuxCreateInput) {
    mockTmuxCreates.push(input);
  },
  async killSession(name: string) {
    mockTmuxCalls.push(`kill:${name}`);
  },
  async capturePane() {
    return "";
  },
  async hasSession() {
    return true;
  },
  async showEnvironment() {
    return {};
  },
  async listSessions() {
    return [];
  }
};

async function availableAdapterCommandRunner(command: string) {
  return {
    exitCode: 0,
    stdout: `${command} test\n`,
    stderr: ""
  };
}

describe("security hardening", () => {
  let server: ReturnType<typeof createGatewayApp>["server"];
  let baseUrl: string;
  let db: Database;

  before(async () => {
    db = createTestDb();
    const sessionManager = new InMemorySessionManager(mockTmuxClient as any);
    const apiKeyStore = new InMemoryApiKeyStore({ masterKey });
    const app = createGatewayApp({
      jwtSecret,
      masterKey,
      db,
      sessionManager,
      apiKeyStore,
      adapterCommandRunner: availableAdapterCommandRunner
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

  it("rejects alg:none JWT", async () => {
    const token = jwt.sign(
      { userId: "1", email: "test@test.com" },
      "",
      { algorithm: "none" }
    );
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 401);
  });

  it("blocks SQL injection in project name", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sql@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const tmpDir = await mkdtemp(path.join(tmpdir(), "openforge-sql-"));
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "'; DROP TABLE users; --",
        path: tmpDir,
        aiTool: "claude"
      })
    });
    // Should either succeed (SQLite parameterization prevents injection) or fail validation
    assert.ok(res.status === 201 || res.status === 400);

    // Verify users table still exists
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get() as { name: string } | undefined;
    assert.ok(row);
    assert.equal(row.name, "users");
  });

  it("blocks path traversal", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "path@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "test",
        path: "/etc/passwd",
        aiTool: "claude"
      })
    });
    assert.equal(res.status, 400);
  });

  it("XSS content is stored but not executed", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "xss@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const xssPayload = "<script>alert('xss')</script>";
    const res = await fetch(`${baseUrl}/api/v1/skills`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "test-skill",
        content: xssPayload,
        source: "local"
      })
    });
    assert.equal(res.status, 201);

    const listRes = await fetch(`${baseUrl}/api/v1/skills`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await listRes.json();
    const skill = data.data.skills.find(
      (s: { name: string }) => s.name === "test-skill"
    );
    assert.ok(skill);
    assert.equal(skill.content, xssPayload);
  });

  it("terminal input rate limiter blocks flood", () => {
    const limiter = new TerminalInputRateLimiter({
      maxMessages: 5,
      windowMs: 1000
    });
    assert.ok(limiter.consume());
    assert.ok(limiter.consume());
    assert.ok(limiter.consume());
    assert.ok(limiter.consume());
    assert.ok(limiter.consume());
    assert.ok(!limiter.consume()); // 6th should be blocked
  });

  it("API keys are encrypted at rest", () => {
    const testDb = createTestDb();
    const userRepo = new UserRepository(testDb);
    const user = userRepo.create("apikey@test.com", "fakehash");

    const repo = new ApiKeyRepository(testDb, user.id, masterKey);
    repo.create({
      provider: "openai",
      plaintextKey: "sk-test123",
      label: "test"
    });

    const row = testDb
      .prepare("SELECT key_encrypted FROM api_keys WHERE provider = ?")
      .get("openai") as { key_encrypted: string } | undefined;
    assert.ok(row);
    assert.ok(row.key_encrypted);
    assert.ok(!row.key_encrypted.includes("sk-test123"));
  });

  it("stores API keys through REST in SQLite and supports deletion", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "route-key@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const createRes = await fetch(`${baseUrl}/api/v1/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        provider: "anthropic",
        name: "Claude",
        plaintextKey: "test-api-key-route-secret"
      })
    });
    const createData = await createRes.json();
    assert.equal(createRes.status, 201);
    assert.equal(createData.data.apiKey.provider, "anthropic");
    assert.equal(JSON.stringify(createData).includes("test-api-key-route-secret"), false);

    const stored = db
      .prepare("SELECT key_encrypted FROM api_keys WHERE id = ?")
      .get(createData.data.apiKey.id) as { key_encrypted: string } | undefined;
    assert.ok(stored);
    assert.ok(!stored.key_encrypted.includes("test-api-key-route-secret"));

    const deleteRes = await fetch(`${baseUrl}/api/v1/api-keys/${createData.data.apiKey.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(deleteRes.status, 200);

    const listRes = await fetch(`${baseUrl}/api/v1/api-keys`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const listData = await listRes.json();
    assert.deepEqual(listData.data.apiKeys, []);
  });

  it("rotates API keys through REST without exposing plaintext", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "rotate-key@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const createRes = await fetch(`${baseUrl}/api/v1/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        provider: "anthropic",
        name: "Claude",
        plaintextKey: "test-api-key-old-secret"
      })
    });
    const createData = await createRes.json();
    assert.equal(createRes.status, 201);

    const before = db
      .prepare("SELECT key_encrypted FROM api_keys WHERE id = ?")
      .get(createData.data.apiKey.id) as { key_encrypted: string };

    const rotateRes = await fetch(`${baseUrl}/api/v1/api-keys/${createData.data.apiKey.id}/rotate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ plaintextKey: "test-api-key-new-secret" })
    });
    const rotateData = await rotateRes.json();

    assert.equal(rotateRes.status, 200);
    assert.equal(rotateData.data.apiKey.id, createData.data.apiKey.id);
    assert.equal(JSON.stringify(rotateData).includes("test-api-key-new-secret"), false);

    const after = db
      .prepare("SELECT key_encrypted FROM api_keys WHERE id = ?")
      .get(createData.data.apiKey.id) as { key_encrypted: string };
    assert.notEqual(after.key_encrypted, before.key_encrypted);

    const apiKeyRepo = new ApiKeyRepository(db, registerData.data.user.id, masterKey);
    assert.equal(apiKeyRepo.decryptForLaunch(createData.data.apiKey.id), "test-api-key-new-secret");
  });

  it("supports model REST CRUD and default selection", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "model-route@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const createRes = await fetch(`${baseUrl}/api/v1/models`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Claude Sonnet",
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
        endpoint: "https://api.anthropic.com"
      })
    });
    const createData = await createRes.json();
    assert.equal(createRes.status, 201);
    assert.equal(createData.data.model.modelId, "claude-sonnet-4-5");

    const updateRes = await fetch(`${baseUrl}/api/v1/models/${createData.data.model.id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: "Claude Sonnet Default" })
    });
    const updateData = await updateRes.json();
    assert.equal(updateRes.status, 200);
    assert.equal(updateData.data.model.name, "Claude Sonnet Default");

    const defaultRes = await fetch(`${baseUrl}/api/v1/models/${createData.data.model.id}/set-default`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const defaultData = await defaultRes.json();
    assert.equal(defaultRes.status, 200);
    assert.equal(defaultData.data.model.isDefault, true);

    const listRes = await fetch(`${baseUrl}/api/v1/models`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const listData = await listRes.json();
    assert.equal(listData.data.models.some(
      (model: { id: string; isDefault: boolean }) =>
        model.id === createData.data.model.id && model.isDefault
    ), true);

    const healthRes = await fetch(`${baseUrl}/api/v1/models/${createData.data.model.id}/check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const healthData = await healthRes.json();
    assert.equal(healthRes.status, 200);
    assert.equal(healthData.data.health.healthy, true);
    assert.equal(healthData.data.health.checks.modelConfigured, true);

    const deleteRes = await fetch(`${baseUrl}/api/v1/models/${createData.data.model.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(deleteRes.status, 200);
  });

  it("creates sessions with selected model and stored encrypted API key", async () => {
    mockTmuxCreates.length = 0;
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "session-model-key@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-model-key-session-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Model Key Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const modelRes = await fetch(`${baseUrl}/api/v1/models`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Claude Sonnet",
        provider: "anthropic",
        modelId: "claude-sonnet-4-5"
      })
    });
    const modelData = await modelRes.json();

    const keyRes = await fetch(`${baseUrl}/api/v1/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        provider: "anthropic",
        name: "Claude Key",
        plaintextKey: "test-api-key-session-secret"
      })
    });
    const keyData = await keyRes.json();

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "stored_encrypted_key",
        apiKeyId: keyData.data.apiKey.id,
        modelId: modelData.data.model.id
      })
    });
    const sessionData = await sessionRes.json();

    assert.equal(sessionRes.status, 201);
    assert.equal(sessionData.data.session.modelId, modelData.data.model.id);
    assert.equal(sessionData.data.session.credentialMode, "stored_encrypted_key");
    assert.equal(sessionData.data.session.apiKeyId, keyData.data.apiKey.id);
    assert.equal(JSON.stringify(sessionData).includes("test-api-key-session-secret"), false);
    assert.equal(mockTmuxCreates.at(-1)?.env.ANTHROPIC_API_KEY, "test-api-key-session-secret");
    assert.equal(mockTmuxCreates.at(-1)?.env.ANTHROPIC_MODEL, "claude-sonnet-4-5");
  });

  it("materializes enabled Claude plugins and launches only validated plugin directories", async () => {
    mockTmuxCreates.length = 0;
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "plugin-session@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-plugin-session-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Plugin Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const toggleRes = await fetch(`${baseUrl}/api/v1/plugins/claude-safe-edits/toggle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled: true })
    });
    assert.equal(toggleRes.status, 200);

    const pluginAuditRes = await fetch(
      `${baseUrl}/api/v1/audit-logs?resourceType=plugin&resourceId=claude-safe-edits`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const pluginAuditData = await pluginAuditRes.json();
    assert.equal(pluginAuditRes.status, 200);
    assert.ok(pluginAuditData.data.auditLogs.some((entry: { action: string; details: { enabled?: boolean } }) => (
      entry.action === "plugin.enable" &&
      entry.details.enabled === true
    )));

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "host_environment"
      })
    });
    assert.equal(sessionRes.status, 201);

    const args = mockTmuxCreates.at(-1)?.args ?? [];
    const pluginFlagIndex = args.indexOf("--plugin-dir");
    assert.notEqual(pluginFlagIndex, -1);
    const pluginDir = args[pluginFlagIndex + 1];
    assert.equal(pluginDir, path.join(await realpath(rootPath), ".openforge", "claude-plugins", "claude-safe-edits"));
    assert.equal(mockTmuxCreates.at(-1)?.command, "claude");
    assert.equal(args.includes("-lc"), false);
    const manifest = JSON.parse(
      await readFile(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf8")
    );
    assert.equal(manifest.name, "claude-safe-edits");
  });

  it("rejects session creation with a model owned by another user", async () => {
    const ownerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "model-owner@test.com",
        password: "password123"
      })
    });
    const ownerData = await ownerRes.json();
    const ownerToken = ownerData.data.token;

    const modelRes = await fetch(`${baseUrl}/api/v1/models`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Owner Model",
        provider: "anthropic",
        modelId: "claude-owner"
      })
    });
    const modelData = await modelRes.json();

    const otherRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "model-other@test.com",
        password: "password123"
      })
    });
    const otherData = await otherRes.json();
    const otherToken = otherData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-cross-model-session-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${otherToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Other Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${otherToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "host_environment",
        modelId: modelData.data.model.id
      })
    });
    const sessionData = await sessionRes.json();

    assert.equal(sessionRes.status, 404);
    assert.equal(sessionData.message, "Model not found");
  });

  it("exposes terminal attach credentials through a session connect action", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "connect@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-connect-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Connect Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "host_environment"
      })
    });
    const sessionData = await sessionRes.json();
    assert.equal(sessionRes.status, 201);

    const connectRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionData.data.session.id}/connect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const connectData = await connectRes.json();

    assert.equal(connectRes.status, 200);
    assert.equal(connectData.data.session.id, sessionData.data.session.id);
    assert.equal(typeof connectData.data.session.attachToken, "string");
    assert.ok(connectData.data.session.attachToken.length > 0);

    const localSettings = JSON.parse(
      await readFile(path.join(rootPath, ".claude", "settings.local.json"), "utf8")
    );
    const permissionHook = localSettings.hooks.PermissionRequest[0].hooks[0];
    assert.equal(permissionHook.type, "http");
    assert.match(permissionHook.url, /\/api\/v1\/session-hooks\/claude-notification\//);
    assert.equal(permissionHook.headers["x-openforge-session-token"], "$OPENFORGE_ATTACH_TOKEN");
    assert.deepEqual(permissionHook.allowedEnvVars, ["OPENFORGE_SESSION_ID", "OPENFORGE_ATTACH_TOKEN"]);
  });

  it("deletes only the project record and stops running project sessions", async () => {
    mockTmuxCalls.length = 0;
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "delete-project@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-delete-project-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Delete Record Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();
    assert.equal(projectRes.status, 201);

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "host_environment"
      })
    });
    const sessionData = await sessionRes.json();
    assert.equal(sessionRes.status, 201);

    const deleteRes = await fetch(`${baseUrl}/api/v1/projects/${projectData.data.project.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(deleteRes.status, 200);

    const projectAfterDeleteRes = await fetch(`${baseUrl}/api/v1/projects/${projectData.data.project.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(projectAfterDeleteRes.status, 404);

    const sessionsRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const sessionsData = await sessionsRes.json();
    assert.equal(sessionsData.data.sessions.some(
      (session: { id: string }) => session.id === sessionData.data.session.id
    ), false);
    assert.equal((await stat(rootPath)).isDirectory(), true);
    assert.deepEqual(mockTmuxCalls, [`kill:${sessionData.data.session.tmuxName}`]);
  });

  it("deletes a session without crashing while recording activity", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "delete-session@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-delete-session-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Delete Session Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "host_environment"
      })
    });
    const sessionData = await sessionRes.json();
    assert.equal(sessionRes.status, 201);

    const deleteRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionData.data.session.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    const deleteData = await deleteRes.json();

    assert.equal(deleteRes.status, 200);
    assert.equal(deleteData.code, 0);

    const sessionsRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const sessionsData = await sessionsRes.json();
    assert.equal(sessionsData.data.sessions.some(
      (session: { id: string }) => session.id === sessionData.data.session.id
    ), false);
  });

  it("does not expose terminal attach credentials after a session is stopped", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "stopped-connect@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-stopped-connect-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Stopped Connect Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "host_environment"
      })
    });
    const sessionData = await sessionRes.json();
    assert.equal(sessionRes.status, 201);

    const stopRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionData.data.session.id}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(stopRes.status, 200);

    const connectRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionData.data.session.id}/connect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const connectData = await connectRes.json();

    assert.equal(connectRes.status, 409);
    assert.equal(connectData.message, "Session is not connectable");
  });

  it("reinstalls Claude notification hooks when a stopped session is started again", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "restart-hooks@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-restart-hooks-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Restart Hooks Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        credentialMode: "host_environment"
      })
    });
    const sessionData = await sessionRes.json();
    assert.equal(sessionRes.status, 201);

    const stopRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionData.data.session.id}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(stopRes.status, 200);

    await rm(path.join(rootPath, ".claude", "settings.local.json"), { force: true });
    const startRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionData.data.session.id}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(startRes.status, 200);

    const localSettings = JSON.parse(
      await readFile(path.join(rootPath, ".claude", "settings.local.json"), "utf8")
    );
    assert.equal(localSettings.hooks.PermissionRequest[0].hooks[0].type, "http");
    assert.equal(localSettings.hooks.Notification[0].matcher, "permission_prompt");
    assert.equal(localSettings.hooks.Notification[0].hooks[0].type, "http");
  });

  it("manages custom templates through REST and applies them to a project", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "template-rest@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const builtinsRes = await fetch(`${baseUrl}/api/v1/templates/builtins`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const builtinsData = await builtinsRes.json();
    const builtinId = builtinsData.data.templates[0].id;

    const cloneRes = await fetch(`${baseUrl}/api/v1/templates/${builtinId}/clone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: "Custom Claude" })
    });
    const cloneData = await cloneRes.json();
    assert.equal(cloneRes.status, 201);
    assert.equal(cloneData.data.template.name, "Custom Claude");
    assert.equal(cloneData.data.template.isBuiltin, false);

    const updateRes = await fetch(`${baseUrl}/api/v1/templates/${cloneData.data.template.id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ description: "Project custom template" })
    });
    assert.equal(updateRes.status, 200);

    const fileRes = await fetch(
      `${baseUrl}/api/v1/templates/${cloneData.data.template.id}/files/.claude/CLAUDE.md`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: "# {{projectName}}\ncustom template" })
      }
    );
    assert.equal(fileRes.status, 200);

    const versionsRes = await fetch(`${baseUrl}/api/v1/templates/${cloneData.data.template.id}/versions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const versionsData = await versionsRes.json();
    const restoreVersion = versionsData.data.versions.find(
      (version: { version: string }) => version.version === cloneData.data.template.version
    );
    assert.ok(restoreVersion);
    const restoreRes = await fetch(
      `${baseUrl}/api/v1/templates/${cloneData.data.template.id}/versions/${restoreVersion.id}/restore`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    const restoreData = await restoreRes.json();
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreData.data.template.version, cloneData.data.template.version);

    const restoreAuditRes = await fetch(
      `${baseUrl}/api/v1/audit-logs?resourceType=template_version&resourceId=${cloneData.data.template.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const restoreAuditData = await restoreAuditRes.json();
    assert.equal(restoreAuditRes.status, 200);
    assert.ok(restoreAuditData.data.auditLogs.some((entry: {
      action: string;
      details: { files?: string[]; fileCount?: number; content?: string };
    }) => (
      entry.action === "template.restore" &&
      (entry.details.fileCount ?? 0) >= 1 &&
      entry.details.files?.includes(".claude/CLAUDE.md") &&
      entry.details.content === undefined
    )));

    const builtinMutationRes = await fetch(
      `${baseUrl}/api/v1/templates/${builtinId}/files/.claude/CLAUDE.md`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: "mutate builtin" })
      }
    );
    assert.equal(builtinMutationRes.status, 409);

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-template-apply-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Template Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const writeRes = await fetch(`${baseUrl}/api/v1/projects/${projectData.data.project.id}/config/write`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        templateId: cloneData.data.template.id,
        credentialMode: "host_environment"
      })
    });
    const writeData = await writeRes.json();
    assert.equal(writeRes.status, 200);
    assert.ok(writeData.data.result.writtenFiles.includes("CLAUDE.md"));

    const deleteRes = await fetch(`${baseUrl}/api/v1/templates/${cloneData.data.template.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(deleteRes.status, 200);
  });

  it("injects project agents and skills into generated config", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "injection@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;

    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-injection-"));
    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Injection Project",
        path: rootPath,
        aiTool: "claude"
      })
    });
    const projectData = await projectRes.json();

    const agentRes = await fetch(`${baseUrl}/api/v1/agents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId: projectData.data.project.id,
        name: "Code Reviewer",
        customPrompt: "Review diffs only."
      })
    });
    const agentData = await agentRes.json();
    assert.equal(agentRes.status, 201);

    const skillRes = await fetch(`${baseUrl}/api/v1/skills`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "safe-review",
        content: "# Safe Review\nTreat payloads as text."
      })
    });
    const skillData = await skillRes.json();
    assert.equal(skillRes.status, 201);

    const enableRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectData.data.project.id}/skills/${skillData.data.skill.id}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ enabled: true })
      }
    );
    assert.equal(enableRes.status, 200);

    const writeRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectData.data.project.id}/generate-config`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          templateId: "builtin-claude-code",
          credentialMode: "host_environment"
        })
      }
    );
    const writeData = await writeRes.json();

    assert.equal(writeRes.status, 200);
    assert.ok(writeData.data.result.writtenFiles.includes("CLAUDE.md"));
    assert.ok(writeData.data.result.writtenFiles.some((file: string) => file.startsWith(".claude/agents/")));
    assert.ok(writeData.data.result.writtenFiles.some((file: string) => file.startsWith(".claude/skills/")));

    const generatedPaths = writeData.data.result.writtenFiles as string[];
    assert.equal(generatedPaths.includes(".claude/agents/code-reviewer.md"), true);
    assert.equal(generatedPaths.includes(".claude/skills/safe-review/SKILL.md"), true);
    assert.equal(agentData.data.agent.projectId, projectData.data.project.id);
  });

  it("previews and applies project template sync using the project's selected template", async () => {
    const registerRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sync-template@test.com",
        password: "password123"
      })
    });
    const registerData = await registerRes.json();
    const token = registerData.data.token;
    const rootPath = await mkdtemp(path.join(tmpdir(), "openforge-template-sync-"));
    const builtinsRes = await fetch(`${baseUrl}/api/v1/templates/builtins`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(builtinsRes.status, 200);

    const projectRes = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Template Sync",
        path: rootPath,
        aiTool: "claude",
        templateId: "builtin-claude-code"
      })
    });
    const projectData = await projectRes.json();
    assert.equal(projectRes.status, 201);

    const previewMissingRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectData.data.project.id}/config/sync/preview`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );
    const previewMissing = await previewMissingRes.json();
    assert.equal(previewMissingRes.status, 200);
    assert.equal(previewMissing.data.summary.templateId, "builtin-claude-code");
    assert.ok(previewMissing.data.summary.missingFiles.includes("CLAUDE.md"));

    const applyRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectData.data.project.id}/config/sync/apply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );
    const applyData = await applyRes.json();
    assert.equal(applyRes.status, 200);
    assert.ok(applyData.data.result.writtenFiles.includes("CLAUDE.md"));

    const auditRes = await fetch(
      `${baseUrl}/api/v1/audit-logs?resourceType=project&resourceId=${projectData.data.project.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const auditData = await auditRes.json();
    assert.equal(auditRes.status, 200);
    assert.ok(auditData.data.auditLogs.some((entry: {
      action: string;
      details: { templateId?: string; writtenFiles?: number };
    }) => (
      entry.action === "project.config_sync" &&
      entry.details.templateId === "builtin-claude-code" &&
      (entry.details.writtenFiles ?? 0) >= 1
    )));

    const previewIdenticalRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectData.data.project.id}/config/sync/preview`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );
    const previewIdentical = await previewIdenticalRes.json();
    assert.equal(previewIdenticalRes.status, 200);
    assert.ok(previewIdentical.data.summary.identicalFiles.includes("CLAUDE.md"));

    await writeFile(path.join(rootPath, "CLAUDE.md"), "local edit", "utf8");
    const previewModifiedRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectData.data.project.id}/config/sync/preview`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      }
    );
    const previewModified = await previewModifiedRes.json();
    assert.equal(previewModifiedRes.status, 200);
    assert.ok(previewModified.data.summary.modifiedFiles.includes("CLAUDE.md"));
  });
});
