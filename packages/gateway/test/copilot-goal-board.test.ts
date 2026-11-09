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
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { goalContextMessage } from "../src/services/agent/goal-context.js";
import { evaluateGoalContinuation } from "../src/services/agent/goal-driver.js";
import { syncGoalFromBoard } from "../src/services/agent/goal-board.js";
import { createGoalTools } from "../src/services/agent/tools/goals.js";
import { createGoalDelegateTools } from "../src/services/agent/tools/goal-delegate.js";
import type { AgentToolContext } from "../src/services/agent/tool-registry.js";
import { AgentError } from "../src/services/agent/types.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";
import { computeToolSurface } from "../src/services/agent/tool-surface.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { createPlatformTools } from "../src/services/agent/tools/index.js";

const stateRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-board-state-")));
process.env.FORGEBADGER_STATE_DIR = stateRoot;

interface Fixture {
  db: Database.Database;
  userId: string;
  projectId: string;
  goalId: string;
  store: CopilotGoalStore;
  board: ProjectManagerRepository;
  context: AgentToolContext;
  tool(name: string): { execute(input: unknown, context: AgentToolContext): Promise<unknown> };
}

function fixture(): Fixture {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations") });
  const user = new UserRepository(db).create(`goal-board-${randomUUID()}@example.com`, "hash");
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fb-goal-board-project-")));
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES(?,?,?,?,?,?)")
    .run(projectId, user.id, "board-project", projectDir, "claude", "active");
  const conversation = new CopilotConversationLog(db, user.id).createConversation();
  const store = new CopilotGoalStore(db, user.id);
  const goalId = store.createGoal({ conversationId: conversation.id, projectId, title: "Board goal", spec: "ship it" }).id;
  const runId = randomUUID();
  db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
    VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(runId, user.id, conversation.id, goalId, Date.now(), Date.now());
  const tools = new Map([...createGoalTools(), ...createGoalDelegateTools()].map(tool => [tool.name, tool]));
  return {
    db, userId: user.id, projectId, goalId, store, board: new ProjectManagerRepository(db, user.id),
    context: { db, userId: user.id, masterKey: "k", runId } as AgentToolContext,
    tool: name => tools.get(name)!
  };
}

async function addTasks(f: Fixture, descriptions: unknown[]) {
  return (await f.tool("goal_add_tasks").execute({ descriptions }, f.context) as { tasks: Array<{ id: string; work_item_id: string | null }> }).tasks;
}

async function updateTask(f: Fixture, taskId: string, status: string, evidence?: string) {
  return f.tool("goal_update_task").execute({ taskId, status, ...(evidence ? { evidence } : {}) }, f.context);
}

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof AgentError && error.code === code;
}

describe("goal tasks on the project board", () => {
  const dbs: Database.Database[] = [];
  function tracked(f: Fixture): Fixture { dbs.push(f.db); return f; }
  after(() => { for (const db of dbs) if (db.open) db.close(); fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("backs every new goal task with a board work item", async () => {
    const f = tracked(fixture());
    const [plain, verified] = await addTasks(f, ["Write the parser", { description: "Wire the CLI", verifyCommand: "npm test" }]);
    const parserItem = f.board.getWorkItem(f.projectId, plain!.work_item_id!)!;
    assert.equal(parserItem.title, "Write the parser");
    assert.equal(parserItem.status, "todo");
    assert.deepEqual(parserItem.details.copilotGoal, { goalId: f.goalId });
    const cliItem = f.board.getWorkItem(f.projectId, verified!.work_item_id!)!;
    assert.deepEqual(cliItem.acceptanceCriteria, ["`npm test` exits 0"]);
  });

  it("adopts existing open work items and refuses invalid adoptions atomically", async () => {
    const f = tracked(fixture());
    const existing = f.board.createWorkItem(f.projectId, { title: "Existing board task", acceptanceCriteria: ["Done right"] });
    const [adopted] = await addTasks(f, [{ workItemId: existing.id }]);
    assert.equal(adopted!.work_item_id, existing.id);
    assert.equal(f.store.listTasks(f.goalId)[0]!.description, "Existing board task");

    const before = f.board.listWorkItems(f.projectId).length;
    await assert.rejects(addTasks(f, ["Would be orphaned", { workItemId: existing.id }]), rejectsWith("COPILOT_GOAL_INPUT_INVALID"));
    await assert.rejects(addTasks(f, ["Would be orphaned", { workItemId: randomUUID() }]), rejectsWith("COPILOT_NOT_FOUND"));
    assert.equal(f.board.listWorkItems(f.projectId).length, before, "no board item survives a refused batch");
    assert.equal(f.store.listTasks(f.goalId).length, 1);

    const closed = f.board.createWorkItem(f.projectId, { title: "Closed" });
    f.board.updateWorkItemStatus(f.projectId, closed.id, { status: "cancelled" });
    await assert.rejects(addTasks(f, [{ workItemId: closed.id }]), rejectsWith("COPILOT_GOAL_INPUT_INVALID"));
  });

  it("mirrors goal progress onto the board but never accepts the work item", async () => {
    const f = tracked(fixture());
    const [task] = await addTasks(f, ["Ship feature"]);
    const status = () => f.board.getWorkItem(f.projectId, task!.work_item_id!)!.status;
    await updateTask(f, task!.id, "in_progress");
    assert.equal(status(), "in_progress");
    await updateTask(f, task!.id, "failed");
    assert.equal(status(), "blocked");
    await updateTask(f, task!.id, "pending");
    assert.equal(status(), "todo");
    await updateTask(f, task!.id, "passes", "unit tests green");
    assert.equal(status(), "ready_for_review", "todo reaches review through in_progress");
    const item = f.board.getWorkItem(f.projectId, task!.work_item_id!)!;
    assert.ok(item.evidenceRefs.some(ref => ref.ref === `copilot-goal:${f.goalId}/task:${task!.id}`));
    assert.notEqual(item.status, "done");
  });

  it("leaves a work item alone while a board dispatch owns it", async () => {
    const f = tracked(fixture());
    const [task] = await addTasks(f, ["Board-dispatched"]);
    f.board.updateWorkItem(f.projectId, task!.work_item_id!, { details: { taskPacket: { attempt: { status: "dispatched" } } } });
    await updateTask(f, task!.id, "in_progress");
    assert.equal(f.board.getWorkItem(f.projectId, task!.work_item_id!)!.status, "todo");
  });

  it("takes owner acceptance and cancellation from the board and completes the goal", async () => {
    const f = tracked(fixture());
    const [accepted, cancelled] = await addTasks(f, [{ description: "Accepted on board", verifyCommand: "make check" }, "Dropped"]);
    // Owner accepts on the board without the goal ever running the verify command.
    f.board.updateWorkItemStatus(f.projectId, accepted!.work_item_id!, { status: "in_progress" });
    f.board.updateWorkItemStatus(f.projectId, accepted!.work_item_id!, { status: "done", manualCompletionReason: "Reviewed by owner" });
    f.board.updateWorkItemStatus(f.projectId, cancelled!.work_item_id!, { status: "cancelled" });
    assert.equal(syncGoalFromBoard(f.db, f.userId, f.store.getGoal(f.goalId)!), 2);
    assert.equal(syncGoalFromBoard(f.db, f.userId, f.store.getGoal(f.goalId)!), 0, "idempotent");
    const byId = new Map(f.store.listTasks(f.goalId).map(task => [task.id, task]));
    assert.equal(byId.get(accepted!.id)!.status, "passes");
    assert.equal(byId.get(cancelled!.id)!.status, "cancelled");
    await assert.rejects(updateTask(f, cancelled!.id, "in_progress"), rejectsWith("COPILOT_GOAL_TASK_CANCELLED"));

    f.db.prepare("UPDATE copilot_runs SET status='completed', completed_at=? WHERE user_id=? AND goal_id=?").run(Date.now(), f.userId, f.goalId);
    const deps = { db: f.db, masterKey: "k", eventBus: new ForgeBadgerEventBus() } as never;
    assert.equal(evaluateGoalContinuation(deps, f.userId, f.goalId, (() => randomUUID()) as never).action, "completed");
  });

  it("reopens a passed task the board sent back and pauses its completed goal", async () => {
    const f = tracked(fixture());
    const [task] = await addTasks(f, ["Reviewable"]);
    await updateTask(f, task!.id, "passes", "done locally");
    assert.equal(f.board.getWorkItem(f.projectId, task!.work_item_id!)!.status, "ready_for_review");
    assert.equal(syncGoalFromBoard(f.db, f.userId, f.store.getGoal(f.goalId)!), 0, "a mirrored review state is not drift");
    f.store.setStatus(f.goalId, "completed");
    await new Promise(resolve => setTimeout(resolve, 5));
    // Owner requests changes on the board.
    f.board.updateWorkItemStatus(f.projectId, task!.work_item_id!, { status: "in_progress" });
    assert.equal(syncGoalFromBoard(f.db, f.userId, f.store.getGoal(f.goalId)!), 1);
    assert.equal(f.store.listTasks(f.goalId)[0]!.status, "in_progress");
    assert.equal(f.store.getGoal(f.goalId)!.status, "paused");
    assert.equal(syncGoalFromBoard(f.db, f.userId, f.store.getGoal(f.goalId)!), 0, "idempotent");
  });

  it("mirrors again once a board dispatch is reconciled", async () => {
    const f = tracked(fixture());
    const [task] = await addTasks(f, ["Was board-dispatched"]);
    const attempt = { id: "a1", originIntentId: "i1", sessionId: "s1", promptDigest: "d", notificationBaseline: 0, status: "dispatched",
      createdAt: new Date().toISOString(), consumedNotificationId: "n1" };
    f.board.updateWorkItem(f.projectId, task!.work_item_id!, { details: { taskPacket: { attempt } } });
    await updateTask(f, task!.id, "in_progress");
    assert.equal(f.board.getWorkItem(f.projectId, task!.work_item_id!)!.status, "in_progress");
  });

  it("refuses to link a work item another open goal already owns and counts cancelled tasks as resolved", async () => {
    const f = tracked(fixture());
    const shared = f.board.createWorkItem(f.projectId, { title: "Owned elsewhere" });
    await addTasks(f, [{ workItemId: shared.id }]);
    const conversation = new CopilotConversationLog(f.db, f.userId).createConversation();
    const other = f.store.createGoal({ conversationId: conversation.id, projectId: f.projectId, title: "Other goal", spec: "s" });
    const otherRun = randomUUID();
    f.db.prepare(`INSERT INTO copilot_runs(id,user_id,conversation_id,status,goal_id,runtime_version,input_json,created_at,updated_at)
      VALUES(?,?,?,'running',?,1,'{}',?,?)`).run(otherRun, f.userId, conversation.id, other.id, Date.now(), Date.now());
    await assert.rejects(f.tool("goal_add_tasks").execute({ descriptions: [{ workItemId: shared.id }] }, { ...f.context, runId: otherRun }),
      rejectsWith("COPILOT_GOAL_INPUT_INVALID"));

    const [dropped] = await addTasks(f, ["To be dropped"]);
    f.board.updateWorkItemStatus(f.projectId, dropped!.work_item_id!, { status: "cancelled" });
    syncGoalFromBoard(f.db, f.userId, f.store.getGoal(f.goalId)!);
    const listed = f.store.listGoals().find(goal => goal.id === f.goalId)!;
    assert.deepEqual([listed.task_passes, listed.task_total], [1, 2]);
  });

  it("keeps shared projects off the board link", async () => {
    const f = tracked(fixture());
    const member = new UserRepository(f.db).create(`member-${randomUUID()}@example.com`, "hash");
    f.db.prepare("INSERT INTO collaboration_members(project_id,user_id,member_id,role) VALUES(?,?,?,?)").run(f.projectId, f.userId, member.id, "developer");
    const [task] = await addTasks(f, ["Unlinked"]);
    assert.equal(task!.work_item_id, null);
    assert.equal(f.board.listWorkItems(f.projectId).length, 0);
    await assert.rejects(addTasks(f, [{ workItemId: randomUUID() }]), rejectsWith("COPILOT_GOAL_BOARD_UNAVAILABLE"));
  });

  it("refuses to dispatch a task whose board blockers are not done", async () => {
    process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS = "claude";
    try {
      const f = tracked(fixture());
      const [schema, api] = await addTasks(f, ["Schema", "API"]);
      f.board.addWorkItemDependency(f.projectId, api!.work_item_id!, schema!.work_item_id!);
      await assert.rejects(f.tool("goal_dispatch_task").execute({ taskId: api!.id, aiTool: "claude", instructions: "build the API" }, f.context),
        (error: unknown) => rejectsWith("COPILOT_GOAL_TASK_BLOCKED")(error) && /Schema/.test((error as Error).message));
    } finally { delete process.env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS; }
  });

  it("offers board planning tools to goal and discovery runs, not to plain chat", () => {
    const registry = createAgentToolRegistry(createPlatformTools());
    const visible = (input: Record<string, unknown>) => new Set(computeToolSurface(input, { registry, hasSessionManager: true }).visible.map(tool => tool.name));
    const planning = ["pm_get_plan", "pm_set_goal", "pm_update_task_plan", "pm_manage_stage", "pm_manage_dependency", "pm_attach_evidence"];
    const chat = visible({ source: "user" });
    for (const name of planning) assert.equal(chat.has(name), false, `${name} hidden in plain chat`);
    for (const input of [{ source: "user", goalId: randomUUID() }, { source: "user", toolDiscovery: true }]) {
      const surface = visible(input);
      for (const name of planning) assert.ok(surface.has(name), `${name} visible for ${JSON.stringify(Object.keys(input))}`);
    }
    for (const name of ["pm_review_task", "pm_delete_work_item"]) assert.equal(visible({ source: "user", goalId: randomUUID() }).has(name), false);
  });

  it("gives the model task ids and board state in the goal context", async () => {
    const f = tracked(fixture());
    const [task] = await addTasks(f, [{ description: "Context task", verifyCommand: "npm test" }]);
    const message = goalContextMessage(f.db, f.userId, f.goalId)!;
    const state = JSON.parse(message.slice(message.indexOf("{"))) as { tasks: Array<Record<string, unknown>> };
    assert.deepEqual(
      { id: state.tasks[0]!.id, workItemId: state.tasks[0]!.workItemId, boardStatus: state.tasks[0]!.boardStatus, verifyCommand: state.tasks[0]!.verifyCommand },
      { id: task!.id, workItemId: task!.work_item_id, boardStatus: "todo", verifyCommand: "npm test" }
    );
  });
});
