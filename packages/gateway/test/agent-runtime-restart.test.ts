import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
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

const childMode = process.argv[2] === "--checkpoint-child";
const migrationsFolder = fileURLToPath(new URL("../src/db/migrations", import.meta.url));
type Scenario = "read" | "write" | "approval";

// The child deliberately exits without db.close() or runtime shutdown. All files are temporary.
if (childMode) {
  const directory = process.argv[3];
  const scenario = process.argv[4] as Scenario;
  const db = new Database(path.join(directory, "restart.sqlite"));
  db.pragma("journal_mode = WAL");
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create("restart-fixture@example.com", "hash");
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation();
  const runId = ledger.admit({ userId: user.id, conversationId: conversation.id, userText: "Resume the fixture" }, 2);
  const claim = ledger.claim(runId, "departed-process", 30_000)!;
  const step = ledger.addStep(runId, { kind: "tool", toolName: "restart_fixture", toolCallId: "call-1", inputJson: "{}", effect: scenario === "read" ? "read" : "write" });
  ledger.append(runId, { role: "assistant", kind: "tool_call", content: "restart_fixture", toolName: "restart_fixture", toolCallId: "call-1", toolInputJson: "{}" }, step.id);
  if (scenario === "approval") ledger.waitApproval(claim, step);
  else {
    ledger.startStep(claim, step);
    if (scenario === "write") writeFileSync(path.join(directory, "external-effect.txt"), "executed\n");
    // Advance only this fixture's persisted lease to model downtime exceeding its lease.
    db.prepare("UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?").run(runId);
  }
  writeFileSync(path.join(directory, "checkpoint.json"), JSON.stringify({ userId: user.id, runId }));
  process.exit(86);
} else {
  describe("Copilot file SQLite process restart", () => {
    for (const scenario of ["read", "write", "approval"] as const) {
      it(`preserves and safely resumes ${scenario} checkpoints across process exit`, async () => {
        const directory = mkdtempSync(path.join(tmpdir(), "copilot-restart-"));
        let db: Database.Database | undefined;
        try {
          const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--checkpoint-child", directory, scenario], {
            cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 30_000
          });
          assert.equal(child.error, undefined);
          assert.equal(child.status, 86, child.stderr);
          const { userId, runId } = JSON.parse(readFileSync(path.join(directory, "checkpoint.json"), "utf8")) as { userId: string; runId: string };
          db = new Database(path.join(directory, "restart.sqlite"));
          const ledger = new CopilotRunLedger(db, userId);
          let executions = 0;
          const llm: AgentLlmClient = {
            async stream({ onEvent }) { onEvent({ type: "text_delta", text: "Recovered" }); return { message: "Recovered" }; },
            async summarize() { return ""; },
            async generateTitle() { return ""; }
          };
          const toolRegistry = createAgentToolRegistry([{
            name: "restart_fixture", description: "Restart fixture", risk: scenario === "read" ? "read" : "operate",
            requiresApproval: scenario === "approval", inputSchema: z.object({}),
            async execute() { executions++; appendFileSync(path.join(directory, "external-effect.txt"), "executed\n"); return { recovered: true }; }
          }]);
          const orchestrator = createCopilotOrchestrator({ db, masterKey: "abcdef0123456789abcdef0123456789", eventBus: new ForgeBadgerEventBus(), llm, toolRegistry });
          await orchestrator.executeRun(userId, runId);
          if (scenario === "read") {
            assert.equal(executions, 1);
            assert.equal(ledger.get(runId)?.status, "completed");
            assert.equal(ledger.steps(runId)[0].attempt, 2);
            assert.ok(ledger.steps(runId)[0].fence > 1);
            assert.equal(ledger.log.listRunMessages(runId).filter(message => message.kind === "tool_result").length, 1);
          } else if (scenario === "write") {
            assert.equal(executions, 0);
            assert.equal(ledger.get(runId)?.status, "indeterminate");
            assert.equal(ledger.steps(runId)[0].status, "indeterminate");
            assert.equal(readFileSync(path.join(directory, "external-effect.txt"), "utf8"), "executed\n");
            await orchestrator.executeRun(userId, runId);
            assert.equal(executions, 0);
          } else {
            assert.equal(executions, 0);
            assert.equal(ledger.get(runId)?.status, "awaiting_approval");
            const action = ledger.log.listPendingActions(runId)[0];
            assert.equal(action.status, "pending");
            assert.equal(action.toolCallId, "call-1");
            assert.equal(action.inputDigest, ledger.steps(runId)[0].input_digest);
            assert.equal((await orchestrator.resumeAfterApproval({ userId, runId, actionId: action.id, approved: true })).resumed, true);
            assert.equal(executions, 1);
            assert.equal(ledger.get(runId)?.status, "completed");
          }
        } finally {
          if (db?.open) db.close();
          rmSync(directory, { recursive: true, force: true });
        }
      });
    }
  });
}
