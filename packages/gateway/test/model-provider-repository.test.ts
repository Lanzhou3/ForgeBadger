import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

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

describe("model provider repository", () => {
  it("stores provider profiles, model profiles, and redacted credentials per tenant", () => {
    const db = createTestDb();
    const users = new UserRepository(db);
    const user = users.create("provider-a@example.com", "hash");
    const otherUser = users.create("provider-b@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    const otherRepo = new ModelProviderRepository(db, otherUser.id, masterKey);

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
    db.prepare("UPDATE provider_credentials SET status = 'revoked' WHERE id = ?").run(credential.id);
    assert.throws(() => repo.decryptCredential(credential.id), /active/i);
  });

  it("rejects credential-bearing private endpoints while allowing auth-none local providers", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("endpoint-policy@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);
    assert.throws(() => repo.createProviderProfile({
      name: "Private secret target", providerKey: "private-secret", baseUrl: "http://127.0.0.1:11434/v1",
      authType: "api_key", apiFormat: "openai-compatible", supportedAdapters: ["opencode"]
    }), /public HTTPS endpoint/u);
    assert.doesNotThrow(() => repo.createProviderProfile({
      name: "Local no auth", providerKey: "local-no-auth", baseUrl: "http://127.0.0.1:11434/v1",
      authType: "none", apiFormat: "local", supportedAdapters: ["opencode"]
    }));
  });

});
