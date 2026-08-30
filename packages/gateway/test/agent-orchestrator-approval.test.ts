import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus, type ForgeBadgerEvent } from "../src/services/event-bus.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

describe("copilot orchestrator approval", () => {
  it("rejects a pending action that belongs to a different awaiting run without side effects", async () => {
    const db = createTestDb();
    try {
      const user = new UserRepository(db).create("orchestrator-approval@example.com", "hash");
      const log = new CopilotConversationLog(db, user.id);
      const conversation = log.createConversation();
      const actionRun = log.createRun(conversation.id, {});
      const requestedRun = log.createRun(conversation.id, {});
      log.updateRun(actionRun.id, { status: "awaiting_approval" });
      log.updateRun(requestedRun.id, { status: "awaiting_approval" });
      const action = log.createPendingAction({
        runId: actionRun.id,
        tool: "side_effect_tool",
        inputJson: "{}",
        inputDigest: "digest"
      });
      const events: ForgeBadgerEvent[] = [];
      const eventBus = new ForgeBadgerEventBus();
      eventBus.on("event", (event: ForgeBadgerEvent) => events.push(event));
      let executions = 0;
      const toolRegistry = createAgentToolRegistry([{
        name: "side_effect_tool",
        description: "Test-only external side effect",
        risk: "operate",
        requiresApproval: true,
        inputSchema: z.object({}),
        async execute() {
          executions += 1;
          return { ok: true };
        }
      }]);
      const llm: AgentLlmClient = {
        async stream() {
          throw new Error("LLM must not be called while deciding an approval");
        },
        async summarize() {
          return "";
        },
        async generateTitle() {
          return "";
        }
      };
      const orchestrator = createCopilotOrchestrator({
        db,
        masterKey: "abcdef0123456789abcdef0123456789",
        toolRegistry,
        llm,
        eventBus
      });

      const result = await orchestrator.resumeAfterApproval({
        userId: user.id,
        runId: requestedRun.id,
        actionId: action.id,
        approved: true
      });

      assert.deepEqual(result, { resumed: false, runId: requestedRun.id });
      assert.equal(executions, 0);
      assert.equal(events.length, 0);
      assert.equal(log.getPendingAction(action.id)?.status, "pending");
      assert.equal(log.getRun(actionRun.id)?.status, "awaiting_approval");
      assert.equal(log.getRun(requestedRun.id)?.status, "awaiting_approval");
      assert.equal(log.listMessages(conversation.id).length, 0);
    } finally {
      db.close();
    }
  });
});
