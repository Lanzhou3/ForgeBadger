import assert from "node:assert/strict";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import { signJwt } from "../src/auth/jwt.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createCopilotRoutes } from "../src/routes/copilot.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";
import { parseRunInput } from "../src/services/agent/run-authorization.js";
import { createAgentToolRegistry, executeAgentTool } from "../src/services/agent/tool-registry.js";
import { computeToolSurface } from "../src/services/agent/tool-surface.js";
import { createPlatformTools } from "../src/services/agent/tools/index.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";

const registry = createAgentToolRegistry(createPlatformTools());
const proposal = { title: " Update documentation ", summary: " Describe the plan ", todos: [{ title: "Write examples", verifyCommand: "pnpm test" }] };
const parsedPlan = {
  status: "plan_proposed",
  plan: { ...proposal, title: "Update documentation", summary: "Describe the plan", constraints: [], acceptanceCriteria: [] },
};

function fixture() {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations/", import.meta.url)) });
  const userId = new UserRepository(db).create("plan-mode@example.test", "hash").id;
  const ledger = new CopilotRunLedger(db, userId);
  const conversationId = ledger.log.createConversation().id;
  return { db, userId, ledger, conversationId };
}

it("offers project reads and proposals in Plan Mode and excludes operate, session and mutation tools", () => {
  const context = { registry, hasSessionManager: true, hasMachineRoots: true };
  const plan = computeToolSurface({ mode: "plan" }, context);
  const execute = computeToolSurface({ mode: "execute" }, context);
  const planNames = new Set(plan.visible.map(tool => tool.name));
  for (const name of ["get_project", "read_project_file", "list_sessions", "pm_get_plan", "submit_plan"]) {
    assert.ok(planNames.has(name), name);
  }
  assert.deepEqual(execute.exclusion("pm_get_plan"), { layer: "goal-catalog", reason: "GOAL_CATALOG" });
  assert.deepEqual(execute.exclusion("submit_plan"), { layer: "restricted-mode", reason: "PLAN_MODE_REQUIRED" });

  const fleetPlan = computeToolSurface({ mode: "plan", goalId: "fleet-fixture", fleet: true }, context);
  for (const name of ["write_memory", "register_machine_root", "unregister_machine_root", "get_session_output",
    "terminal_run", "pm_set_goal", "goal_file_read", "goal_file_write", "fleet_read_note"]) {
    assert.ok(registry.tools.has(name), name);
    assert.deepEqual(fleetPlan.exclusion(name), { layer: "restricted-mode", reason: "PLAN_MODE_READ_ONLY" }, name);
  }
  assert.ok(fleetPlan.visible.some(tool => tool.name === "pm_get_handoff"));
});

it("validates and returns a structured proposal without writing goals or tasks", async () => {
  const { db, userId, conversationId } = fixture();
  try {
    const tool = registry.tools.get("submit_plan")!;
    const context = { db, userId, conversationId, masterKey: "fixture" };
    assert.equal(tool.risk, "read");
    assert.equal(tool.requiresApproval, false);
    assert.deepEqual(await executeAgentTool(tool, proposal, context), { ok: true, output: parsedPlan });
    for (const invalid of [{ ...proposal, todos: [] }, { ...proposal, todos: [{ title: "  " }] }, { ...proposal, execute: true }]) {
      await assert.rejects(executeAgentTool(tool, invalid, context), /Invalid tool input|too_small|unrecognized_keys/i);
    }
    const oversized = { ...proposal, todos: Array.from({ length: 30 }, (_, index) => ({ title: `Task ${index}`, description: "文".repeat(1000) })) };
    const rejected = await executeAgentTool(tool, oversized, context);
    assert.equal(rejected.ok, false);
    assert.match(rejected.error ?? "", /tool output limit/);
    for (const row of [
      db.prepare("SELECT count(*) AS total FROM project_manager_goals").get(),
      db.prepare("SELECT count(*) AS total FROM project_manager_work_items").get(),
    ]) assert.deepEqual(row, { total: 0 });
  } finally { db.close(); }
});

it("enforces Plan Mode at execution, including hidden tools and mutating slash commands", async () => {
  const { db, userId, ledger, conversationId } = fixture();
  try {
    let modelCalls = 0;
    const orchestrator = createCopilotOrchestrator({
      db, masterKey: "a".repeat(32), eventBus: new ForgeBadgerEventBus(), toolRegistry: registry,
      llm: {
        async stream(request) {
          assert.ok(request.messages.some(message => message.content?.includes("Active mode: PLAN MODE")));
          assert.ok(request.tools.some(tool => tool.name === "submit_plan"));
          assert.ok(!request.tools.some(tool => tool.name === "write_memory"));
          if (modelCalls++ === 0) {
            request.onEvent({ type: "tool_call", toolCall: { id: "forged", name: "write_memory", arguments: "{}" } });
            request.onEvent({ type: "tool_call", toolCall: { id: "plan", name: "submit_plan", arguments: JSON.stringify(proposal) } });
          }
          return { message: modelCalls === 1 ? "" : "Ready for review." };
        },
        async summarize() { return ""; },
        async generateTitle() { return ""; },
      },
    });
    const runId = await orchestrator.runTurn({ userId, conversationId, mode: "plan", userText: "Plan the documentation update" });
    const receipts = ledger.log.listMessages(conversationId).filter(message => message.kind === "tool_result");
    assert.match(receipts.find(message => message.toolCallId === "forged")!.content, /Plan Mode cannot execute this tool/);
    assert.deepEqual(JSON.parse(receipts.find(message => message.toolCallId === "plan")!.content), parsedPlan);
    assert.deepEqual(ledger.log.listPendingActions(runId), []);

    await orchestrator.runTurn({ userId, conversationId, mode: "plan", userText: "/goal Write documentation" });
    assert.match(ledger.log.listMessages(conversationId).at(-1)!.content, /Switch to Execute Mode/);
    assert.deepEqual(db.prepare("SELECT count(*) AS total FROM copilot_goals").get(), { total: 0 });
    assert.equal(modelCalls, 2);
  } finally { db.close(); }
});

it("binds the run request key to its mode", () => {
  const { db, userId, ledger, conversationId } = fixture();
  try {
    const input = { userId, conversationId, userText: "Describe the changes", clientRequestId: "same-key", mode: "plan" as const };
    const runId = ledger.admit(input, 16);
    assert.equal(ledger.findRequest(input), runId);
    assert.throws(() => ledger.findRequest({ ...input, mode: "execute" }), { code: "COPILOT_REQUEST_CONFLICT" });
  } finally { db.close(); }
});

it("confirms a stored plan once, keeps its project binding, and preserves the existing board goal", async () => {
  const { db, userId, ledger, conversationId } = fixture();
  const projects = new ProjectRepository(db, userId);
  const projectId = projects.create({ name: "Original project", path: "/tmp/plan-original", aiTool: "" }).id;
  const otherProjectId = projects.create({ name: "Different project", path: "/tmp/plan-other", aiTool: "" }).id;
  const repo = new ProjectManagerRepository(db, userId);
  const originalGoal = repo.upsertGoal(projectId, { summary: "Existing milestone", status: "paused" });
  const eventBus = new ForgeBadgerEventBus();
  const masterKey = "a".repeat(32);
  const jwtSecret = "b".repeat(32);
  let proposed = false;
  const orchestrator = createCopilotOrchestrator({
    db, masterKey, eventBus, toolRegistry: registry,
    llm: {
      async stream(request) {
        if (proposed) return { message: "Ready for review." };
        proposed = true;
        request.onEvent({ type: "tool_call", toolCall: {
          id: "proposal", name: "submit_plan",
          arguments: JSON.stringify({ ...proposal, todos: [...proposal.todos, { title: "Unselected work" }] }),
        } });
        return { message: "" };
      },
      async summarize() { return ""; },
      async generateTitle() { return ""; },
    },
  });
  const app = express();
  app.locals.jwtSecret = jwtSecret;
  app.use(express.json());
  app.use("/api/v1/copilot", createCopilotRoutes({ db, masterKey, eventBus }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1/copilot/conversations/${conversationId}`;
    const headers = { Authorization: `Bearer ${signJwt({ userId, email: "plan-mode@example.test" }, jwtSecret)}`, "Content-Type": "application/json" };
    async function draftPlan() {
      proposed = false;
      const runId = await orchestrator.runTurn({ userId, conversationId, projectId, mode: "plan", userText: "Plan the docs" });
      const stepId = ledger.steps(runId).find(step => step.tool_name === "submit_plan")!.id;
      return (body: unknown) => fetch(`${base}/plans/${stepId}/confirm`, { method: "POST", headers, body: JSON.stringify(body) });
    }
    const confirm = await draftPlan();
    const input = { action: "save", todoIndexes: [0] };

    assert.ok(ledger.log.setConversationProject(conversationId, otherProjectId));
    assert.equal((await confirm(input)).status, 409);
    assert.equal(repo.listWorkItems(otherProjectId).length, 0);
    assert.ok(ledger.log.setConversationProject(conversationId, projectId));

    // Another active run prevents admission. Board writes roll back with it.
    const activeId = ledger.admit({ userId, conversationId, userText: "Another request" }, 16);
    assert.equal((await confirm({ action: "execute", todoIndexes: [0] })).status, 409);
    assert.equal(repo.listWorkItems(projectId).length, 0);
    assert.equal((await confirm({ action: "goal", todoIndexes: [0] })).status, 409);
    assert.equal(db.prepare("SELECT count(*) AS total FROM copilot_goals").pluck().get(), 0);
    await orchestrator.cancelRun({ userId, runId: activeId });

    const [first, retry] = await Promise.all([confirm(input), confirm(input)]);
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    const receipt = (await first.json()).data.confirmation;
    assert.deepEqual((await retry.json()).data.confirmation, receipt);
    assert.deepEqual(repo.listWorkItems(projectId).map(item => item.title), ["Write examples"]);
    assert.deepEqual(repo.getGoal(projectId), originalGoal);
    assert.equal((await confirm({ ...input, todoIndexes: [1] })).status, 409);
    const transcript = await fetch(`${base}/messages`, { headers });
    const messages = (await transcript.json()).data.messages;
    assert.deepEqual(messages.find((message: { kind: string }) => message.kind === "tool_result").planProposal,
      { projectId, confirmation: receipt });

    const execute = await draftPlan();
    const executionInput = { action: "execute", todoIndexes: [1], modelId: "selected-model" };
    const update = await execute(executionInput);
    assert.equal(update.status, 200);
    const executionReceipt = (await update.json()).data.confirmation;
    const execution = parseRunInput(ledger.get(executionReceipt.runId)!);
    assert.equal(execution.mode, "execute");
    assert.equal(execution.projectId, projectId);
    assert.equal(execution.modelId, "selected-model");
    assert.equal(execution.goalId, executionReceipt.goalId);
    assert.equal(new CopilotGoalStore(db, userId).getGoal(executionReceipt.goalId)?.auto_continue, 0);
    assert.equal(db.prepare("SELECT max_steps FROM copilot_runs WHERE id=?").pluck().get(executionReceipt.runId), 20);
    assert.match(execution.userText, /Unselected work/);
    assert.doesNotMatch(execution.userText, /Write examples/);
    assert.deepEqual((await (await execute(executionInput)).json()).data.confirmation, executionReceipt);
    assert.equal((await execute({ ...executionInput, modelId: "changed-model" })).status, 409);
    await orchestrator.cancelRun({ userId, runId: executionReceipt.runId });

    const startGoal = await draftPlan();
    const autonomous = await startGoal({ action: "goal", todoIndexes: [0] });
    assert.equal(autonomous.status, 200);
    const goalReceipt = (await autonomous.json()).data.confirmation;
    const store = new CopilotGoalStore(db, userId);
    assert.equal(store.getGoal(goalReceipt.goalId)?.project_id, projectId);
    const [task] = store.listTasks(goalReceipt.goalId);
    assert.equal(store.listTasks(goalReceipt.goalId).length, 1);
    assert.equal(task?.description, "Write examples");
    assert.equal(task?.verify_command, "pnpm test");
    assert.equal(repo.getWorkItem(projectId, task!.work_item_id!)?.title, "Write examples");
    assert.deepEqual((await (await startGoal({ action: "goal", todoIndexes: [0] })).json()).data.confirmation, goalReceipt);
    assert.equal(store.listGoals(conversationId).length, 2);
    assert.equal(repo.listWorkItems(projectId).length, 3);
    assert.deepEqual(repo.getGoal(projectId), originalGoal);
    await orchestrator.cancelRun({ userId, runId: goalReceipt.runId });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
