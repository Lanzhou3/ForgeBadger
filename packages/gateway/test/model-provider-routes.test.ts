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
import { createModelRoutes } from "../src/routes/models.js";
import { createCodexSubscriptionRoutes } from "../src/routes/codex-subscription.js";
import type { ProviderCatalogPreset } from "../src/services/model-catalog.js";
import type { FetchProviderModelsInput } from "../src/services/provider-model-fetch.js";

const secret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const testProviderCatalog: ProviderCatalogPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek test provider from models.dev.",
    baseUrl: "https://api.deepseek.com",
    region: "global",
    productType: "payg_api",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["claude", "opencode"],
    modelSource: "models.dev",
    source: "models.dev",
    endpoints: {
      anthropic: { baseUrl: "https://api.deepseek.com/anthropic" },
      openai: { baseUrl: "https://api.deepseek.com" }
    },
    modelFetch: { strategy: "openai-compatible", modelsUrl: "https://api.deepseek.com/models" },
    opencode: { npm: "@ai-sdk/openai-compatible", env: ["DEEPSEEK_API_KEY"] },
    defaultModels: []
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI test provider from models.dev.",
    baseUrl: "https://api.openai.com/v1",
    region: "global",
    productType: "payg_api",
    authType: "api_key",
    apiFormat: "openai",
    supportedAdapters: ["opencode"],
    modelSource: "models.dev",
    source: "models.dev",
    endpoints: {
      openai: { baseUrl: "https://api.openai.com/v1" }
    },
    modelFetch: { strategy: "openai-compatible" },
    opencode: { npm: "@ai-sdk/openai", env: ["OPENAI_API_KEY"] },
    defaultModels: []
  },
  {
    id: "qwen-coding-plan-cn",
    name: "Qwen Coding Plan 中国大陆",
    description: "Qwen Coding Plan endpoint for mainland China.",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    region: "cn",
    productType: "coding_plan",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["claude", "opencode"],
    modelSource: "static",
    source: "verified",
    endpoints: {
      anthropic: { baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic" },
      openai: { baseUrl: "https://coding.dashscope.aliyuncs.com/v1" }
    },
    opencode: { npm: "@ai-sdk/openai-compatible", env: ["DASHSCOPE_API_KEY"] },
    defaultModels: [
      {
        id: "qwen3.5-coder",
        name: "Qwen3.5 Coder",
        modelId: "qwen3.5-coder",
        capabilities: ["chat", "code", "reasoning"],
        contextWindow: 256000
      }
    ]
  }
];

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
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

  beforeEach(() => {
    db = createTestDb();
    const user = new UserRepository(db).create("provider-routes@example.com", "hash");
    token = signJwt({ userId: user.id, email: user.email }, secret);
    app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/models", createModelRoutes(db));
    app.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      loadProviderCatalog: async () => testProviderCatalog
    }));
    app.use("/api/v1/codex/subscription", createCodexSubscriptionRoutes());
  });

  it("creates a provider from catalog and applies an OpenCode preview with envelope responses", async () => {
    const catalog = await makeRequest(app, "GET", "/api/v1/model-providers/catalog", undefined, authHeaders());
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.code, 0);
    assert.ok(catalog.body.data.providers.some((provider: { id: string }) => provider.id === "deepseek"));

    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    assert.equal(created.status, 201);
    const provider = created.body.data.provider;
    assert.equal(provider.providerKey, "deepseek");
    assert.equal(created.body.data.models.length, 0);
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat",
      capabilities: ["chat", "code"]
    }, authHeaders());

    const root = await mkdtemp(path.join(tmpdir(), "openforge-provider-route-"));
    const preview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: model.body.data.model.id
    }, authHeaders());

    assert.equal(preview.status, 200);
    assert.equal(preview.body.code, 0);
    assert.equal(preview.body.data.preview.adapter, "opencode");
    assert.equal(preview.body.data.preview.changedFiles[0].relativePath, "opencode.json");
  });

  it("treats adding the same catalog provider as idempotent", async () => {
    const first = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const second = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.body.code, 0);
    assert.equal(second.body.data.provider.id, first.body.data.provider.id);

    const listed = await makeRequest(app, "GET", "/api/v1/model-providers", undefined, authHeaders());
    assert.equal(
      listed.body.data.providers.filter((provider: { providerKey: string }) => provider.providerKey === "deepseek").length,
      1
    );
  });

  it("treats repeated Qwen Coding Plan setup as idempotent", async () => {
    const first = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "qwen-coding-plan-cn"
    }, authHeaders());
    const second = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "qwen-coding-plan-cn"
    }, authHeaders());

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.body.code, 0);
    assert.equal(second.body.data.provider.id, first.body.data.provider.id);
    assert.equal(second.body.data.models.length, 0);

    const listed = await makeRequest(app, "GET", "/api/v1/model-providers", undefined, authHeaders());
    assert.equal(
      listed.body.data.providers.filter((provider: { providerKey: string }) => provider.providerKey === "qwen-coding-plan-cn").length,
      1
    );
    assert.equal(
      listed.body.data.models.filter((model: { providerProfileId: string }) => model.providerProfileId === first.body.data.provider.id).length,
      1
    );
  });

  it("uses adapter-specific endpoints for dual protocol provider products", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const provider = created.body.data.provider;
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat",
      capabilities: ["chat", "code"]
    }, authHeaders());
    const root = await mkdtemp(path.join(tmpdir(), "openforge-dual-provider-route-"));

    const claudePreview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "claude",
      projectRoot: root,
      modelProfileId: model.body.data.model.id
    }, authHeaders());
    const opencodePreview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: model.body.data.model.id
    }, authHeaders());
    const claudeSettings = JSON.parse(claudePreview.body.data.preview.files[0].content);
    const opencodeConfig = JSON.parse(opencodePreview.body.data.preview.files[0].content);

    assert.equal(provider.anthropicBaseUrl, "https://api.deepseek.com/anthropic");
    assert.equal(provider.openaiBaseUrl, "https://api.deepseek.com");
    assert.equal(claudeSettings.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
    assert.equal(opencodeConfig.provider.deepseek.options.baseURL, "https://api.deepseek.com");
  });

  it("applies OpenForge Copilot as an internal runtime default without project file writes", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const provider = created.body.data.provider;
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat",
      capabilities: ["chat", "code"]
    }, authHeaders());

    const preview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "openforge-copilot",
      modelProfileId: model.body.data.model.id
    }, authHeaders());
    const emptyRootPreview = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/preview-apply`, {
      adapter: "openforge-copilot",
      projectRoot: "",
      modelProfileId: model.body.data.model.id
    }, authHeaders());
    const applied = await makeRequest(app, "POST", `/api/v1/model-providers/${provider.id}/apply`, {
      adapter: "openforge-copilot",
      modelProfileId: model.body.data.model.id
    }, authHeaders());
    const listed = await makeRequest(app, "GET", "/api/v1/model-providers", undefined, authHeaders());

    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.preview.adapter, "openforge-copilot");
    assert.deepEqual(preview.body.data.preview.files, []);
    assert.deepEqual(preview.body.data.preview.changedFiles, []);
    assert.equal(emptyRootPreview.status, 200);
    assert.equal(emptyRootPreview.body.data.preview.adapter, "openforge-copilot");
    assert.equal(applied.status, 200);
    assert.equal(applied.body.data.result.internalDefault.modelProfileId, model.body.data.model.id);
    assert.equal(listed.body.data.models.find((item: { id: string }) => item.id === model.body.data.model.id)?.isDefault, true);
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
    const deepseek = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const openai = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "openai"
    }, authHeaders());
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
    const root = await mkdtemp(path.join(tmpdir(), "openforge-provider-route-"));

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

    assert.equal(mismatchedModel.status, 400);
    assert.equal(mismatchedModel.body.code, 1);
    assert.match(mismatchedModel.body.message, /provider/i);
    assert.equal(mismatchedCredential.status, 400);
    assert.equal(mismatchedCredential.body.code, 1);
    assert.match(mismatchedCredential.body.message, /provider/i);
  });

  it("deletes an added provider profile with its models and credentials", async () => {
    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
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
      loadProviderCatalog: async () => testProviderCatalog,
      fetchProviderModels: async (input) => {
        fetchedInputs.push(input);
        return [
          { id: "deepseek-v4-flash", ownedBy: "deepseek" },
          { id: "deepseek-v4-pro", ownedBy: "deepseek" },
        ];
      },
    }));
    const created = await makeRequest(syncApp, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
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
    assert.equal(fetchedInputs[0]?.modelsUrl, "https://api.deepseek.com/models");
    assert.deepEqual(
      synced.body.data.models.map((model: { modelId: string }) => model.modelId),
      ["deepseek-v4-flash", "deepseek-v4-pro"]
    );
  });

  it("serves provider catalog from an injected dynamic catalog loader", async () => {
    const catalogApp = express();
    catalogApp.locals.jwtSecret = secret;
    catalogApp.use(express.json());
    catalogApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      loadProviderCatalog: async () => [
        {
          id: "openrouter",
          name: "OpenRouter",
          description: "OpenRouter from models.dev",
          baseUrl: "https://openrouter.ai/api/v1",
          authType: "api_key",
          apiFormat: "openai-compatible",
          supportedAdapters: ["opencode"],
          modelSource: "models.dev",
          source: "models.dev",
          opencode: { npm: "@openrouter/ai-sdk-provider", env: ["OPENROUTER_API_KEY"] },
          defaultModels: [
            {
              id: "anthropic/claude-sonnet-4.5",
              name: "Claude Sonnet 4.5",
              modelId: "anthropic/claude-sonnet-4.5",
              capabilities: ["chat", "code"],
              contextWindow: 200000
            }
          ]
        }
      ]
    }));

    const catalog = await makeRequest(catalogApp, "GET", "/api/v1/model-providers/catalog", undefined, authHeaders());

    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.code, 0);
    assert.equal(catalog.body.data.providers[0].id, "openrouter");
    assert.equal(catalog.body.data.providers[0].source, "models.dev");
    assert.equal(catalog.body.data.providers[0].opencode.npm, "@openrouter/ai-sdk-provider");

    const created = await makeRequest(catalogApp, "POST", "/api/v1/model-providers", {
      catalogId: "openrouter"
    }, authHeaders());
    const providerId = created.body.data.provider.id;
    const root = await mkdtemp(path.join(tmpdir(), "openforge-provider-route-"));
    const preview = await makeRequest(catalogApp, "POST", `/api/v1/model-providers/${providerId}/preview-apply`, {
      adapter: "opencode",
      projectRoot: root,
      modelProfileId: created.body.data.models[0].id
    }, authHeaders());
    const opencodeConfig = JSON.parse(preview.body.data.preview.files[0].content);

    assert.equal(created.body.data.provider.opencodeNpm, "@openrouter/ai-sdk-provider");
    assert.equal(created.body.data.models[0].modelId, "anthropic/claude-sonnet-4.5");
    assert.equal(opencodeConfig.provider.openrouter.npm, "@openrouter/ai-sdk-provider");
  });

  it("creates a Claude Code preset with default models and previews Claude settings", async () => {
    const catalogApp = express();
    catalogApp.locals.jwtSecret = secret;
    catalogApp.use(express.json());
    catalogApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      loadProviderCatalog: async () => [
        {
          id: "moonshot-kimi",
          name: "Kimi",
          description: "Kimi Claude Code-compatible preset.",
          baseUrl: "https://api.moonshot.ai/anthropic",
          authType: "api_key",
          apiFormat: "anthropic",
          supportedAdapters: ["claude"],
          modelSource: "static",
          source: "cc-switch",
          defaultModels: [
            {
              id: "kimi-k2-0905-preview",
              name: "Kimi K2",
              modelId: "kimi-k2-0905-preview",
              capabilities: ["chat", "code", "reasoning"],
              contextWindow: 128000
            }
          ],
          claude: {
            env: {
              baseUrl: "ANTHROPIC_BASE_URL",
              authToken: "ANTHROPIC_AUTH_TOKEN",
              model: "ANTHROPIC_MODEL",
              smallFastModel: "ANTHROPIC_SMALL_FAST_MODEL",
              defaultSonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
              defaultHaikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
              defaultOpusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
              apiTimeoutMs: "API_TIMEOUT_MS"
            },
            defaultSmallFastModel: "kimi-k2-0905-preview"
          }
        }
      ]
    }));

    const created = await makeRequest(catalogApp, "POST", "/api/v1/model-providers", {
      catalogId: "moonshot-kimi"
    }, authHeaders());
    const providerId = created.body.data.provider.id;
    const credential = await makeRequest(catalogApp, "POST", `/api/v1/model-providers/${providerId}/credentials`, {
      plaintextSecret: "sk-kimi"
    }, authHeaders());
    const root = await mkdtemp(path.join(tmpdir(), "openforge-claude-provider-route-"));
    const preview = await makeRequest(catalogApp, "POST", `/api/v1/model-providers/${providerId}/preview-apply`, {
      adapter: "claude",
      projectRoot: root,
      modelProfileId: created.body.data.models[0].id,
      credentialId: credential.body.data.credential.id
    }, authHeaders());
    const settings = JSON.parse(preview.body.data.preview.files[0].content);

    assert.equal(created.status, 201);
    assert.deepEqual(created.body.data.provider.supportedAdapters, ["claude"]);
    assert.equal(created.body.data.models[0].modelId, "kimi-k2-0905-preview");
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.preview.adapter, "claude");
    assert.equal(preview.body.data.preview.changedFiles[0].relativePath, ".claude/settings.local.json");
    assert.equal(settings.env.ANTHROPIC_BASE_URL, "https://api.moonshot.ai/anthropic");
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, "{env:ANTHROPIC_AUTH_TOKEN}");
  });

  it("seeds one default model when creating a provider from the models.dev catalog", async () => {
    const catalogApp = express();
    catalogApp.locals.jwtSecret = secret;
    catalogApp.use(express.json());
    catalogApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      loadProviderCatalog: async () => [
        {
          id: "openai",
          name: "OpenAI",
          description: "OpenAI from models.dev",
          baseUrl: "https://api.openai.com/v1",
          authType: "api_key",
          apiFormat: "openai",
          supportedAdapters: ["opencode"],
          modelSource: "models.dev",
          source: "models.dev",
          opencode: { npm: "@ai-sdk/openai", env: ["OPENAI_API_KEY"] },
          defaultModels: [
            {
              id: "gpt-5.1",
              name: "GPT-5.1",
              modelId: "gpt-5.1",
              capabilities: ["chat", "code", "reasoning"],
              contextWindow: 400000
            },
            {
              id: "gpt-4.1",
              name: "GPT-4.1",
              modelId: "gpt-4.1",
              capabilities: ["chat", "code"],
              contextWindow: 100000
            }
          ]
        }
      ]
    }));

    const created = await makeRequest(catalogApp, "POST", "/api/v1/model-providers", {
      catalogId: "openai"
    }, authHeaders());

    assert.equal(created.status, 201);
    assert.equal(created.body.data.models.length, 1);
    assert.equal(created.body.data.models[0].modelId, "gpt-5.1");
    assert.equal(created.body.data.models[0].isDefault, true);
    assert.deepEqual(created.body.data.models[0].capabilities, ["chat", "code", "reasoning"]);
  });

  it("rejects catalog provider creation when the external catalog does not contain the id", async () => {
    const catalogApp = express();
    catalogApp.locals.jwtSecret = secret;
    catalogApp.use(express.json());
    catalogApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      loadProviderCatalog: async () => []
    }));

    const created = await makeRequest(catalogApp, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());

    assert.equal(created.status, 400);
    assert.equal(created.body.code, 1);
    assert.match(created.body.message, /Catalog provider not found/i);
  });

  it("rejects catalog providers with sensitive default headers or invalid OpenCode npm packages", async () => {
    const catalogApp = express();
    catalogApp.locals.jwtSecret = secret;
    catalogApp.use(express.json());
    catalogApp.use("/api/v1/model-providers", createModelProviderRoutes(db, masterKey, {
      loadProviderCatalog: async () => [
        {
          id: "header-secret",
          name: "Header Secret",
          description: "Invalid provider with credential-bearing headers.",
          baseUrl: "https://header-secret.example",
          authType: "api_key",
          apiFormat: "openai-compatible",
          supportedAdapters: ["opencode"],
          modelSource: "models.dev",
          source: "models.dev",
          headers: { Authorization: "Bearer leaked-token" },
          opencode: { npm: "@ai-sdk/openai-compatible", env: ["HEADER_SECRET_API_KEY"] },
          defaultModels: []
        },
        {
          id: "invalid-npm",
          name: "Invalid NPM",
          description: "Invalid provider with shell-like package name.",
          baseUrl: "https://invalid-npm.example",
          authType: "api_key",
          apiFormat: "openai-compatible",
          supportedAdapters: ["opencode"],
          modelSource: "models.dev",
          source: "models.dev",
          opencode: { npm: "@ai-sdk/openai-compatible; touch /tmp/owned", env: ["INVALID_NPM_API_KEY"] },
          defaultModels: []
        }
      ]
    }));

    const headerSecret = await makeRequest(catalogApp, "POST", "/api/v1/model-providers", {
      catalogId: "header-secret"
    }, authHeaders());
    const invalidNpm = await makeRequest(catalogApp, "POST", "/api/v1/model-providers", {
      catalogId: "invalid-npm"
    }, authHeaders());

    assert.equal(headerSecret.status, 400);
    assert.equal(headerSecret.body.code, 1);
    assert.match(headerSecret.body.message, /default headers/i);
    assert.equal(invalidNpm.status, 400);
    assert.equal(invalidNpm.body.code, 1);
    assert.match(invalidNpm.body.message, /OpenCode npm/i);
  });

  it("manages provider-scoped model defaults, updates, and deletion", async () => {
    const deepseek = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const openai = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "openai"
    }, authHeaders());
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
    const legacyModels = await makeRequest(app, "GET", "/api/v1/models", undefined, authHeaders());

    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.model.name, "DeepSeek Reasoner Updated");
    assert.deepEqual(updated.body.data.model.capabilities, ["chat", "reasoning"]);
    assert.equal(defaulted.status, 200);
    assert.equal(defaulted.body.data.model.isDefault, true);
    assert.equal(mismatchedDelete.status, 400);
    assert.match(mismatchedDelete.body.message, /provider/i);
    assert.equal(deleted.status, 200);
    assert.equal(listed.body.data.models.some((model: { id: string }) => model.id === modelA.body.data.model.id), false);
    assert.equal(legacyModels.body.data.models.some((model: { id: string }) => model.id === modelA.body.data.model.id), false);
    assert.equal(legacyModels.body.data.models.find((model: { id: string }) => model.id === modelB.body.data.model.id)?.isDefault, true);
  });

  it("deletes and rotates credentials only within the selected provider", async () => {
    const deepseek = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const openai = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "openai"
    }, authHeaders());
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
      supportedAdapters: ["codex"]
    }, authHeaders());
    assert.equal(invalidCustom.status, 400);
    assert.equal(invalidCustom.body.code, 1);
    assert.equal(invalidAdapter.status, 400);
    assert.equal(invalidAdapter.body.code, 1);

    const created = await makeRequest(app, "POST", "/api/v1/model-providers", {
      catalogId: "deepseek"
    }, authHeaders());
    const model = await makeRequest(app, "POST", `/api/v1/model-providers/${created.body.data.provider.id}/models`, {
      name: "DeepSeek Chat",
      modelId: "deepseek-chat"
    }, authHeaders());
    const preview = await makeRequest(app, "POST", `/api/v1/model-providers/${created.body.data.provider.id}/preview-apply`, {
      adapter: "opencode",
      projectRoot: "/",
      modelProfileId: model.body.data.model.id
    }, authHeaders());

    assert.equal(preview.status, 400);
    assert.equal(preview.body.code, 1);
    assert.match(preview.body.message, /Project root/);
  });

  it("exposes Codex subscription status without provider apply wiring", async () => {
    const res = await makeRequest(app, "GET", "/api/v1/codex/subscription/status", undefined, authHeaders());

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.status.providerApplyEnabled, false);
    assert.equal(res.body.data.status.identitySource, "chatgpt_subscription_sdk");
    assert.equal(res.body.data.status.sdk.packageName, "@openai/codex-sdk");
    assert.equal(res.body.data.status.sdk.docsUrl, "https://developers.openai.com/codex/sdk");
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
