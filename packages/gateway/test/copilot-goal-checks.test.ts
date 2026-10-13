import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { ensureGoalSandbox, goalSandboxDir, runSandboxCommand } from "../src/services/agent/goal-sandbox.js";
import { createGoalSandboxTools } from "../src/services/agent/tools/goal-sandbox.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";
import { AgentError } from "../src/services/agent/types.js";

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-checks-state-"));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

interface ChecksFixture {
  db: Database.Database;
  userId: string;
  goalId: string;
  runId: string;
  sandboxDir: string;
  store: CopilotGoalStore;
  runChecks(input: unknown): Promise<Record<string, unknown>>;
  context: AgentToolContext;
}

function createFixture(): ChecksFixture {
  const db = new Database(":memory:");
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create("goal-checks@example.com", "hash");
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-checks-project-"));
  fs.writeFileSync(path.join(projectDir, "calc.txt"), "1+1\n");
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
    .run(projectId, user.id, "checks", projectDir, "claude", "active");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Checks goal", spec: "verify" }).id;
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goalId, Date.now(), Date.now());
  const sandboxDir = goalSandboxDir(db, goalId);
  ensureGoalSandbox(projectDir, sandboxDir);
  const tool = createGoalSandboxTools().find(entry => entry.name === "goal_run_checks")!;
  const context = { db, userId: user.id, masterKey: "k", runId } as AgentToolContext;
  return {
    db, userId: user.id, goalId, runId, sandboxDir, store,
    runChecks: input => tool.execute(input, context) as Promise<Record<string, unknown>>,
    context
  };
}

describe("goal_run_checks execution", () => {
  const dbs: Database.Database[] = [];
  function tracked(): ChecksFixture { const fixture = createFixture(); dbs.push(fixture.db); return fixture; }

  after(() => { for (const db of dbs) if (db.open) db.close(); });

  it("captures exit code, stdout and stderr inside the sandbox cwd", async () => {
    const fixture = tracked();
    const result = await runSandboxCommand(fixture.sandboxDir, "pwd && cat calc.txt");
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, new RegExp(fixture.sandboxDir.replace(/[/.]/g, "\\$&")));
    assert.match(result.stdout, /1\+1/);
    const failing = await runSandboxCommand(fixture.sandboxDir, "echo oops >&2; exit 3");
    assert.equal(failing.exitCode, 3);
    assert.match(failing.stderr, /oops/);
  });

  it("times out long-running commands and reports timedOut", async () => {
    const fixture = tracked();
    const result = await runSandboxCommand(fixture.sandboxDir, "sleep 30", 300);
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
    assert.ok(result.durationMs < 10_000);
  });

  it("refreshes the task verify record only on exit 0 with a matching taskId", async () => {
    const fixture = tracked();
    const [task] = fixture.store.addTasks(fixture.goalId, [{ description: "Verify calc", verifyCommand: "grep 1+1 calc.txt" }]);
    const failing = await fixture.runChecks({ command: "exit 1", taskId: task.id });
    assert.equal(failing.exitCode, 1);
    assert.equal(fixture.store.listTasks(fixture.goalId)[0]!.verified_at, null);
    const passing = await fixture.runChecks({ command: "grep 1+1 calc.txt", taskId: task.id }) as { verified: { taskId: string }; exitCode: number };
    assert.equal(passing.exitCode, 0);
    const refreshed = fixture.store.listTasks(fixture.goalId)[0]!;
    assert.equal(refreshed.verified_at !== null, true);
    assert.equal(refreshed.verify_exit_code, 0);
    assert.match(refreshed.evidence ?? "", /verify: grep 1\+1 calc\.txt/);
    assert.match(refreshed.evidence ?? "", /exit 0/);
  });

  it("refuses to record verification when the command does not match verify_command", async () => {
    const fixture = tracked();
    const [task] = fixture.store.addTasks(fixture.goalId, [{ description: "Guarded", verifyCommand: "grep 1+1 calc.txt" }]);
    await assert.rejects(fixture.runChecks({ command: "echo shortcut", taskId: task.id }),
      (error: unknown) => error instanceof Error && /does not match the task verify_command/.test(error.message));
    assert.equal(fixture.store.listTasks(fixture.goalId)[0]!.verified_at, null); // the gate stayed closed
    // The exact declared command verifies cleanly (symmetric positive case).
    await fixture.runChecks({ command: "grep 1+1 calc.txt", taskId: task.id });
    assert.notEqual(fixture.store.listTasks(fixture.goalId)[0]!.verified_at, null);
  });

  it("refuses a taskId on a task without verify_command", async () => {
    const fixture = tracked();
    const [plain] = fixture.store.addTasks(fixture.goalId, ["Plain task"]);
    await assert.rejects(fixture.runChecks({ command: "true", taskId: plain.id }),
      (error: unknown) => error instanceof Error && /has no verify_command/.test(error.message));
  });

  it("rejects a taskId that does not belong to the goal", async () => {
    const fixture = tracked();
    await assert.rejects(fixture.runChecks({ command: "true", taskId: "not-a-task" }),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_NOT_FOUND");
  });
});

describe("verify_command gating on task passes", () => {
  const dbs: Database.Database[] = [];
  function tracked(): ChecksFixture { const fixture = createFixture(); dbs.push(fixture.db); return fixture; }

  after(() => { for (const db of dbs) if (db.open) db.close(); });

  it("blocks passes until the verify command exits 0, then allows it", async () => {
    const fixture = tracked();
    const [task] = fixture.store.addTasks(fixture.goalId, [{ description: "Verified task", verifyCommand: "grep 1+1 calc.txt" }]);
    assert.throws(() => fixture.store.updateTask(fixture.goalId, task.id, "passes"),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_VERIFY_REQUIRED");
    await fixture.runChecks({ command: "grep 1+1 calc.txt", taskId: task.id });
    const passed = fixture.store.updateTask(fixture.goalId, task.id, "passes", "double-checked by model");
    assert.equal(passed?.status, "passes");
    assert.match(passed?.evidence ?? "", /verify: grep/);
    assert.match(passed?.evidence ?? "", /double-checked by model/);
  });

  it("keeps plain tasks on the M1 evidence rule", async () => {
    const fixture = tracked();
    const [plain] = fixture.store.addTasks(fixture.goalId, ["Plain task"]);
    assert.throws(() => fixture.store.updateTask(fixture.goalId, plain.id, "passes"),
      (error: unknown) => error instanceof AgentError && error.code === "COPILOT_GOAL_EVIDENCE_REQUIRED");
    const passed = fixture.store.updateTask(fixture.goalId, plain.id, "passes", "manual evidence");
    assert.equal(passed?.status, "passes");
    assert.equal(passed?.evidence, "manual evidence");
  });

  it("markTaskVerified appends to existing evidence instead of overwriting", async () => {
    const fixture = tracked();
    const [task] = fixture.store.addTasks(fixture.goalId, [{ description: "Append", verifyCommand: "grep 1+1 calc.txt" }]);
    fixture.store.updateTask(fixture.goalId, task.id, "in_progress", "preliminary note");
    await fixture.runChecks({ command: "grep 1+1 calc.txt", taskId: task.id });
    const evidence = fixture.store.listTasks(fixture.goalId)[0]!.evidence ?? "";
    assert.match(evidence, /preliminary note/);
    assert.match(evidence, /verify: grep 1\+1 calc\.txt/);
  });

  it("goal_add_tasks accepts both plain strings and verifyCommand objects", async () => {
    const fixture = tracked();
    const tasks = fixture.store.addTasks(fixture.goalId, ["legacy string", { description: "with verify", verifyCommand: "make test" }]);
    assert.equal(tasks[0]!.verify_command, null);
    assert.equal(tasks[1]!.verify_command, "make test");
    assert.deepEqual(tasks.map(task => task.seq), [1, 2]);
  });
});

after(() => { fs.rmSync(stateRoot, { recursive: true, force: true }); });
