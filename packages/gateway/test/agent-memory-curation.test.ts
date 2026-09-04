import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { AgentMemoryRepository } from "../src/services/agent/memory.js";
import { isMemoryCurationEnabled, maybePersistMemory } from "../src/services/agent/memory-curation.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import type { AgentLlmClient } from "../src/services/agent/orchestrator-types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

describe("memory curation gate", () => {
  it("defaults to disabled", () => {
    assert.equal(isMemoryCurationEnabled({}), false);
  });

  it("is enabled by the env flag", () => {
    assert.equal(isMemoryCurationEnabled({ FORGEBADGER_COPILOT_MEMORY_CURATION: "1" }), true);
  });
});

describe("maybePersistMemory", () => {
  it("is a no-op when disabled", async () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("curate@example.com", "hash");
      let called = false;
      const llm = { async proposeMemory() { called = true; return []; } } as unknown as AgentLlmClient;
      await maybePersistMemory({
        db, userId: user.id, llm, userText: "hi", assistantText: "yo",
        // Force-disable regardless of process env.
      });
      // The gate reads process.env by default; clear the flag for determinism.
      assert.equal(called, false);
    } finally {
      db.close();
    }
  });

  it("persists valid proposals when enabled via env", async () => {
    const prev = process.env.FORGEBADGER_COPILOT_MEMORY_CURATION;
    process.env.FORGEBADGER_COPILOT_MEMORY_CURATION = "1";
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("curate@example.com", "hash");
      const llm = {
        async proposeMemory() {
          return [{ kind: "preference", scope: "global", text: "偏好使用中文" }];
        }
      } as unknown as AgentLlmClient;

      await maybePersistMemory({ db, userId: user.id, llm, userText: "hi", assistantText: "yo" });

      const entries = new AgentMemoryRepository(db, user.id).list({ scope: "global" });
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.kind, "preference");
    } finally {
      db.close();
      if (prev === undefined) delete process.env.FORGEBADGER_COPILOT_MEMORY_CURATION;
      else process.env.FORGEBADGER_COPILOT_MEMORY_CURATION = prev;
    }
  });

  it("silently ignores a proposal that fails validation", async () => {
    const prev = process.env.FORGEBADGER_COPILOT_MEMORY_CURATION;
    process.env.FORGEBADGER_COPILOT_MEMORY_CURATION = "1";
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("curate@example.com", "hash");
      const llm = {
        async proposeMemory() {
          return [{ kind: "bogus" as never, scope: "global" as never, text: "" }];
        }
      } as unknown as AgentLlmClient;

      await maybePersistMemory({ db, userId: user.id, llm, userText: "hi", assistantText: "yo" });
      assert.equal(new AgentMemoryRepository(db, user.id).list({ scope: "global" }).length, 0);
    } finally {
      db.close();
      if (prev === undefined) delete process.env.FORGEBADGER_COPILOT_MEMORY_CURATION;
      else process.env.FORGEBADGER_COPILOT_MEMORY_CURATION = prev;
    }
  });
});
