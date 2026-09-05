import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { buildCompressedContext } from "../src/services/agent/context.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { AgentMemoryRepository } from "../src/services/agent/memory.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import type { AgentLlmClient, AgentLlmMessage } from "../src/services/agent/orchestrator-types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function stubLlm(): AgentLlmClient {
  return {
    async stream(request: { onEvent: (event: { type: string }) => void }) {
      request.onEvent({ type: "done" });
    },
    async summarize() {
      return "SUMMARY";
    },
    async generateTitle() {
      return "";
    },
    async proposeMemory() {
      return [];
    }
  } as unknown as AgentLlmClient;
}

describe("copilot memory recall", () => {
  it("injects a [相关记忆] block as the first user message when memory matches", async () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("recall@example.com", "hash");
      const memory = new AgentMemoryRepository(db, user.id);
      memory.create({ kind: "preference", scope: "global", text: "prefers concise replies" });

      const log = new CopilotConversationLog(db, user.id);
      const conversation = log.createConversation();
      log.appendMessage(conversation.id, { role: "user", kind: "text", content: "remember my concise preferences" });

      const result = await buildCompressedContext(log, conversation.id, stubLlm(), undefined, { memory });
      assert.match(result.messages[0]!.content, /^\[相关记忆\]/);
      assert.match(result.messages[0]!.content, /concise/);
      assert.equal(result.messages[0]!.role, "user");
      assert.equal(result.messages.length, 2); // recall block + the user message
    } finally {
      db.close();
    }
  });

  it("injects nothing when no memory matches", async () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("recall@example.com", "hash");
      const memory = new AgentMemoryRepository(db, user.id);
      const log = new CopilotConversationLog(db, user.id);
      const conversation = log.createConversation();
      log.appendMessage(conversation.id, { role: "user", kind: "text", content: "unrelated query" });

      const result = await buildCompressedContext(log, conversation.id, stubLlm(), undefined, { memory });
      assert.equal(result.messages.length, 1);
      assert.doesNotMatch(result.messages[0]!.content, /相关记忆/);
    } finally {
      db.close();
    }
  });

  it("does not inject when no memory repository is provided", async () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("recall@example.com", "hash");
      const log = new CopilotConversationLog(db, user.id);
      const conversation = log.createConversation();
      log.appendMessage(conversation.id, { role: "user", kind: "text", content: "hello" });

      const result = await buildCompressedContext(log, conversation.id, stubLlm());
      assert.equal(result.messages.length, 1);
    } finally {
      db.close();
    }
  });

  it("satisfies the Anthropic first-user-message constraint when the log starts with an assistant message", async () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("recall@example.com", "hash");
      const memory = new AgentMemoryRepository(db, user.id);
      memory.create({ kind: "fact", scope: "global", text: "pnpm is the package manager" });

      const log = new CopilotConversationLog(db, user.id);
      const conversation = log.createConversation();
      // A conversation that (unusually) begins with an assistant text message.
      log.appendMessage(conversation.id, { role: "assistant", kind: "text", content: "let me start" });
      log.appendMessage(conversation.id, { role: "user", kind: "text", content: "which package manager do we use" });

      const result = await buildCompressedContext(log, conversation.id, stubLlm(), undefined, { memory });
      assert.equal(result.messages[0]!.role, "user");
      assert.match(result.messages[0]!.content, /相关记忆/);
    } finally {
      db.close();
    }
  });
});

describe("memory searchMulti", () => {
  it("merges global and project scopes by id without duplicates", () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("recall@example.com", "hash");
      const project = new ProjectRepository(db, user.id).create({ name: "proj", path: "/tmp/proj", aiTool: "claude" });
      const memory = new AgentMemoryRepository(db, user.id);
      memory.create({ kind: "fact", scope: "global", text: "platform uses pnpm monorepo" });
      memory.create({ kind: "decision", scope: "project", projectId: project.id, text: "project uses drizzle orm" });

      const merged = memory.searchMulti(
        [{ scope: "global" }, { scope: "project", projectId: project.id }],
        "pnpm drizzle"
      );
      assert.ok(merged.length >= 1);
      const ids = new Set(merged.map((entry) => entry.id));
      assert.equal(ids.size, merged.length);
    } finally {
      db.close();
    }
  });
});

it("isolates exact memory scopes and cannot delete another tenant's search index", () => {
  const db = createTestDb();
  try {
    const users = new UserRepository(db);
    const alice = users.create("alice@scope.test", "hash");
    const bob = users.create("bob@scope.test", "hash");
    const repo = new AgentMemoryRepository(db, alice.id);
    const other = new AgentMemoryRepository(db, bob.id);
    const project = new ProjectRepository(db, alice.id).create({ name: "scope", path: "/tmp/scope", aiTool: "claude" });
    const conversation = new CopilotConversationLog(db, alice.id).createConversation();
    const secondConversation = new CopilotConversationLog(db, alice.id).createConversation();
    const global = repo.create({ scope: "global", kind: "fact", text: "unique global" });
    repo.create({ scope: "project", projectId: project.id, kind: "fact", text: "unique project" });
    assert.deepEqual(repo.search("unique", { scope: "global" }).map((entry) => entry.id), [global.id]);
    const session = repo.create({ scope: "session", conversationId: conversation.id, kind: "fact", text: "unique session" });
    assert.deepEqual(repo.search("unique", { scope: "session", conversationId: conversation.id }).map((entry) => entry.id), [session.id]);
    assert.equal(repo.searchMulti([{ scope: "session", conversationId: secondConversation.id }], "unique").length, 0);
    assert.throws(() => repo.create({ scope: "session", kind: "fact", text: "unbound" }), /CONVERSATION_REQUIRED/);
    assert.throws(() => other.create({ scope: "project", projectId: project.id, kind: "fact", text: "wrong tenant" }), /PROJECT_NOT_FOUND/);
    assert.equal(other.delete(global.id), false);
    assert.equal(repo.list({ scope: "global" }).length, 1);
    assert.equal(repo.search("unique", { scope: "global" }).length, 1);
    assert.equal(repo.searchMulti([{ scope: "global" }], "unique").length, 1);
  } finally { db.close(); }
});
