import assert from "node:assert/strict";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import express from "express";
import { signJwt } from "../src/auth/jwt.js";
import { ModelProviderRepository } from "../src/db/repositories/model-provider-repository.js";
import { CopilotPreferencesRepository } from "../src/db/repositories/copilot-preferences-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { createCopilotRoutes } from "../src/routes/copilot.js";
import { CopilotGoalStore } from "../src/services/agent/goal-store.js";
import { createCopilotOrchestrator } from "../src/services/agent/orchestrator.js";
import { loadRunFacts, parseRunInput } from "../src/services/agent/run-authorization.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";
import { listRunTrace } from "../src/services/agent/run-trace.js";
import { createAgentToolRegistry } from "../src/services/agent/tool-registry.js";
import { computeToolSurface } from "../src/services/agent/tool-surface.js";
import { createPlatformTools } from "../src/services/agent/tools/index.js";
import { ForgeBadgerEventBus } from "../src/services/event-bus.js";

const registry = createAgentToolRegistry(createPlatformTools());
const masterKey = "a".repeat(32);
const jwtSecret = "b".repeat(32);
const planArgs = { title: "Plan", summary: "Summary", todos: [{ title: "Step" }] };

function fixture() {
  const db = new Database(":memory:");
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../src/db/migrations/", import.meta.url)) });
  const users = new UserRepository(db);
  const userId = users.create("mode-a@example.test", "hash").id;
  const otherUserId = users.create("mode-b@example.test", "hash").id;
  const ledger = new CopilotRunLedger(db, userId);
  const conversationId = ledger.log.createConversation().id;
  const projectId = new ProjectRepository(db, userId).create({ name: "Mode project", path: "/tmp/mode-switch", aiTool: "" }).id;
  return { db, userId, otherUserId, ledger, conversationId, projectId };
}

type Script = (call: number, request: { tools: Array<{ name: string }>; messages: Array<{ content?: string }>; onEvent: (event: unknown) => void }) => string;

function orchestratorFor(db: Database.Database, script: Script) {
  let calls = 0;
  return createCopilotOrchestrator({
    db, masterKey, eventBus: new ForgeBadgerEventBus(), toolRegistry: registry,
    llm: {
      async stream(request) { return { message: script(calls++, request as never) }; },
      async summarize() { return ""; },
      async generateTitle() { return ""; },
    },
  });
}

const toolCall = (request: { onEvent: (event: unknown) => void }, id: string, name: string, args: unknown) =>
  request.onEvent({ type: "tool_call", toolCall: { id, name, arguments: JSON.stringify(args) } });

it("shows the mode tools only to owner-driven top-level runs in the right mode", () => {
  const context = { registry, hasSessionManager: true, hasMachineRoots: true };
  const visible = (input: Parameters<typeof computeToolSurface>[0]) =>
    new Set(computeToolSurface(input, context).visible.map(tool => tool.name));
  const has = (input: Parameters<typeof computeToolSurface>[0]) => ({
    enter: visible(input).has("enter_plan_mode"), propose: visible(input).has("propose_mode_switch") });

  assert.deepEqual(has({ mode: "execute", projectId: "p" }), { enter: true, propose: true });
  assert.deepEqual(has({}), { enter: true, propose: false });
  assert.deepEqual(has({ mode: "plan" }), { enter: false, propose: true });
  assert.deepEqual(has({ mode: "plan", goalId: "g" }), { enter: false, propose: false });
  assert.deepEqual(has({ goalId: "g", projectId: "p" }), { enter: false, propose: false });
  assert.deepEqual(has({ goalId: "f", fleet: true, projectId: "p" }), { enter: false, propose: false });
  assert.deepEqual(has({ executionMode: "research", projectId: "p" }), { enter: false, propose: false });
  assert.deepEqual(has({ source: "scheduled", projectId: "p" }), { enter: false, propose: false });
  assert.deepEqual(has({ source: "reactive", projectId: "p" }), { enter: false, propose: false });
  for (const name of ["enter_plan_mode", "propose_mode_switch"]) {
    assert.equal(registry.tools.get(name)?.risk, "read");
    assert.equal(registry.tools.get(name)?.requiresApproval, false);
  }
});

it("switches the current run into Plan Mode durably after enter_plan_mode", async () => {
  const { db, userId, ledger, conversationId } = fixture();
  try {
    const seen: Array<{ tools: string[]; planPrompt: boolean }> = [];
    const orchestrator = orchestratorFor(db, (call, request) => {
      seen.push({ tools: request.tools.map(tool => tool.name),
        planPrompt: request.messages.some(message => message.content?.includes("Active mode: PLAN MODE")) });
      if (call === 0) toolCall(request, "enter", "enter_plan_mode", { reason: "Large refactor" });
      if (call === 1) toolCall(request, "forged", "write_memory", {});
      if (call === 1) toolCall(request, "nested", "enter_plan_mode", { reason: "again" });
      return call < 2 ? "" : "Done";
    });
    const input = { userId, conversationId, mode: "execute" as const, userText: "Refactor everything", clientRequestId: "req-1" };
    const runId = await orchestrator.runTurn(input);

    assert.equal(seen[0]!.planPrompt, false);
    assert.ok(seen[0]!.tools.includes("enter_plan_mode") && !seen[0]!.tools.includes("submit_plan"));
    assert.equal(seen[1]!.planPrompt, true);
    assert.ok(seen[1]!.tools.includes("submit_plan") && !seen[1]!.tools.includes("enter_plan_mode"));

    const results = ledger.log.listMessages(conversationId).filter(message => message.kind === "tool_result");
    assert.deepEqual(JSON.parse(results.find(message => message.toolCallId === "enter")!.content),
      { status: "mode_changed", mode: "plan", reason: "Large refactor" });
    assert.match(results.find(message => message.toolCallId === "forged")!.content, /Plan Mode cannot execute this tool/);
    assert.match(results.find(message => message.toolCallId === "nested")!.content, /not available in this run/);

    // Durable: run facts reload as plan, conversation persisted, request digest still matches the original request.
    assert.equal(loadRunFacts(db, userId, runId)!.input.mode, "plan");
    assert.equal(ledger.log.getConversation(conversationId)!.mode, "plan");
    assert.equal(ledger.findRequest(input), runId);
    assert.ok(listRunTrace(db, userId, runId).some(entry => entry.event === "mode_changed"));
    // Approval revalidation reads the same surface from the persisted facts.
    assert.equal(parseRunInput(ledger.get(runId)!).mode, "plan");
  } finally { db.close(); }
});

it("persists the conversation mode from PATCH and from sends, and inherits it when omitted", async () => {
  const { db, userId, otherUserId, ledger, conversationId } = fixture();
  const app = express();
  app.locals.jwtSecret = jwtSecret;
  app.use(express.json());
  app.use("/api/v1/copilot", createCopilotRoutes({ db, masterKey, eventBus: new ForgeBadgerEventBus() }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1/copilot/conversations`;
    const auth = (id: string) => ({ Authorization: `Bearer ${signJwt({ userId: id, email: "x@example.test" }, jwtSecret)}`, "Content-Type": "application/json" });
    const patch = (id: string, body: unknown, who = userId) => fetch(`${base}/${id}`, { method: "PATCH", headers: auth(who), body: JSON.stringify(body) });

    assert.equal(((await (await fetch(`${base}/${conversationId}`, { headers: auth(userId) })).json()) as { data: { conversation: { mode: string } } }).data.conversation.mode, "execute");
    const planned = await patch(conversationId, { mode: "plan" });
    assert.equal(planned.status, 200);
    assert.equal(((await planned.json()) as { data: { conversation: { mode: string } } }).data.conversation.mode, "plan");
    assert.equal((await patch(conversationId, { mode: "turbo" })).status, 400);
    assert.equal((await patch(conversationId, {})).status, 400);
    assert.equal((await patch(conversationId, { mode: "execute" }, otherUserId)).status, 404);
    assert.equal(ledger.log.getConversation(conversationId)!.mode, "plan");

    // Omitted mode inherits the stored mode; explicit mode persists with admission.
    const inherited = ledger.admit({ userId, conversationId, userText: "inherits" }, 16);
    assert.equal(parseRunInput(ledger.get(inherited)!).mode, "plan");
    // Mode edits are allowed while a run is active; the active run keeps its admitted mode.
    assert.equal((await patch(conversationId, { mode: "execute" })).status, 200);
    assert.equal(parseRunInput(ledger.get(inherited)!).mode, "plan");
    assert.equal((await patch(conversationId, { mode: "plan" })).status, 200);
    ledger.cancel(inherited);
    const explicit = ledger.admit({ userId, conversationId, userText: "explicit", mode: "execute" }, 16);
    assert.equal(ledger.log.getConversation(conversationId)!.mode, "execute");
    assert.equal(parseRunInput(ledger.get(explicit)!).mode, "execute");
    ledger.cancel(explicit);
    const plain = ledger.admit({ userId, conversationId, userText: "plain" }, 16);
    assert.equal(parseRunInput(ledger.get(plain)!).mode, undefined);
    ledger.cancel(plain);
    // Goal and sub-run style admissions never touch the conversation mode.
    const goal = new CopilotGoalStore(db, userId).createGoal({ conversationId, title: "g", spec: "s" });
    ledger.admit({ userId, conversationId, userText: "s", goalId: goal.id, mode: "plan" }, 16);
    assert.equal(ledger.log.getConversation(conversationId)!.mode, "execute");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

it("applies the plan role model only to plan runs without an explicit modelId", () => {
  const { db, userId, ledger, conversationId } = fixture();
  try {
    const providers = new ModelProviderRepository(db, userId, "test");
    const provider = providers.createProviderProfile({ name: "Stub", providerKey: "stub", baseUrl: "https://stub.example",
      authType: "api_key", apiFormat: "openai-compatible", supportedAdapters: ["opencode"] });
    const profile = providers.createModelProfile({ providerProfileId: provider.id, name: "Plan", modelId: "plan-model", capabilities: ["chat"], isDefault: true });
    new CopilotPreferencesRepository(db, userId, "test").set({ planModelId: profile.id });

    const model = (runId: string) => parseRunInput(ledger.get(runId)!).modelId;
    const planned = ledger.admit({ userId, conversationId, userText: "plan it", mode: "plan" }, 16);
    assert.equal(model(planned), profile.id);
    ledger.cancel(planned);
    const explicit = ledger.admit({ userId, conversationId, userText: "plan it", mode: "plan", modelId: "chosen" }, 16);
    assert.equal(model(explicit), "chosen");
    ledger.cancel(explicit);
    const execute = ledger.admit({ userId, conversationId, userText: "do it", mode: "execute" }, 16);
    assert.equal(model(execute), undefined);
  } finally { db.close(); }
});

it("confirms mode proposals: accept execute, accept goal, dismiss, idempotency, conflicts and tenancy", async () => {
  const { db, userId, otherUserId, ledger, conversationId, projectId } = fixture();
  ledger.log.setConversationProject(conversationId, projectId);
  const orchestrator = orchestratorFor(db, (call, request) => {
    if (call === 0) toolCall(request, "p-exec", "propose_mode_switch", { target: "execute", reason: "Plan agreed" });
    if (call === 2) toolCall(request, "p-goal", "propose_mode_switch", { target: "goal", reason: "Long work", title: "Big goal", spec: "Do the big thing" });
    if (call === 4) toolCall(request, "p-bad", "propose_mode_switch", { target: "execute", reason: "wrong mode" });
    return "";
  });
  const app = express();
  app.locals.jwtSecret = jwtSecret;
  app.use(express.json());
  app.use("/api/v1/copilot", createCopilotRoutes({ db, masterKey, eventBus: new ForgeBadgerEventBus() }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1/copilot/conversations`;
    const headers = (id: string) => ({ Authorization: `Bearer ${signJwt({ userId: id, email: "x@example.test" }, jwtSecret)}`, "Content-Type": "application/json" });
    const confirm = (stepId: string, decision: string, who = userId, conversation = conversationId) =>
      fetch(`${base}/${conversation}/mode-proposals/${stepId}/confirm`, { method: "POST", headers: headers(who), body: JSON.stringify({ decision }) });
    const stepOf = (runId: string, callId: string) => ledger.steps(runId).find(step => step.tool_call_id === callId)!.id;

    // Execute proposal from Plan Mode.
    const planRun = await orchestrator.runTurn({ userId, conversationId, projectId, mode: "plan", modelId: "m-1", userText: "Design it" });
    const execStep = stepOf(planRun, "p-exec");
    assert.equal((await confirm(execStep, "maybe")).status, 400);
    assert.equal((await confirm(execStep, "accept", otherUserId)).status, 404);
    assert.equal((await confirm("missing-step", "accept")).status, 404);
    const otherConversation = new CopilotRunLedger(db, userId).log.createConversation().id;
    assert.equal((await confirm(execStep, "accept", userId, otherConversation)).status, 404);

    const accepted = await confirm(execStep, "accept");
    assert.equal(accepted.status, 200);
    const receipt = ((await accepted.json()) as { data: { receipt: { decision: string; target: string; mode: string; runId: string } } }).data.receipt;
    assert.deepEqual({ decision: receipt.decision, target: receipt.target, mode: receipt.mode }, { decision: "accept", target: "execute", mode: "execute" });
    const execInput = parseRunInput(ledger.get(receipt.runId)!);
    assert.equal(execInput.mode, "execute");
    assert.equal(execInput.modelId, "m-1");
    assert.equal(execInput.projectId, projectId);
    assert.match(execInput.userText, /approved switching to Execute Mode/);
    assert.equal(ledger.log.getConversation(conversationId)!.mode, "execute");
    assert.deepEqual(((await (await confirm(execStep, "accept")).json()) as { data: { receipt: unknown } }).data.receipt, receipt);
    assert.equal((await confirm(execStep, "dismiss")).status, 409);
    await orchestrator.cancelRun({ userId, runId: receipt.runId });

    // Goal proposal from Execute Mode: creates one goal bound to the project, no grants, auto-continue.
    const goalRun = await orchestrator.runTurn({ userId, conversationId, projectId, mode: "execute", userText: "Build big thing" });
    assert.deepEqual(((await (await confirm(execStep, "accept")).json()) as { data: { receipt: unknown } }).data.receipt, receipt);
    const goalStep = stepOf(goalRun, "p-goal");
    const messages = ((await (await fetch(`${base}/${conversationId}/messages`, { headers: headers(userId) })).json()) as
      { data: { messages: Array<{ kind: string; toolCallId?: string; modeProposal?: { target: string; receipt?: unknown } }> } }).data.messages;
    assert.deepEqual(messages.find(message => message.kind === "tool_result" && message.toolCallId === "p-goal")!.modeProposal, { target: "goal" });
    const goalAccepted = await confirm(goalStep, "accept");
    assert.equal(goalAccepted.status, 200);
    const goalReceipt = ((await goalAccepted.json()) as { data: { receipt: { goalId: string; runId: string; target: string } } }).data.receipt;
    const goal = new CopilotGoalStore(db, userId).getGoal(goalReceipt.goalId)!;
    assert.deepEqual({ title: goal.title, spec: goal.spec, project: goal.project_id, grants: goal.grants_json, auto: goal.auto_continue },
      { title: "Big goal", spec: "Do the big thing", project: projectId, grants: "[]", auto: 1 });
    assert.equal(parseRunInput(ledger.get(goalReceipt.runId)!).goalId, goal.id);
    const again = ((await (await confirm(goalStep, "accept")).json()) as { data: { receipt: unknown } }).data.receipt;
    assert.deepEqual(again, goalReceipt);
    assert.equal(new CopilotGoalStore(db, userId).listGoals(conversationId).length, 1);
    await orchestrator.cancelRun({ userId, runId: goalReceipt.runId });
    const reread = ((await (await fetch(`${base}/${conversationId}/messages`, { headers: headers(userId) })).json()) as
      { data: { messages: Array<{ kind: string; toolCallId?: string; modeProposal?: { receipt?: unknown } }> } }).data.messages;
    assert.deepEqual(reread.find(message => message.kind === "tool_result" && message.toolCallId === "p-goal")!.modeProposal!.receipt, goalReceipt);

    // Dismiss only records; a busy conversation blocks accept without consuming the receipt.
    const wrongRun = await orchestrator.runTurn({ userId, conversationId, projectId, mode: "plan", userText: "Plan again" });
    const dismissStep = stepOf(wrongRun, "p-bad");
    // A proposal never acts on a project other than the one it was made for.
    ledger.log.setConversationProject(conversationId, null);
    const moved = await confirm(dismissStep, "accept");
    assert.equal(moved.status, 409);
    assert.equal(((await moved.json()) as { details: { code: string } }).details.code, "COPILOT_PLAN_PROJECT_CHANGED");
    ledger.log.setConversationProject(conversationId, projectId);
    const busy =ledger.admit({ userId, conversationId, userText: "busy" }, 16);
    assert.equal((await confirm(dismissStep, "accept")).status, 409);
    ledger.cancel(busy);
    const stale = await confirm(dismissStep, "accept");
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { details: { code: string } }).details.code, "COPILOT_REQUEST_CONFLICT");
    const staleMessages = ((await (await fetch(`${base}/${conversationId}/messages`, { headers: headers(userId) })).json()) as
      { data: { messages: Array<{ toolCallId?: string; modeProposal?: { stale?: boolean } }> } }).data.messages;
    assert.equal(staleMessages.find(message => message.toolCallId === "p-bad" && message.modeProposal)?.modeProposal?.stale, true);
    const dismissed = await confirm(dismissStep, "dismiss");
    assert.deepEqual(((await dismissed.json()) as { data: { receipt: unknown } }).data.receipt, { decision: "dismiss", target: "execute" });
    assert.equal((await confirm(dismissStep, "accept")).status, 409);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

it("rejects mode proposals that do not fit the current mode or project", async () => {
  const { db, userId, ledger, conversationId } = fixture();
  try {
    const orchestrator = orchestratorFor(db, (call, request) => {
      if (call === 0) toolCall(request, "wrong-exec", "propose_mode_switch", { target: "execute", reason: "x" });
      if (call === 2) toolCall(request, "no-project", "propose_mode_switch", { target: "goal", reason: "x", title: "t", spec: "s" });
      return "";
    });
    const first = await orchestrator.runTurn({ userId, conversationId, mode: "execute", userText: "one" });
    const second = await orchestrator.runTurn({ userId, conversationId, mode: "execute", userText: "two" });
    const result = (runId: string) => ledger.log.listRunMessages(runId).find(message => message.kind === "tool_result")?.content ?? "";
    // Not offered at all without a project in Execute Mode: denied at the execution gate.
    assert.match(result(first), /not available in this run/);
    assert.match(result(second), /not available in this run/);
  } finally { db.close(); }
});
