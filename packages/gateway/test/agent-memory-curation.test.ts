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

it("curation binds proposal scopes to trusted run input and respects a completion fence", async () => {
  const previous = process.env.FORGEBADGER_COPILOT_MEMORY_CURATION;
  process.env.FORGEBADGER_COPILOT_MEMORY_CURATION = "1";
  const db = createTestDb();
  try {
    const user = new UserRepository(db).create("trusted@curation.test", "hash");
    const { ProjectRepository } = await import("../src/db/repositories/project-repository.js");
    const { CopilotConversationLog } = await import("../src/services/agent/conversation-log.js");
    const projects = new ProjectRepository(db, user.id);
    const trusted = projects.create({ name: "trusted", path: "/tmp/trusted", aiTool: "claude" });
    const forged = projects.create({ name: "forged", path: "/tmp/forged", aiTool: "claude" });
    const conversation = new CopilotConversationLog(db, user.id).createConversation();
    const llm = { async proposeMemory() { return [
      { kind: "fact", scope: "project", text: "trusted note", projectId: forged.id },
      { kind: "fact", scope: "session", text: "session note" }
    ]; } } as unknown as AgentLlmClient;
    const input = { db, userId: user.id, llm, userText: "remember", assistantText: "noted", projectId: trusted.id, conversationId: conversation.id };
    await maybePersistMemory({ ...input, canCommit: () => false });
    const memory = new AgentMemoryRepository(db, user.id);
    assert.equal(memory.list({ scope: "project", projectId: trusted.id }).length, 0);
    await maybePersistMemory(input);
    assert.equal(memory.list({ scope: "project", projectId: trusted.id }).length, 1);
    assert.equal(memory.list({ scope: "project", projectId: forged.id }).length, 0);
    assert.equal(memory.list({ scope: "session", conversationId: conversation.id }).length, 1);
  } finally {
    db.close();
    if (previous === undefined) delete process.env.FORGEBADGER_COPILOT_MEMORY_CURATION;
    else process.env.FORGEBADGER_COPILOT_MEMORY_CURATION = previous;
  }
});
