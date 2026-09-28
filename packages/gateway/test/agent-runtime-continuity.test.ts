import assert from "node:assert/strict";
import { it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import type { AgentLlmClient } from "../src/services/agent/orchestrator-types.js";

function fixture(stream: AgentLlmClient["stream"], operate = false, maxSteps = 16, failWrite = false) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(drizzle(db), { migrationsFolder: new URL("../src/db/migrations", import.meta.url).pathname });
  const userId = new UserRepository(db).create("continuity@example.com", "hash").id;
  const log = new CopilotConversationLog(db, userId);
  const conversationId = log.createConversation().id;
  let executions = 0;
  const orchestrator = createCopilotOrchestrator({ db, masterKey: "a".repeat(32), eventBus: new ForgeBadgerEventBus(), maxSteps,
    llm: { stream, async summarize() { return "summary"; }, async generateTitle() { return ""; } },
    toolRegistry: createAgentToolRegistry([{ name: "test_tool", description: "test", risk: operate ? "operate" : "read", requiresApproval: operate,
      inputSchema: z.object({}), async execute() { executions++; if (failWrite) throw new Error("delivery unconfirmed after partial effect"); return { fact: "verified" }; } }]) });
  return { db, userId, conversationId, log, orchestrator, executions: () => executions };
}

it("persists a complete tool exchange for subsequent model requests", async () => {
  let calls = 0;
  const f = fixture(async ({ messages, onEvent }) => {
    calls++;
    if (calls === 1) onEvent({ type: "tool_call", toolCall: { id: "tc1", name: "test_tool", arguments: "{}" } });
    else {
      assert.ok(messages.some(m => m.role === "assistant" && m.toolCalls?.some(t => t.id === "tc1")));
      assert.ok(messages.some(m => m.role === "tool" && m.toolCallId === "tc1" && m.content.includes("verified")));
      onEvent({ type: "text_delta", text: "done" });
    }
    return { message: "" };
  });
  try {
    await f.orchestrator.runTurn({ userId: f.userId, conversationId: f.conversationId, userText: "check" });
    await f.orchestrator.runTurn({ userId: f.userId, conversationId: f.conversationId, userText: "remember results" });
    assert.equal(calls, 3);
  } finally { f.db.close(); }
});

it("approval resumes the model in the same run and pairs its result", async () => {
  let calls = 0;
  const f = fixture(async ({ onEvent }) => {
    calls++;
    if (calls === 1) onEvent({ type: "tool_call", toolCall: { id: "approved-call", name: "test_tool", arguments: "{}" } });
    else onEvent({ type: "text_delta", text: "confirmed" });
    return { message: "" };
  }, true);
  try {
    const runId = await f.orchestrator.runTurn({ userId: f.userId, conversationId: f.conversationId, userText: "operate" });
    const action = f.log.listPendingActions(runId)[0]!;
    await f.orchestrator.resumeAfterApproval({ userId: f.userId, runId, actionId: action.id, approved: true });
    assert.equal(calls, 2);
    assert.equal(f.executions(), 1);
    assert.equal(f.log.getRun(runId)?.status, "completed");
    assert.equal(f.log.listMessages(f.conversationId).find(m => m.kind === "tool_result")?.toolCallId, "approved-call");
  } finally { f.db.close(); }
});

it("late model completion cannot overwrite cancellation", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async ({ onEvent }) => { await blocked; onEvent({ type: "text_delta", text: "late" }); return { message: "late" }; });
  try {
    const running = f.orchestrator.runTurn({ userId: f.userId, conversationId: f.conversationId, userText: "slow" });
    const runId = f.log.listRuns(f.conversationId)[0]!.id;
    await f.orchestrator.cancelRun({ userId: f.userId, runId });
    release(); await running;
    assert.equal(f.log.getRun(runId)?.status, "cancelled");
    assert.equal(f.log.listMessages(f.conversationId).some(m => m.content === "late"), false);
  } finally { f.db.close(); }
});

it("a side-effect exception stops the run instead of asking the model to retry", async()=>{
  let calls=0;
  const f=fixture(async({onEvent})=>{
    calls++;
    onEvent({type:"tool_call",toolCall:{id:"unknown-write",name:"test_tool",arguments:"{}"}});
    return {message:""};
  },true,16,true);
  try {
    const runId=await f.orchestrator.runTurn({userId:f.userId,conversationId:f.conversationId,userText:"operate"});
    const action=f.log.listPendingActions(runId)[0]!;
    await f.orchestrator.resumeAfterApproval({userId:f.userId,runId,actionId:action.id,approved:true});
    assert.equal(f.log.getRun(runId)?.status,"indeterminate");
    assert.equal(calls,1);
    assert.equal(f.executions(),1);
    await f.orchestrator.executeRun(f.userId,runId);
    assert.equal(f.executions(),1);
  } finally {f.db.close();}
});
