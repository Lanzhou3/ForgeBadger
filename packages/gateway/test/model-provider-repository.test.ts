import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ModelRepository } from "../src/db/repositories/model-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

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

describe("model provider repository", () => {
  it("stores provider profiles, model profiles, and redacted credentials per tenant", () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const user = users.create("provider-a@example.com", "hash");
    const otherUser = users.create("provider-b@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, "abcdef0123456789abcdef0123456789");
    const otherRepo = new ModelProviderRepository(db, otherUser.id, "abcdef0123456789abcdef0123456789");

    const provider = repo.createProviderProfile({
      name: "DeepSeek Gateway",
      providerKey: "deepseek",
      baseUrl: "https://api.deepseek.com",
      authType: "api_key",
      apiFormat: "openai-compatible",
      supportedAdapters: ["opencode"]
    });
    const model = repo.createModelProfile({
      providerProfileId: provider.id,
      name: "DeepSeek Chat",
      modelId: "deepseek-chat",
      capabilities: ["chat", "code"],
      isDefault: true
    });
    const credential = repo.createCredential({
      providerProfileId: provider.id,
      label: "Team key",
      plaintextSecret: "secret-value"
    });

    assert.equal(model.providerProfileId, provider.id);
    assert.equal(repo.listProviderProfiles().length, 1);
    assert.equal(repo.listModelProfiles(provider.id).length, 1);
    assert.equal(otherRepo.listProviderProfiles().length, 0);
    assert.equal(credential.secretPreview, "********");
    assert.equal("secretEncrypted" in credential, false);
    assert.equal(repo.decryptCredential(credential.id), "secret-value");
  });

  it("keeps legacy models mirrored to provider-backed model profiles with stable ids", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("legacy-provider@example.com", "hash");
    const legacyRepo = new ModelRepository(db, user.id);

    const legacyModel = legacyRepo.create({
      name: "Legacy Sonnet",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      endpoint: "https://api.anthropic.com"
    });
    const models = legacyRepo.list();
    const providerRepo = new ModelProviderRepository(db, user.id, "abcdef0123456789abcdef0123456789");

    assert.equal(models[0]?.id, legacyModel.id);
    assert.equal(models[0]?.provider, "anthropic");
    assert.equal(providerRepo.listModelProfiles()[0]?.id, legacyModel.id);
    assert.equal(providerRepo.listProviderProfiles()[0]?.providerKey, "anthropic");
  });

  it("removes legacy model mirrors when a provider profile is deleted", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("delete-provider@example.com", "hash");
    const legacyRepo = new ModelRepository(db, user.id);
    const legacyModel = legacyRepo.create({
      name: "Legacy DeepSeek",
      provider: "deepseek",
      modelId: "deepseek-chat",
      endpoint: "https://api.deepseek.com"
    });
    const providerRepo = new ModelProviderRepository(db, user.id, "abcdef0123456789abcdef0123456789");
    const provider = providerRepo.listProviderProfiles()[0];

    assert.equal(providerRepo.deleteProviderProfile(provider!.id), true);

    assert.equal(legacyRepo.getById(legacyModel.id), undefined);
    assert.deepEqual(legacyRepo.list(), []);
  });
});
