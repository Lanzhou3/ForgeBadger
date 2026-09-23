import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { CopilotPreferencesRepository } from "../src/db/repositories/copilot-preferences-repository.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  return db;
}

function createProviderAndModel(db: Database.Database, userId: string) {
  const repo = new ModelProviderRepository(db, userId, "");
  const provider = repo.createProviderProfile({
    name: "Stub",
    providerKey: "stub",
    baseUrl: "https://stub.example",
    authType: "api_key",
    apiFormat: "openai",
    supportedAdapters: ["opencode"],
  });
  const profile = repo.createModelProfile({
    providerProfileId: provider.id,
    name: "Stub model",
    modelId: "stub-model",
    capabilities: ["chat"],
    isDefault: true,
  });
  return { repo, provider, profile };
}

describe("copilot preferences repository", () => {
  it("defaults to no model and 'off' effort", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("repo-defaults@example.com", "hash");
      const prefs = new CopilotPreferencesRepository(db, user.id);
      assert.deepEqual(prefs.get(), { modelId: null, thinkingEffort: "off" });
    } finally {
      db.close();
    }
  });

  it("persists partial updates without clobbering unrelated fields", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("repo-partial@example.com", "hash");
      const { profile } = createProviderAndModel(db, user.id);
      const prefs = new CopilotPreferencesRepository(db, user.id);
      prefs.set({ thinkingEffort: "medium" });
      assert.equal(prefs.get().thinkingEffort, "medium");
      prefs.set({ modelId: profile.id });
      const loaded = prefs.get();
      assert.equal(loaded.modelId, profile.id);
      assert.equal(loaded.thinkingEffort, "medium");
      prefs.set({ modelId: null });
      assert.deepEqual(prefs.get(), { modelId: null, thinkingEffort: "medium" });
    } finally {
      db.close();
    }
  });

  it("treats an empty patch as a no-op and returns the current state", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("repo-noop@example.com", "hash");
      const prefs = new CopilotPreferencesRepository(db, user.id);
      prefs.set({ thinkingEffort: "low" });
      assert.deepEqual(prefs.set({}), { modelId: null, thinkingEffort: "low" });
    } finally {
      db.close();
    }
  });

  it("rejects an unknown model profile", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("repo-unknown@example.com", "hash");
      createProviderAndModel(db, user.id);
      const prefs = new CopilotPreferencesRepository(db, user.id);
      assert.throws(() => prefs.set({ modelId: "no-such-profile" }), { code: "COPILOT_MODEL_INVALID" });
    } finally {
      db.close();
    }
  });

  it("rejects an inactive model profile", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("repo-inactive@example.com", "hash");
      const { profile } = createProviderAndModel(db, user.id);
      db.prepare("UPDATE model_profiles SET status = 'inactive' WHERE id = ?").run(profile.id);
      const prefs = new CopilotPreferencesRepository(db, user.id);
      assert.throws(() => prefs.set({ modelId: profile.id }), { code: "COPILOT_MODEL_INVALID" });
    } finally {
      db.close();
    }
  });

  it("normalizes a corrupted stored effort back to 'off'", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("repo-bogus@example.com", "hash");
      const prefs = new CopilotPreferencesRepository(db, user.id);
      prefs.set({ thinkingEffort: "high" });
      db.prepare("UPDATE user_settings SET copilot_thinking_effort = 'bogus' WHERE user_id = ?").run(user.id);
      assert.equal(prefs.get().thinkingEffort, "off");
    } finally {
      db.close();
    }
  });

  it("keeps preferences isolated per user", () => {
    const db = createTestDb();
    try {
      const userA = new UserRepository(db).create("repo-user-a@example.com", "hash");
      const userB = new UserRepository(db).create("repo-user-b@example.com", "hash");
      new CopilotPreferencesRepository(db, userA.id).set({ thinkingEffort: "high" });
      assert.equal(new CopilotPreferencesRepository(db, userB.id).get().thinkingEffort, "off");
      assert.equal(new CopilotPreferencesRepository(db, userA.id).get().thinkingEffort, "high");
    } finally {
      db.close();
    }
  });
});
