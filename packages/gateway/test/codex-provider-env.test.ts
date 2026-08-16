import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { ApiKeyRepository } from "../src/db/repositories/api-key-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createLaunchPlan } from "../src/routes/sessions.js";

const masterKey = "abcdef0123456789abcdef0123456789";

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

describe("Codex provider env isolation", () => {
  it("injects stored provider credentials for non-Codex provider-backed launches", () => {
    const db = createTestDb();
    const userId = new UserRepository(db).create("provider-env@example.com", "hash").id;
    const repo = new ModelProviderRepository(db, userId, masterKey);
    const provider = repo.createProviderProfile({
      name: "DeepSeek",
      providerKey: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["opencode"]
    });
    const model = repo.createModelProfile({
      providerProfileId: provider.id,
      name: "DeepSeek Chat",
      modelId: "deepseek-chat"
    });
    repo.createCredential({
      providerProfileId: provider.id,
      plaintextSecret: "provider-secret"
    });

    const plan = createLaunchPlan({
      db,
      userId,
      masterKey,
      adapter: "opencode",
      projectRoot: "/workspace/app",
      sessionId: "session-1",
      credentialMode: "stored_encrypted_key",
      modelId: model.id
    });

    assert.equal(plan.env.DEEPSEEK_API_KEY, "provider-secret");
    assert.deepEqual(plan.secretEnvNames, ["DEEPSEEK_API_KEY"]);
    assert.deepEqual(plan.args, ["--model", "deepseek/deepseek-chat"]);
  });

  it("rejects model or third-party API key selection for Codex terminal launches", () => {
    const db = createTestDb();
    const userId = new UserRepository(db).create("codex-env@example.com", "hash").id;
    const providerRepo = new ModelProviderRepository(db, userId, masterKey);
    const provider = providerRepo.createProviderProfile({
      providerKey: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      authType: "api_key",
      apiFormat: "openai",
      supportedAdapters: ["codex"]
    });
    const model = providerRepo.createModelProfile({
      providerProfileId: provider.id,
      name: "GPT Codex",
      modelId: "gpt-5.1-codex"
    });
    const apiKey = new ApiKeyRepository(db, userId, masterKey).create({
      provider: "openai",
      plaintextKey: "secret-value"
    });

    assert.throws(
      () => createLaunchPlan({
        db,
        userId,
        masterKey,
        adapter: "codex",
        projectRoot: "/workspace/app",
        sessionId: "session-1",
        credentialMode: "stored_encrypted_key",
        apiKeyId: apiKey.id,
        modelId: model.id
      }),
      /subscription-managed/i
    );
    assert.throws(
      () => createLaunchPlan({
        db,
        userId,
        masterKey,
        adapter: "codex",
        projectRoot: "/workspace/app",
        sessionId: "session-1",
        credentialMode: "host_environment",
        modelId: model.id
      }),
      /subscription-managed/i
    );
  });
});
