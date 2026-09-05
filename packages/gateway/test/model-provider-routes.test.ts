import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createModelProviderRoutes } from "../src/routes/model-providers.js";
import type { FetchProviderModelsInput } from "../src/services/provider-model-fetch.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";

const deepseekProviderInput = {
  name: "DeepSeek",
  providerKey: "deepseek",
  baseUrl: "https://api.deepseek.com",
  anthropicBaseUrl: "https://api.deepseek.com/anthropic",
  openaiBaseUrl: "https://api.deepseek.com",
  authType: "api_key",
  apiFormat: "openai-compatible",
  supportedAdapters: ["claude", "opencode"]
};

const openaiProviderInput = {
  name: "OpenAI",
  providerKey: "openai",
  baseUrl: "https://api.openai.com/v1",
  openaiBaseUrl: "https://api.openai.com/v1",
  authType: "api_key",
  apiFormat: "openai",
  supportedAdapters: ["opencode", "codex"]
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const drizzleDb = drizzle(db);
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/db/migrations"
  );
  migrate(drizzleDb, { migrationsFolder });
  return db;
}

describe("model provider routes", () => {
  let app: express.Express;
  let db: Database.Database;
  let token: string;
  let userId: string;

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("provider-routes@example.com", "hash", { role: "admin" });
    userId = user.id;
    token = signJwt({ userId: user.id, email: user.email }, secret);
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey));
  });

  it("creates a custom provider without seeding models and retires legacy OpenCode preview apply", async () => {
    const catalog = await makeRequest(app, "GET", "/api/v1/model-providers/catalog", undefined, authHeaders());
    assert.equal(catalog.status, 404);

    const created = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    assert.equal(created.status, 201);
    const provider = created.body.data.provider;
    assert.equal(provider.providerKey, "deepseek");
    assert.equal(created.body.data.models, undefined);
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat",
      capabilities: ["chat", "code"]
    }, authHeaders());
    const credential = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/credentials`, {
      plaintextSecret: "explicit-deepseek-secret"
    }, authHeaders());

    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-provider-route-"));
    const preview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(preview.status, 404);
  });

  it("previews a Kimi provider apply in user-global scope without a project root", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      name: "Volcengine",
      providerKey: "volcengine",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["kimi"]
    }, authHeaders());
    assert.equal(created.status, 201);
    const provider = created.body.data.provider;
    assert.deepEqual(provider.supportedAdapters, ["kimi"]);
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/models`, {
      name: "DeepSeek V3.1",
      modelId: "deepseek-v3.1"
    }, authHeaders());
    assert.equal(model.status, 201);
    const credential = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/credentials`, {
      plaintextSecret: "explicit-kimi-secret"
    }, authHeaders());

    const preview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "kimi",
      scope: "user-global",
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(preview.status, 404);
  });

  it("requires a project root for project-scope preview apply", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      name: "Volcengine",
      providerKey: "volcengine",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["kimi"]
    }, authHeaders());
    const provider = created.body.data.provider;
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/models`, {
      name: "DeepSeek V3.1",
      modelId: "deepseek-v3.1"
    }, authHeaders());
    const credential = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/credentials`, {
      plaintextSecret: "explicit-global-secret"
    }, authHeaders());

    const preview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "kimi",
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(preview.status, 404);
  });

  it("treats a missing project root as user-global for Claude and OpenCode preview", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const provider = created.body.data.provider;
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat"
    }, authHeaders());
    const credential = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/credentials`, {
      plaintextSecret: "explicit-global-secret"
    }, authHeaders());

    const claudePreview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "claude",
      scope: "user-global",
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());
    const opencodePreview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "opencode",
      scope: "user-global",
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(claudePreview.status, 404);
    assert.equal(opencodePreview.status, 404);
  });

  it("uses adapter-specific endpoints for dual protocol provider products", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const provider = created.body.data.provider;
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat",
      capabilities: ["chat", "code"]
    }, authHeaders());
    const credential = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/credentials`, {
      plaintextSecret: "explicit-dual-secret"
    }, authHeaders());
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-dual-provider-route-"));

    const claudePreview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "claude",
      projectRoot: root,
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());
    const opencodePreview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());
    assert.equal(provider.anthropicBaseUrl, "https://api.deepseek.com/anthropic");
    assert.equal(provider.openaiBaseUrl, "https://api.deepseek.com");
    assert.equal(claudePreview.status, 404);
    assert.equal(opencodePreview.status, 404);
  });


  it("defaults manual custom providers to the Claude Code adapter", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      name: "Local Anthropic Compatible",
      providerKey: "local-anthropic",
      baseUrl: "http://localhost:11434/v1",
      authType: "none",
      apiFormat: "anthropic"
    }, authHeaders());

    assert.equal(created.status, 201);
    assert.deepEqual(created.body.data.provider.supportedAdapters, ["claude"]);
  });

  it("rejects apply requests that reference another provider's model or credential", async () => {
    const deepseek = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const openai = await makeRequest(app, "POST", "/api/v1/model-providers", openaiProviderInput, authHeaders());
    const deepseekModel = await makeRequest(app, "POST", `/api/v1/model-providers/${deepseek.body.data.provider.id}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat"
    }, authHeaders());
    const openaiModel = await makeRequest(app, "POST", `/api/v1/model-providers/${openai.body.data.provider.id}/models`, {
      name: "GPT",
      modelId: "gpt-test"
    }, authHeaders());
    const credential = await makeRequest(app, "POST", `/api/v1/model-providers/${openai.body.data.provider.id}/credentials`, {
      plaintextSecret: "sk-openai"
    }, authHeaders());
    const root = await mkdtemp(path.join(tmpdir(), "forgebadger-provider-route-"));

    const mismatchedModel = await makeRequest(app, "POST", `/api/v1/model-providers/${deepseek.body.data.provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: openaiModel.body.data.model.id
    }, authHeaders());
    const mismatchedCredential = await makeRequest(app, "POST", `/api/v1/model-providers/${deepseek.body.data.provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: deepseekModel.body.data.model.id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(mismatchedModel.status, 404);
    assert.equal(mismatchedCredential.status, 404);
  });

  it("deletes an added provider profile with its models and credentials", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const providerId = created.body.data.provider.id;
    await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat"
    }, authHeaders());
    await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-deepseek"
    }, authHeaders());

    const deleted = await makeRequest(app, "DELETE", `/api/v1/model-providers/${providerId}`, undefined, authHeaders());
    const listed = await makeRequest(app, "GET", "/api/v1/model-providers", undefined, authHeaders());

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.code, 0);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.providers.some((provider: { id: string }) => provider.id === providerId), false);
    assert.equal(listed.body.data.models.some((model: { providerProfileId: string }) => model.providerProfileId === providerId), false);
    assert.equal(listed.body.data.credentials.some((credential: { providerProfileId: string }) => credential.providerProfileId === providerId), false);
  });

  it("syncs missing provider models from the configured model endpoint", async () => {
    const fetchedInputs: FetchProviderModelsInput[] = [];
    const syncApp = express();
    syncApp.locals.jwtSecret = secret;
    syncApp.use(express.json());
    syncApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderModels: async (input) => {
        fetchedInputs.push(input);
        return [
          { id: "deepseek-v4-flash", ownedBy: "deepseek" },
          { id: "deepseek-v4-pro", ownedBy: "deepseek", contextWindow: 131072 },
        ];
      },
    }));
    const created = await makeRequest(syncApp, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const providerId = created.body.data.provider.id;
    const credential = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-deepseek"
    }, authHeaders());

    const synced = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/models/sync`, {
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(synced.status, 200);
    assert.equal(synced.body.code, 0);
    assert.equal(synced.body.data.fetchedCount, 2);
    assert.equal(synced.body.data.createdCount, 2);
    assert.equal(fetchedInputs[0]?.apiKey, "sk-deepseek");
    assert.equal(fetchedInputs[0]?.baseUrl, "https://api.deepseek.com");
    assert.deepEqual(
      synced.body.data.models.map((model: { modelId: string }) => model.modelId),
      ["deepseek-v4-flash", "deepseek-v4-pro"]
    );
    assert.deepEqual(
      synced.body.data.models.map((model: { contextWindow: number | null }) => model.contextWindow),
      [null, 131072]
    );
  });

  it("backfills context windows on existing models without overwriting set values", async () => {
    const syncApp = express();
    syncApp.locals.jwtSecret = secret;
    syncApp.use(express.json());
    syncApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderModels: async () => [
        { id: "kimi-k3", ownedBy: "moonshot", contextWindow: 262144 },
        { id: "kimi-k2", ownedBy: "moonshot", contextWindow: 131072 },
      ],
    }));
    const created = await makeRequest(syncApp, "POST", "/api/v1/model-providers", {
      name: "Kimi",
      providerKey: "kimi",
      baseUrl: "https://api.kimi.com",
      anthropicBaseUrl: "https://api.kimi.com/coding/",
      openaiBaseUrl: "https://api.kimi.com/v1",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude", "kimi"]
    }, authHeaders());
    const providerId = created.body.data.provider.id;
    await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-kimi"
    }, authHeaders());
    // One model pre-exists without a context window, one with an explicit value.
    await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/models`, {
      name: "K3", modelId: "kimi-k3"
    }, authHeaders());
    await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/models`, {
      name: "K2", modelId: "kimi-k2", contextWindow: 65536
    }, authHeaders());

    const synced = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/models/sync`, {}, authHeaders());

    assert.equal(synced.status, 200, JSON.stringify(synced.body));
    assert.equal(synced.body.data.createdCount, 0);
    assert.equal(synced.body.data.updatedCount, 1);
    const listed = await makeRequest(syncApp, "GET", `/api/v1/model-providers/${providerId}/models`, undefined, authHeaders());
    const windows = new Map(listed.body.data.models.map(
      (model: { modelId: string; contextWindow: number | null }) => [model.modelId, model.contextWindow]
    ));
    assert.equal(windows.get("kimi-k3"), 262144);
    assert.equal(windows.get("kimi-k2"), 65536);
  });

  it("syncs an Anthropic provider from its Anthropic endpoint", async () => {
    const fetchedInputs: FetchProviderModelsInput[] = [];
    const syncApp = express();
    syncApp.locals.jwtSecret = secret;
    syncApp.use(express.json());
    syncApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderModels: async (input) => {
        fetchedInputs.push(input);
        return [{ id: "claude-test", ownedBy: "anthropic" }];
      },
    }));
    const created = await makeRequest(syncApp, "POST", "/api/v1/model-providers", {
      name: "Anthropic API",
      providerKey: "anthropic-api",
      anthropicBaseUrl: "https://api.anthropic.com/v1",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["claude"],
    }, authHeaders());
    const providerId = created.body.data.provider.id;
    const credential = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-anthropic"
    }, authHeaders());

    const synced = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/models/sync`, {
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(synced.status, 200);
    assert.equal(fetchedInputs[0]?.baseUrl, "https://api.anthropic.com/v1");
    assert.equal(fetchedInputs[0]?.apiFormat, "anthropic");
  });

  it("surfaces model sync failures from the provider endpoint as errors", async () => {
    const syncApp = express();
    syncApp.locals.jwtSecret = secret;
    syncApp.use(express.json());
    syncApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderModels: async () => {
        throw new Error("Provider model endpoint returned HTTP 500 for sk-model-sync-secret");
      },
    }));
    const created = await makeRequest(syncApp, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const providerId = created.body.data.provider.id;
    const credential = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-deepseek"
    }, authHeaders());

    const synced = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/models/sync`, {
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(synced.status, 400);
    assert.equal(synced.body.code, 1);
    assert.match(synced.body.message, /HTTP 500/);
    assert.match(synced.body.message, /\[REDACTED\]/);
    assert.equal(synced.body.message.includes("sk-model-sync-secret"), false);
  });

  it("rejects a revoked explicit credential before model sync performs any fetch", async () => {
    let fetchCalled = false;
    const syncApp = express();
    syncApp.locals.jwtSecret = secret;
    syncApp.use(express.json());
    syncApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderModels: async () => { fetchCalled = true; return []; }
    }));
    const created = await makeRequest(syncApp, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const providerId = created.body.data.provider.id;
    const credential = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "revoked-sync-secret"
    }, authHeaders());
    db.prepare("UPDATE provider_credentials SET status = 'revoked' WHERE id = ?")
      .run(credential.body.data.credential.id);

    const synced = await makeRequest(syncApp, "POST", `/api/v1/model-providers/${providerId}/models/sync`, {
      credentialId: credential.body.data.credential.id
    }, authHeaders());

    assert.equal(synced.status, 400);
    assert.match(synced.body.message, /active .*credential/i);
    assert.equal(fetchCalled, false);
  });

  it("checks provider readiness with remote model-list evidence", async () => {
    const fetchedInputs: FetchProviderModelsInput[] = [];
    const readinessApp = express();
    readinessApp.locals.jwtSecret = secret;
    readinessApp.use(express.json());
    readinessApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderModels: async (input) => {
        fetchedInputs.push(input);
        return [
          { id: "deepseek-chat", ownedBy: "deepseek" },
          { id: "deepseek-reasoner", ownedBy: "deepseek" }
        ];
      }
    }));
    const created = await makeRequest(readinessApp, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const providerId = created.body.data.provider.id;
    const model = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat"
    }, authHeaders());
    const credential = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-deepseek"
    }, authHeaders());

    const readiness = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/readiness`, {
      adapter: "claude",
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id,
      includeRemoteCheck: true,
      timeoutMs: 5000
    }, authHeaders());

    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.code, 0);
    assert.equal(readiness.body.data.readiness.status, "ready");
    assert.equal(readiness.body.data.readiness.code, "ready");
    assert.equal(readiness.body.data.readiness.checks.remoteModelList, "passed");
    assert.equal(readiness.body.data.readiness.remote.modelCount, 2);
    assert.equal(readiness.body.data.readiness.remote.matchedModelId, "deepseek-chat");
    assert.equal(fetchedInputs[0]?.apiKey, "sk-deepseek");
    assert.equal(JSON.stringify(readiness.body).includes("sk-deepseek"), false);
  });

  it("returns structured provider readiness when an active credential is missing", async () => {
    let fetchCalled = false;
    const readinessApp = express();
    readinessApp.locals.jwtSecret = secret;
    readinessApp.use(express.json());
    readinessApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderModels: async () => {
        fetchCalled = true;
        return [];
      }
    }));
    const created = await makeRequest(readinessApp, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const providerId = created.body.data.provider.id;
    const model = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat"
    }, authHeaders());

    const readiness = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/readiness`, {
      adapter: "opencode",
      modelProfileId: model.body.data.model.id,
      includeRemoteCheck: true
    }, authHeaders());

    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.code, 0);
    assert.equal(readiness.body.data.readiness.status, "needs_attention");
    assert.equal(readiness.body.data.readiness.code, "missing_active_credential");
    assert.equal(readiness.body.data.readiness.checks.credential, "missing");
    assert.match(readiness.body.data.readiness.steps.join("\n"), /credential/i);
    assert.equal(fetchCalled, false);
  });

  it("validates Codex through the common provider readiness route", async () => {
    let fetchCalled = false;
    const readinessApp = express();
    readinessApp.locals.jwtSecret = secret;
    readinessApp.use(express.json());
    readinessApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      fetchProviderModels: async () => {
        fetchCalled = true;
        return [{ id: "gpt-5.1-codex", ownedBy: "openai" }];
      }
    }));
    const created = await makeRequest(readinessApp, "POST", "/api/v1/model-providers", openaiProviderInput, authHeaders());
    const providerId = created.body.data.provider.id;
    const model = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/models`, {
      name: "GPT Codex",
      modelId: "gpt-5.1-codex"
    }, authHeaders());
    const credential = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-openai"
    }, authHeaders());

    const readiness = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/readiness`, {
      adapter: "codex",
      modelProfileId: model.body.data.model.id,
      credentialId: credential.body.data.credential.id,
      includeRemoteCheck: true
    }, authHeaders());

    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.code, 0);
    assert.equal(readiness.body.data.readiness.status, "ready");
    assert.equal(readiness.body.data.readiness.code, "ready");
    assert.equal(readiness.body.data.readiness.checks.adapter, "supported");
    assert.equal(fetchCalled, true);

    fetchCalled = false;
    db.prepare("UPDATE provider_credentials SET status = 'revoked' WHERE id = ?")
      .run(credential.body.data.credential.id);
    const revoked = await makeRequest(readinessApp, "POST", `/api/v1/model-providers/${providerId}/readiness`, {
      adapter: "codex",
      credentialId: credential.body.data.credential.id,
      includeRemoteCheck: true
    }, authHeaders());
    assert.equal(revoked.body.data.readiness.code, "missing_active_credential");
    assert.equal(fetchCalled, false);
  });

  it("rejects catalogId payloads because preset providers are retired", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());

    assert.equal(created.status, 400);
    assert.equal(created.body.code, 1);
    assert.match(created.body.message, /Custom provider requires/i);
  });

  it("manages provider-scoped model defaults, updates, and deletion", async () => {
    const deepseek = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const openai = await makeRequest(app, "POST", "/api/v1/model-providers", openaiProviderInput, authHeaders());
    const providerId = deepseek.body.data.provider.id;
    const modelA = await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat",
      isDefault: true
    }, authHeaders());
    const modelB = await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/models`, {
      name: "DeepSeek Reasoner",
      modelId: "deepseek-reasoner"
    }, authHeaders());
    const foreignModel = await makeRequest(app, "POST", `/api/v1/model-providers/${openai.body.data.provider.id}/models`, {
      name: "GPT",
      modelId: "gpt-test"
    }, authHeaders());

    const updated = await makeRequest(app, "PATCH", `/api/v1/model-providers/${providerId}/models/${modelB.body.data.model.id}`, {
      name: "DeepSeek Reasoner Updated",
      capabilities: ["chat", "reasoning"]
    }, authHeaders());
    const defaulted = await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/models/${modelB.body.data.model.id}/set-default`, undefined, authHeaders());
    const mismatchedDelete = await makeRequest(app, "DELETE", `/api/v1/model-providers/${providerId}/models/${foreignModel.body.data.model.id}`, undefined, authHeaders());
    const deleted = await makeRequest(app, "DELETE", `/api/v1/model-providers/${providerId}/models/${modelA.body.data.model.id}`, undefined, authHeaders());
    const listed = await makeRequest(app, "GET", "/api/v1/model-providers", undefined, authHeaders());

    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.model.name, "DeepSeek Reasoner Updated");
    assert.deepEqual(updated.body.data.model.capabilities, ["chat", "reasoning"]);
    assert.equal(defaulted.status, 200);
    assert.equal(defaulted.body.data.model.isDefault, true);
    assert.equal(mismatchedDelete.status, 400);
    assert.match(mismatchedDelete.body.message, /provider/i);
    assert.equal(deleted.status, 200);
    assert.equal(listed.body.data.models.some((model: { id: string }) => model.id === modelA.body.data.model.id), false);
    assert.equal(listed.body.data.models.find((model: { id: string }) => model.id === modelB.body.data.model.id)?.isDefault, true);
  });

  it("deletes and rotates credentials only within the selected provider", async () => {
    const deepseek = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const openai = await makeRequest(app, "POST", "/api/v1/model-providers", openaiProviderInput, authHeaders());
    const providerId = deepseek.body.data.provider.id;
    const credential = await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      label: "old",
      plaintextSecret: "sk-old"
    }, authHeaders());
    const foreignCredential = await makeRequest(app, "POST", `/api/v1/model-providers/${openai.body.data.provider.id}/credentials`, {
      plaintextSecret: "sk-foreign"
    }, authHeaders());

    const rotated = await makeRequest(app, "POST", `/api/v1/model-providers/${providerId}/credentials/${credential.body.data.credential.id}/rotate`, {
      label: "new",
      plaintextSecret: "sk-new"
    }, authHeaders());
    const mismatchedDelete = await makeRequest(app, "DELETE", `/api/v1/model-providers/${providerId}/credentials/${foreignCredential.body.data.credential.id}`, undefined, authHeaders());
    const deleted = await makeRequest(app, "DELETE", `/api/v1/model-providers/${providerId}/credentials/${credential.body.data.credential.id}`, undefined, authHeaders());
    const listed = await makeRequest(app, "GET", "/api/v1/model-providers", undefined, authHeaders());

    assert.equal(rotated.status, 200);
    assert.equal(rotated.body.data.credential.label, "new");
    assert.equal(rotated.body.data.credential.secretPreview, "********");
    assert.equal(mismatchedDelete.status, 400);
    assert.match(mismatchedDelete.body.message, /provider/i);
    assert.equal(deleted.status, 200);
    assert.equal(listed.body.data.credentials.some((item: { id: string }) => item.id === credential.body.data.credential.id), false);
  });

  it("returns envelope errors for invalid custom provider payloads and denied apply roots", async () => {
    const invalidCustom = await makeRequest(app, "POST", "/api/v1/model-providers", {
      name: "Missing fields"
    }, authHeaders());
    const invalidAdapter = await makeRequest(app, "POST", "/api/v1/model-providers", {
      name: "Anthropic",
      providerKey: "anthropic",
      authType: "api_key",
      apiFormat: "anthropic",
      supportedAdapters: ["unknown"]
    }, authHeaders());
    assert.equal(invalidCustom.status, 400);
    assert.equal(invalidCustom.body.code, 1);
    assert.equal(invalidAdapter.status, 400);
    assert.equal(invalidAdapter.body.code, 1);

    const created = await makeRequest(app, "POST", "/api/v1/model-providers", deepseekProviderInput, authHeaders());
    const retired = await makeRequest(app, "POST", `/api/v1/model-providers/${created.body.data.provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: "/"
    }, authHeaders());

    assert.equal(retired.status, 404);
  });

  it("does not expose the retired Codex subscription route", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/codex/subscription/status", undefined, authHeaders());

    assert.equal(res.status, 404);
  });

  function authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
  }
});

async function makeRequest(
  app: express.Express,
  method: string,
  pathName: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  try {
    const res = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const responseBody = await res.json().catch(() => ({}));
    return { status: res.status, body: responseBody };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function listen(server: http.Server): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("No TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
