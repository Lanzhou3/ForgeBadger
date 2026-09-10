import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { CliConfigAppliedProviderRepository } from "../src/db/repositories/cli-config-applied-provider-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

const masterKey = "abcdef0123456789abcdef0123456789";

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

function createProvider(db: Database.Database, userId: string, providerKey: string): string {
  const repo = new ModelProviderRepository(db, userId, masterKey);
  return repo.createProviderProfile({
    name: providerKey,
    providerKey,
    baseUrl: "https://api.deepseek.com",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["claude", "codex"]
  }).id;
}

describe("CliConfigAppliedProviderRepository", () => {
  it("upserts and reads back the applied provider pointer", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("applied-repo@example.com", "hash");
    const providerId = createProvider(db, user.id, "deepseek");
    const repo = new CliConfigAppliedProviderRepository(db, user.id);

    repo.upsert("claude", providerId, "model-1");
    const pointer = repo.get("claude");

    assert.equal(pointer?.providerProfileId, providerId);
    assert.equal(pointer?.modelProfileId, "model-1");
    assert.equal(typeof pointer?.appliedAt, "number");
  });

  it("replaces the pointer for the same adapter and tracks adapters independently", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("applied-repo2@example.com", "hash");
    const firstId = createProvider(db, user.id, "deepseek");
    const secondId = createProvider(db, user.id, "kimi");
    const repo = new CliConfigAppliedProviderRepository(db, user.id);

    repo.upsert("claude", firstId, null);
    repo.upsert("codex", secondId, null);
    repo.upsert("claude", secondId, null);

    assert.equal(repo.get("claude")?.providerProfileId, secondId);
    assert.equal(repo.get("codex")?.providerProfileId, secondId);
    assert.equal(repo.get("kimi"), undefined);
  });

  it("scopes pointers to the owning tenant", () => {
    const db = createTestDb();
    const owner = new UserRepository(db).create("applied-owner@example.com", "hash");
    const other = new UserRepository(db).create("applied-other@example.com", "hash");
    const providerId = createProvider(db, owner.id, "deepseek");

    new CliConfigAppliedProviderRepository(db, owner.id).upsert("claude", providerId, null);

    assert.equal(new CliConfigAppliedProviderRepository(db, other.id).get("claude"), undefined);
  });

  it("clears the pointer", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("applied-clear@example.com", "hash");
    const providerId = createProvider(db, user.id, "deepseek");
    const repo = new CliConfigAppliedProviderRepository(db, user.id);

    repo.upsert("claude", providerId, null);
    repo.clear("claude");

    assert.equal(repo.get("claude"), undefined);
  });

  it("drops the pointer when the provider profile is deleted", () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("applied-cascade@example.com", "hash");
    const providerId = createProvider(db, user.id, "deepseek");
    const repo = new CliConfigAppliedProviderRepository(db, user.id);
    repo.upsert("claude", providerId, null);

    const deleted = new ModelProviderRepository(db, user.id, masterKey).deleteProviderProfile(providerId);

    assert.equal(deleted, true);
    assert.equal(repo.get("claude"), undefined);
  });
});
