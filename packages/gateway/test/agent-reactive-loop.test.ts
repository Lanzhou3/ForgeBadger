import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { OpenForgeEventBus } from "../src/services/event-bus.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { attachCopilotReactiveLoop, PROACTIVE_CONVERSATION_TITLE } from "../src/services/agent/reactive-loop.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import type { AgentStack } from "../src/services/agent/agent-stack.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("copilot reactive loop", () => {
  function setup(overrides: { cooldownMs?: number } = {}) {
    const db = createTestDb();
    const user = new UserRepository(db).create("loop@example.com", "hash");
    const bus = new OpenForgeEventBus();
    const log = new CopilotConversationLog(db, user.id);
    const runCalls: Array<{ userId: string; conversationId: string; source?: string; userText: string }> = [];
    const stack = {
      log,
      memory: undefined,
      toolRegistry: undefined,
      orchestrator: {
        runTurn: async (input: { userId: string; conversationId: string; source?: string; userText: string }) => {
          runCalls.push(input);
          return "run-1";
        }
      }
    } as unknown as AgentStack;
    const loop = attachCopilotReactiveLoop({
      deps: { db, masterKey: "mk", eventBus: bus },
      buildAgentStack: () => stack,
      debounceMs: 5,
      cooldownMs: overrides.cooldownMs ?? 60
    });
    return { db, user, bus, log, runCalls, loop };
  }

  it("does not schedule proactive turns on non-trigger events", async () => {
    const { bus, user, runCalls, log, loop } = setup();
    bus.emitEvent({ type: "copilot_run_updated", userId: user.id, runId: "r", conversationId: "c", status: "running", occurredAt: new Date() });
    bus.emitEvent({ type: "error", userId: user.id, message: "boom", recoverable: false });
    bus.emitEvent({ type: "claude_notification", userId: user.id, sessionId: "s", hookEventName: "idle", notificationType: "idle", message: "m" });
    await sleep(30);
    assert.equal(runCalls.length, 0);
    assert.equal(log.listConversations().length, 0);
    loop.stop();
  });

  it("creates a proactive conversation and runs a reactive turn on a trigger event", async () => {
    const { bus, user, runCalls, log, loop } = setup();
    bus.emitEvent({ type: "session_status_changed", userId: user.id, sessionId: "s1", oldStatus: "running", newStatus: "completed", occurredAt: new Date() });
    await sleep(30);
    assert.equal(runCalls.length, 1);
    const call = runCalls[0]!;
    assert.equal(call.source, "reactive");
    assert.match(call.userText, /主动/);
    const conversations = log.listConversations();
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0]!.title, PROACTIVE_CONVERSATION_TITLE);
    assert.equal(conversations[0]!.id, call.conversationId);
    loop.stop();
  });

  it("collapses a burst of events within the debounce window into one fire", async () => {
    const { bus, user, runCalls, loop } = setup();
    for (let index = 0; index < 3; index += 1) {
      bus.emitEvent({ type: "activity_created", userId: user.id, activityId: `a${index}`, activityType: "session", status: "done", message: `m${index}`, createdAt: new Date() });
    }
    await sleep(30);
    assert.equal(runCalls.length, 1);
    loop.stop();
  });

  it("defers a second fire inside the cooldown window", async () => {
    const { bus, user, runCalls, loop } = setup({ cooldownMs: 1000 });
    bus.emitEvent({ type: "session_status_changed", userId: user.id, sessionId: "s1", oldStatus: "running", newStatus: "completed", occurredAt: new Date() });
    await sleep(30);
    assert.equal(runCalls.length, 1);

    bus.emitEvent({ type: "session_status_changed", userId: user.id, sessionId: "s2", oldStatus: "running", newStatus: "failed", occurredAt: new Date() });
    await sleep(30);
    // Still inside the 1s cooldown — the second turn is deferred, not fired.
    assert.equal(runCalls.length, 1);
    loop.stop();
  });

  it("stop() detaches the listener so later events never fire", async () => {
    const { bus, user, runCalls, loop } = setup();
    loop.stop();
    bus.emitEvent({ type: "session_status_changed", userId: user.id, sessionId: "s1", oldStatus: "running", newStatus: "completed", occurredAt: new Date() });
    await sleep(30);
    assert.equal(runCalls.length, 0);
  });
});
