import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { buildCompressedContext, MAX_CONTEXT_CHARS } from "../src/services/agent/context.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import type { AgentLlmClient, AgentLlmMessage } from "../src/services/agent/orchestrator-types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

/** Append `count` alternating text messages of roughly `charLength` chars. */
function appendText(log: CopilotConversationLog, conversationId: string, count: number, charLength: number): void {
  const base = "x".repeat(charLength);
  for (let index = 0; index < count; index += 1) {
    log.appendMessage(conversationId, {
      role: index % 2 === 0 ? "user" : "assistant",
      kind: "text",
      content: `${base} ${index}`
    });
  }
}

describe("copilot context compression", () => {
  it("returns the raw history without summarizing when under budget", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("ctx@example.com", "hash");
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    appendText(log, conversation.id, 5, 50);

    const summarizeCalls: AgentLlmMessage[][] = [];
    const llm = {
      async stream(request: any) { request.onEvent({ type: "done" }); },
      async summarize(input: { messages: AgentLlmMessage[] }) {
        summarizeCalls.push(input.messages);
        return "SUMMARY";
      }
    } as unknown as AgentLlmClient;

    const result = await buildCompressedContext(log, conversation.id, llm);
    assert.equal(result.compressed, false);
    assert.equal(result.messages.length, 5);
    assert.equal(summarizeCalls.length, 0);
  });

  it("summarizes the old head and keeps the recent tail when over budget", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("ctx@example.com", "hash");
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    appendText(log, conversation.id, 60, 2000); // ~120k chars > MAX_CONTEXT_CHARS

    const summarizeCalls: AgentLlmMessage[][] = [];
    const llm = {
      async stream(request: any) { request.onEvent({ type: "done" }); },
      async summarize(input: { messages: AgentLlmMessage[] }) {
        summarizeCalls.push(input.messages);
        return "SUMMARY";
      }
    } as unknown as AgentLlmClient;

    const result = await buildCompressedContext(log, conversation.id, llm);
    assert.equal(result.compressed, true);
    assert.equal(summarizeCalls.length, 1);
    assert.match(result.messages[0]!.content, /^\[会话摘要\]/);
    // Some recent tail is kept verbatim, and the newest message is preserved.
    assert.ok(result.messages.length > 1 && result.messages.length < 60);
    assert.equal(result.messages[result.messages.length - 1]!.content.endsWith(" 59"), true);
    // The rolling summary's covered sequence was persisted.
    const conversationRow = log.getConversation(conversation.id)!;
    assert.ok((conversationRow.summary_covered_sequence ?? 0) > 0);
  });

  it("advances the covered sequence so a second overflow only folds new messages", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("ctx@example.com", "hash");
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    appendText(log, conversation.id, 60, 2000);

    const summarizeCalls: AgentLlmMessage[][] = [];
    const llm = {
      async stream(request: any) { request.onEvent({ type: "done" }); },
      async summarize(input: { messages: AgentLlmMessage[] }) {
        summarizeCalls.push(input.messages);
        return "SUMMARY";
      }
    } as unknown as AgentLlmClient;

    await buildCompressedContext(log, conversation.id, llm);
    assert.equal(summarizeCalls.length, 1);

    appendText(log, conversation.id, 30, 2000); // +30 more messages
    await buildCompressedContext(log, conversation.id, llm);
    assert.equal(summarizeCalls.length, 2);

    // The second call folds the previously-uncovered head (~30 messages) plus
    // the accumulated summary prefix — NOT the already-covered older messages.
    const second = summarizeCalls[1]!;
    assert.ok(second.length >= 30 && second.length <= 32, `expected ~30, got ${second.length}`);
  });

  it("degrades to the raw history when summarization fails", async () => {
    const db = createTestDb();
    const user = new UserRepository(db).create("ctx@example.com", "hash");
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    appendText(log, conversation.id, 60, 2000);

    const llm = {
      async stream(request: any) { request.onEvent({ type: "done" }); },
      async summarize() { throw new Error("provider down"); }
    } as unknown as AgentLlmClient;

    const result = await buildCompressedContext(log, conversation.id, llm);
    assert.equal(result.compressed, false);
    assert.equal(result.messages.length, 60);
  });

  it("exposes a context budget constant for the harness", () => {
    assert.ok(MAX_CONTEXT_CHARS > 0);
  });
});
