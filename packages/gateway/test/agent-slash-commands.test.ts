import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient, AgentLlmStreamEvent } from "../src/services/agent/orchestrator-types.js";
import { resolveLocalCommandReply } from "../src/services/agent/slash-commands.js";
import { listCopilotSkillSummaries } from "../src/services/agent/skills/copilot-skills.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { OpenForgeEventBus, type OpenForgeEvent } from "../src/services/event-bus.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

interface StubLlm {
  client: AgentLlmClient;
  streamCalls(): number;
  titleCalls(): number;
}

/** LLM stub; forbidStream fails the test if the command path reaches the model. */
function createStubLlm(reply = "stubbed answer", options: { forbidStream?: boolean } = {}): StubLlm {
  let streams = 0;
  let titles = 0;
  return {
    client: {
      async stream(request: Parameters<AgentLlmClient["stream"]>[0]) {
        streams += 1;
        if (options.forbidStream) throw new Error("LLM must not be called for a slash command");
        const emit = request.onEvent as (event: AgentLlmStreamEvent) => void;
        emit({ type: "text_delta", text: reply });
        return { message: reply };
      },
      async summarize() {
        return "";
      },
      async generateTitle() {
        titles += 1;
        return "";
      }
    },
    streamCalls: () => streams,
    titleCalls: () => titles
  };
}

describe("resolveLocalCommandReply", () => {
  it("formats every enabled skill as name plus one-line description", () => {
    // Act
    const reply = resolveLocalCommandReply("/skills");

    // Assert
    const summaries = listCopilotSkillSummaries();
    assert.ok(reply);
    const lines = reply.split("\n");
    assert.equal(lines[0], `Enabled skills (${summaries.length}):`);
    assert.equal(lines.length, summaries.length + 1);
    for (const [index, skill] of summaries.entries()) {
      assert.equal(lines[index + 1], `- ${skill.name}: ${skill.description}`);
    }
  });

  it("returns null for anything that is not exactly /skills after trimming", () => {
    for (const input of ["hello", "/skills list", "/skillz", "look /skills", "/", "//skills"]) {
      assert.equal(resolveLocalCommandReply(input), null, `expected null for ${JSON.stringify(input)}`);
    }
  });
});

describe("copilot /skills command routing", () => {
  function setup(options: { forbidStream?: boolean } = {}) {
    // Arrange
    const db = createTestDb();
    const user = new UserRepository(db).create("slash-skills@example.com", "hash");
    const log = new CopilotConversationLog(db, user.id);
    const conversation = log.createConversation();
    const events: OpenForgeEvent[] = [];
    const eventBus = new OpenForgeEventBus();
    eventBus.on("event", (event: OpenForgeEvent) => events.push(event));
    const llm = createStubLlm("stubbed answer", options);
    const orchestrator = createCopilotOrchestrator({
      db,
      masterKey: "abcdef0123456789abcdef0123456789",
      toolRegistry: createAgentToolRegistry([]),
      llm: llm.client,
      eventBus
    });
    return { db, log, conversationId: conversation.id, userId: user.id, events, llm, orchestrator };
  }

  it("answers /skills with the formatted listing and never calls the LLM", async () => {
    // Arrange
    const { db, log, conversationId, userId, events, llm, orchestrator } = setup({ forbidStream: true });

    try {
      // Act
      const runId = await orchestrator.runTurn({ userId, conversationId, userText: "/skills" });

      // Assert: run completes locally with the registry listing.
      const messages = log.listMessages(conversationId);
      assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
      assert.equal(messages[0]?.content, "/skills");
      const summaries = listCopilotSkillSummaries();
      const expected = [
        `Enabled skills (${summaries.length}):`,
        ...summaries.map((skill) => `- ${skill.name}: ${skill.description}`)
      ].join("\n");
      assert.equal(messages[1]?.kind, "text");
      assert.equal(messages[1]?.content, expected);
      assert.equal(log.getRun(runId)?.status, "completed");
      assert.equal(llm.streamCalls(), 0);
      assert.equal(llm.titleCalls(), 0);
      const completed = events.find((event) => event.type === "copilot_run_updated" && event.status === "completed") as
        | (OpenForgeEvent & { message?: string })
        | undefined;
      assert.ok(completed);
      assert.equal(completed.message, expected);
    } finally {
      db.close();
    }
  });

  it("hits the command when trailing or leading whitespace surrounds it", async () => {
    // Arrange
    const { db, log, conversationId, userId, llm, orchestrator } = setup({ forbidStream: true });

    try {
      // Act
      const runId = await orchestrator.runTurn({ userId, conversationId, userText: "  /skills \t" });

      // Assert
      const assistant = log.listMessages(conversationId).find((message) => message.role === "assistant");
      assert.match(assistant?.content ?? "", /^Enabled skills \(\d+\):\n- /);
      assert.equal(log.getRun(runId)?.status, "completed");
      assert.equal(llm.streamCalls(), 0);
    } finally {
      db.close();
    }
  });

  it("matches the command case-insensitively", async () => {
    // Arrange
    const { db, log, conversationId, userId, llm, orchestrator } = setup({ forbidStream: true });

    try {
      // Act
      const runId = await orchestrator.runTurn({ userId, conversationId, userText: "/SKILLS" });

      // Assert
      const assistant = log.listMessages(conversationId).find((message) => message.role === "assistant");
      assert.match(assistant?.content ?? "", /^Enabled skills \(\d+\):/);
      assert.equal(log.getRun(runId)?.status, "completed");
      assert.equal(llm.streamCalls(), 0);
    } finally {
      db.close();
    }
  });

  it("routes non-command input through the regular model flow unchanged", async () => {
    // Arrange
    const { db, log, conversationId, userId, llm, orchestrator } = setup();

    try {
      // Act
      const runId = await orchestrator.runTurn({ userId, conversationId, userText: "帮我看看这个报错" });

      // Assert: the stub LLM produced the final assistant turn.
      const messages = log.listMessages(conversationId);
      const assistant = messages.filter((message) => message.role === "assistant");
      assert.equal(assistant.length, 1);
      assert.equal(assistant[0]?.content, "stubbed answer");
      assert.equal(log.getRun(runId)?.status, "completed");
      assert.equal(llm.streamCalls(), 1);
      assert.equal(messages.some((message) => message.content.startsWith("Enabled skills")), false);
    } finally {
      db.close();
    }
  });
});
