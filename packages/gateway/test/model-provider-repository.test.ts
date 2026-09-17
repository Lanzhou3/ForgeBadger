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

  it("persists the plaintext-http trust flag and still blocks private targets", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("plaintext-http@example.com", "hash");
    const repo = new ModelProviderRepository(db, user.id, masterKey);

    // Without the flag a credential-bearing http:// endpoint is rejected.
    assert.throws(() => repo.createProviderProfile({
      name: "Lingsoul", providerKey: "lingsoul-dlife", anthropicBaseUrl: "http://lingsoul-dlife.cn",
      authType: "api_key", apiFormat: "anthropic", supportedAdapters: ["claude"]
    }), /public HTTPS endpoint/u);

    // With the flag it is accepted and the flag round-trips.
    const provider = repo.createProviderProfile({
      name: "Lingsoul", providerKey: "lingsoul-dlife", anthropicBaseUrl: "http://lingsoul-dlife.cn",
      authType: "api_key", apiFormat: "anthropic", supportedAdapters: ["claude"], allowPlaintextHttp: true
    });
    assert.equal(repo.getProviderProfile(provider.id)?.allowPlaintextHttp, true);
    assert.equal(repo.listProviderProfiles()[0]?.allowPlaintextHttp, true);
    // Default stays false when the flag is not supplied.
    const flagless = repo.createProviderProfile({
      name: "DeepSeek", providerKey: "deepseek-flagless", baseUrl: "https://api.deepseek.com",
      authType: "api_key", apiFormat: "openai-compatible", supportedAdapters: ["opencode"]
    });
    assert.equal(repo.getProviderProfile(flagless.id)?.allowPlaintextHttp, false);

    // The flag never relaxes the private/loopback guard.
    assert.throws(() => repo.createProviderProfile({
      name: "Private http", providerKey: "private-http", baseUrl: "http://192.168.1.10/v1",
      authType: "api_key", apiFormat: "openai-compatible", supportedAdapters: ["opencode"], allowPlaintextHttp: true
    }), /private or loopback/iu);
  });

});
