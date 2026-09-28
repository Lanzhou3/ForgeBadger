import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import type { AgentLlmClient } from "../src/services/agent/orchestrator-types.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { startCopilotRuntime } from "../src/services/agent/runtime.js";

function fixture() {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations", import.meta.url)) });
  const user = new UserRepository(db).create("ledger@example.com", "hash");
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation();
  const input = { userId: user.id, conversationId: conversation.id, userText: "Check progress" };
  return { db, ledger, input };
}

describe("Copilot durable run ledger", () => {
  it("admits exactly one active run per conversation and keeps rejected input out of transcript", () => {
    const { db, ledger, input } = fixture();
    try {
      const runId = ledger.admit(input, 2);
      assert.throws(() => ledger.admit({ ...input, userText: "Duplicate" }, 2), /already has an active run/);
      assert.equal(ledger.log.listRuns(input.conversationId).length, 1);
      assert.deepEqual(ledger.log.listMessages(input.conversationId).map(m => m.content), [input.userText]);
      ledger.cancel(runId);
      assert.notEqual(ledger.admit(input, 2), runId);
    } finally { db.close(); }
  });

  it("isolates admission and claims between tenants and rejects absent conversation/project", () => {
    const { db, ledger, input } = fixture();
    try {
      const other = new UserRepository(db).create("other-ledger@example.com", "hash");
      const otherLedger = new CopilotRunLedger(db, other.id);
      assert.throws(() => otherLedger.admit({ ...input, userId: other.id }, 2), /Conversation not found/);
      assert.throws(() => ledger.admit({ ...input, conversationId: "missing" }, 2), /Conversation not found/);
      assert.throws(() => ledger.admit({ ...input, projectId: "missing" }, 2), /Project not found/);
      const runId = ledger.admit(input, 2);
      assert.equal(otherLedger.claim(runId, "other", 30_000), undefined);
      assert.equal(otherLedger.cancel(runId), false);
    } finally { db.close(); }
  });

  it("recovers an expired read checkpoint with a new fence and rejects stale commits and receipts", () => {
    const { db, ledger, input } = fixture();
    try {
      const runId = ledger.admit(input, 2);
      const first = ledger.claim(runId, "first", 30_000)!;
      const step = ledger.addStep(runId, { kind: "tool", toolName: "read", toolCallId: "read-1", inputJson: "{}" });
      ledger.startStep(first, step);
      assert.equal(ledger.claim(runId, "second", 30_000), undefined);
      db.prepare("UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?").run(runId);
      const second = ledger.claim(runId, "second", 30_000)!;
      assert.ok(second.fence > first.fence);
      assert.equal(ledger.steps(runId)[0].status, "pending");
      assert.equal(ledger.commit(first, () => assert.fail("old owner committed")), false);
      ledger.startStep(second, ledger.steps(runId)[0]);
      ledger.receipt(first, step, "stale result");
      assert.equal(ledger.steps(runId)[0].result_json, null);
      ledger.receipt(second, step, "fresh result");
      assert.equal(ledger.steps(runId)[0].result_json, "fresh result");
      assert.equal(ledger.steps(runId)[0].attempt, 2);
      assert.deepEqual(ledger.log.listMessages(input.conversationId).filter(m => m.kind === "tool_result").map(m => m.content), ["fresh result"]);
    } finally { db.close(); }
  });

  it("never replays an expired write without a receipt", () => {
    const { db, ledger, input } = fixture();
    try {
      const runId = ledger.admit(input, 2);
      const claim = ledger.claim(runId, "first", 30_000)!;
      const step = ledger.addStep(runId, { kind: "tool", toolName: "write", inputJson: "{}", effect: "write" });
      ledger.startStep(claim, step);
      db.prepare("UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?").run(runId);
      assert.equal(ledger.claim(runId, "recovery", 30_000), undefined);
      assert.equal(ledger.get(runId)?.status, "indeterminate");
      assert.equal(ledger.steps(runId)[0].status, "indeterminate");
      assert.equal(ledger.claim(runId, "retry", 30_000), undefined);
      assert.equal(ledger.steps(runId)[0].attempt, 1);
    } finally { db.close(); }
  });

  it("stores a late write receipt after cancellation without publishing output or completing the run", () => {
    const { db, ledger, input } = fixture();
    try {
      const runId = ledger.admit(input, 2);
      const claim = ledger.claim(runId, "worker", 30_000)!;
      const step = ledger.addStep(runId, { kind: "tool", toolName: "write", toolCallId: "write-1", inputJson: "{}", effect: "write" });
      ledger.startStep(claim, step);
      assert.equal(ledger.cancel(runId), true);
      assert.equal(ledger.steps(runId)[0].status, "indeterminate");
      assert.equal(new CopilotRunLedger(db, input.userId).claim(runId, "restart", 30_000), undefined);
      assert.equal(ledger.steps(runId)[0].attempt, 1);
      ledger.receipt(claim, step, "external mutation succeeded");
      assert.equal(ledger.steps(runId)[0].result_json, "external mutation succeeded");
      assert.equal(ledger.get(runId)?.status, "cancelled");
      assert.equal(ledger.finish(claim, "completed"), false);
      assert.equal(ledger.log.listMessages(input.conversationId).length, 1);
    } finally { db.close(); }
  });

  it("returns only the requested run transcript when multiple runs share one conversation", () => {
    const { db, ledger, input } = fixture();
    try {
      const first = ledger.admit(input, 2);
      ledger.append(first, { role: "assistant", kind: "text", content: "First run output" });
      ledger.cancel(first);
      const second = ledger.admit({ ...input, userText: "Second question" }, 2);
      ledger.append(second, { role: "assistant", kind: "text", content: "Second run output" });
      assert.deepEqual(ledger.log.listRunMessages(first).map(m => m.content), [input.userText, "First run output"]);
      assert.deepEqual(ledger.log.listRunMessages(second).map(m => m.content), ["Second question", "Second run output"]);
      assert.deepEqual(ledger.log.listRunMessages("missing"), []);
      const other = new UserRepository(db).create("other-run@example.com", "hash");
      assert.deepEqual(new CopilotRunLedger(db, other.id).log.listRunMessages(first), []);
    } finally { db.close(); }
  });

  it("refuses mismatched approval digests and expires pending approval on cancellation", () => {
    const { db, ledger, input } = fixture();
    try {
      const runId = ledger.admit(input, 2);
      const claim = ledger.claim(runId, "worker", 30_000)!;
      const step = ledger.addStep(runId, { kind: "tool", toolName: "write", toolCallId: "write-1", inputJson: JSON.stringify({ text: "中文\n'quoted'" }), effect: "write" });
      ledger.waitApproval(claim, step);
      const action = ledger.log.listPendingActions(runId)[0];
      db.prepare("UPDATE copilot_pending_actions SET input_digest='tampered' WHERE id=?").run(action.id);
      assert.equal(ledger.decide(runId, action.id, true), false);
      assert.equal(ledger.get(runId)?.status, "awaiting_approval");
      assert.equal(ledger.log.getPendingAction(action.id)?.status, "pending");
      assert.equal(ledger.cancel(runId), true);
      assert.equal(ledger.log.getPendingAction(action.id)?.status, "expired");
      assert.equal(ledger.decide(runId, action.id, true), false);
    } finally { db.close(); }
  });

  it("resumes an approved read-write-read batch once and preserves the model budget across approval", async () => {
    const { db, ledger, input } = fixture();
    const executions: string[] = [];
    let modelCalls = 0;
    const llm: AgentLlmClient = {
      async stream({ onEvent }) {
        modelCalls++;
        for (const name of ["read_first", "write_middle", "read_last"]) {
          onEvent({ type: "tool_call", toolCall: { id: name, name, arguments: "{}" } });
        }
        return { message: "" };
      },
      async summarize() { return ""; },
      async generateTitle() { return ""; }
    };
    const toolRegistry = createAgentToolRegistry(["read_first", "write_middle", "read_last"].map(name => ({
      name, description: name, risk: name === "write_middle" ? "operate" as const : "read" as const,
      requiresApproval: name === "write_middle", inputSchema: z.object({}),
      async execute() { executions.push(name); return { name }; }
    })));
    const orchestrator = createCopilotOrchestrator({ db, masterKey: "abcdef0123456789abcdef0123456789", llm, toolRegistry, eventBus: new ForgeBadgerEventBus(), maxSteps: 1 });
    try {
      const runId = await orchestrator.runTurn(input);
      assert.equal(ledger.get(runId)?.status, "awaiting_approval");
      assert.deepEqual(executions, ["read_first"]);
      const action = ledger.log.listPendingActions(runId)[0];
      const decisions = await Promise.all([
        orchestrator.resumeAfterApproval({ userId: input.userId, runId, actionId: action.id, approved: true }),
        orchestrator.resumeAfterApproval({ userId: input.userId, runId, actionId: action.id, approved: true })
      ]);
      assert.equal(decisions.filter(d => d.resumed).length, 1);
      assert.deepEqual(executions, ["read_first", "write_middle", "read_last"]);
      assert.equal(modelCalls, 1);
      assert.equal(ledger.get(runId)?.steps, 1);
      assert.equal(ledger.get(runId)?.status, "stopped");
      assert.deepEqual(ledger.log.listMessages(input.conversationId).filter(m => m.kind === "tool_result").map(m => m.toolCallId), ["read_first", "write_middle", "read_last"]);
    } finally { db.close(); }
  });

  it("stops lease timers before closing SQLite while a write outlives the shutdown drain", async () => {
    const { db, ledger, input } = fixture();
    const eventBus = new ForgeBadgerEventBus();
    const masterKey = "abcdef0123456789abcdef0123456789";
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const toolRegistry = createAgentToolRegistry([{
      name: "write_fixture", description: "External write", risk: "operate", requiresApproval: false,
      inputSchema: z.object({}),
      async execute() { entered(); await blocked; return { completed: true }; }
    }]);
    const llm: AgentLlmClient = {
      async stream({ onEvent }) {
        onEvent({ type: "tool_call", toolCall: { id: "write-1", name: "write_fixture", arguments: "{}" } });
        return { message: "" };
      },
      async summarize() { return ""; },
      async generateTitle() { return ""; }
    };
    const runtime = startCopilotRuntime({ db, masterKey, eventBus });
    await runtime.ready;
    const orchestrator = createCopilotOrchestrator({ db, masterKey, eventBus, llm, toolRegistry, leaseMs: 60 });
    const runId = await orchestrator.runTurn(input);
    const pending = ledger.log.listPendingActions(runId)[0]!;
    const running = orchestrator.resumeAfterApproval({userId: input.userId, runId, actionId: pending.id, approved: true});
    try {
      await started;
      await Promise.all([runtime.stop(), delay(1_050)]);
      const run = ledger.log.listRuns(input.conversationId)[0];
      assert.equal(run.status, "running");
      assert.equal(ledger.steps(run.id).find(step => step.kind === "tool")?.status, "running");
      db.close();
      // Let multiple would-be renewal ticks elapse; node:test detects uncaught timer errors.
      await delay(100);
      release();
      await running;
    } finally {
      release();
      await running;
      await runtime.stop();
      if (db.open) db.close();
    }
  });

  it("rolls back final output and model receipt when the terminal status checkpoint fails", async () => {
    const { db, ledger, input } = fixture();
    db.exec(`CREATE TRIGGER reject_completed_checkpoint BEFORE UPDATE OF status ON copilot_runs
      WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT, 'fixture checkpoint failure'); END`);
    const llm: AgentLlmClient = {
      async stream({ onEvent }) {
        onEvent({ type: "text_delta", text: "Final answer must commit atomically" });
        return { message: "Final answer must commit atomically" };
      },
      async summarize() { return ""; },
      async generateTitle() { return ""; }
    };
    const orchestrator = createCopilotOrchestrator({ db, masterKey: "abcdef0123456789abcdef0123456789", llm,
      toolRegistry: createAgentToolRegistry([]), eventBus: new ForgeBadgerEventBus() });
    try {
      await assert.rejects(orchestrator.runTurn(input), /fixture checkpoint failure/);
      const run = ledger.log.listRuns(input.conversationId)[0];
      assert.equal(run.status, "failed");
      assert.deepEqual(ledger.log.listMessages(input.conversationId).map(m => m.role), ["user"]);
      assert.equal(ledger.steps(run.id).some(step => step.status === "completed"), false);
      assert.equal(ledger.steps(run.id)[0].result_json, null);
    } finally { db.close(); }
  });
});
