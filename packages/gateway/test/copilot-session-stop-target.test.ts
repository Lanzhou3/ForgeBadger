import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { InMemorySessionManager, createFallbackLaunchPlan } from '../src/services/session-manager.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createSessionTools } from '../src/services/agent/tools/sessions.js';
import { createSessionCommands } from '../src/services/platform-commands/session-commands.js';
import { PlatformActions } from '../src/services/platform-commands/actions.js';
import { executeAgentTool, createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformManagementTools } from '../src/services/agent/tools/platform-management.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';

async function fixture(t: TestContext, isolated = true) {
  const db = new Database(':memory:'); t.after(() => db.close());
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('stop-target@test.dev', 'hash');
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'ForgeBadger', path: '/tmp', aiTool: 'codex' });
  projects.setCopilotAutonomy(project.id, true);
  const sessions = new SessionRepository(db, user.id);
  const panes = new Map<string, string>(); const killed: string[] = []; const entered: string[] = [];
  let inputGate = Promise.resolve(); let staged!: () => void;
  const inputStaged = new Promise<void>(resolve => { staged = resolve; });
  const manager = new InMemorySessionManager({ async createSession() {}, async listSessions() { return [...panes.keys()]; },
    async hasSession(name) { return panes.has(name); }, async killSession(name) { killed.push(name); panes.delete(name); },
    async capturePane(name) { return panes.get(name) ?? ''; },
    async inspectPane(name) { return { content: panes.get(name) ?? '', dead: !panes.has(name) }; },
    async stageProgrammaticInput(name, data) { panes.set(name, `› ${data}\n\nGPT-6 high · /tmp · task`); staged(); },
    async pressEnter(name) { entered.push(name); }
  }, undefined, undefined, { sleep: async () => inputGate });
  const ledger = new CopilotRunLedger(db, user.id); const conversation = ledger.log.createConversation('Stop target');
  const runId = ledger.admit({ userId: user.id, conversationId: conversation.id, userText: '停止检查浏览器通知问题的会话' }, 10);
  const context = { db, userId: user.id, masterKey: 'fixture', sessionManager: manager, runId, conversationId: conversation.id };
  async function create(title: string) {
    const session = sessions.create({ projectId: project.id, name: 'ForgeBadger', aiTool: 'codex', workingDir: '/tmp' });
    const live = await manager.createSession({ userId: user.id, sessionId: session.id,
      launchPlan: { command: 'codex', args: isolated ? ['--no-daemon'] : [], cwd: '/tmp', env: {}, secretEnvNames: [], credentialMode: 'host_environment' } });
    sessions.update(session.id, { status: 'running', runtimeSessionName: live.runtimeSessionName, attachToken: live.attachToken });
    panes.set(live.runtimeSessionName, `Working on ${title}\nGPT-6 high · /tmp · ${title} · Main [default]\n← for agents · ? for shortcuts`);
    return sessions.getById(session.id)!;
  }
  async function observe(sessionId: string) {
    const input = { sessionId, maxLines: 80 };
    const step = ledger.addStep(runId, { kind: 'tool', toolName: 'get_session_output', inputJson: JSON.stringify(input), effect: 'read' });
    const execution = await executeAgentTool(createSessionTools().find(tool => tool.name === 'get_session_output')!, input, { ...context, stepId: step.id });
    assert.equal(execution.ok, true); const output = execution.output;
    ledger.completeStep(step.id, JSON.stringify(output));
    return { step, output: output as { sessionId: string; target: { taskTitle: string; observationId: string; runtimeRevision: string } } };
  }
  function actions() {
    const step = ledger.addStep(runId, { kind: 'tool', toolName: 'stop_session', inputJson: '{}', effect: 'write' });
    return new PlatformActions({ ...context, actionOrigin: { kind: 'copilot', runId, stepId: step.id } }, new Map(createSessionCommands().map(c => [c.id, c])));
  }
  return { db, user, project, sessions, panes, manager, ledger, runId, context, killed, create, observe, actions, entered, inputStaged,
    pauseInput() { let resume!: () => void; inputGate = new Promise<void>(r => { resume = r; }); return resume; } };
}

test('session output carries its own identity and server-observed task title', async t => {
  const f = await fixture(t); const session = await f.create('检查Copilot架构与实现不足');
  const { step, output } = await f.observe(session.id);
  assert.equal(output.sessionId, session.id);
  assert.equal(output.target.observationId, step.id);
  assert.equal(output.target.taskTitle, '检查Copilot架构与实现不足');
  assert.equal(JSON.stringify(output).includes(session.attachToken), false);
});

test('swapped task titles or observation/session IDs cannot create a stop intent', async t => {
  const f = await fixture(t); const arch = await f.create('检查Copilot架构与实现不足'); const browser = await f.create('检查浏览器通知问题');
  const observed = await f.observe(arch.id); const actions = f.actions();
  assert.throws(() => actions.preview({ commandId: 'session.stop', idempotencyKey: 'wrong-title', input: {
    sessionId: arch.id, observationId: observed.step.id, expectedTitle: '检查浏览器通知问题' } }), /TARGET.*MISMATCH/);
  assert.throws(() => actions.preview({ commandId: 'session.stop', idempotencyKey: 'wrong-id', input: {
    sessionId: browser.id, observationId: observed.step.id, expectedTitle: '检查Copilot架构与实现不足' } }), /TARGET.*MISMATCH/);
  assert.deepEqual(f.killed, []);
});

test('bare Copilot stop IDs are rejected while owner terminal stop stays compatible', async t => {
  const f = await fixture(t); const session = await f.create('task');
  assert.throws(() => f.actions().preview({ commandId: 'session.stop', idempotencyKey: 'bare', input: { sessionId: session.id } }), /OBSERVATION_REQUIRED/);
  const owner = new PlatformActions(f.context, new Map(createSessionCommands().map(c => [c.id, c])));
  await owner.executeOwner('session.stop', { sessionId: session.id }, 'owner-stop');
  assert.equal(f.killed.length, 1);
});

test('restart invalidates an observed target before any stop effect', async t => {
  const f = await fixture(t); const session = await f.create('task'); const observed = await f.observe(session.id);
  const actions = f.actions(); const intent = actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
    sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' } });
  f.sessions.update(session.id, { attachToken: 'new-runtime-attach-token' });
  await assert.rejects(actions.execute(intent.id), /TARGET_STALE|Stale resource/);
  assert.deepEqual(f.killed, []);
});

test('a changed task title after approval is rejected without stopping its terminal', async t => {
  const f = await fixture(t); const session = await f.create('task'); const observed = await f.observe(session.id);
  const actions = f.actions(); const intent = actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
    sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' } });
  f.panes.set(session.runtimeSessionName!, 'GPT-6 high · /tmp · another task');
  await assert.rejects(actions.execute(intent.id), /TARGET_STALE/);
  assert.deepEqual(f.killed, []);
});

test('legacy Codex daemon sessions cannot be reported as stopped by Copilot', async t => {
  const f = await fixture(t, false); const session = await f.create('task'); const observed = await f.observe(session.id);
  const actions = f.actions();
  await assert.rejects(async () => {
    const intent = actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
      sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' } });
    await actions.execute(intent.id);
  }, /EXECUTION_SCOPE_UNVERIFIED/);
  assert.deepEqual(f.killed, []);
});

function actionKey(actions: PlatformActions): string {
  const origin = actions.context.actionOrigin;
  assert.equal(origin?.kind, 'copilot');
  return origin?.kind === 'copilot' ? origin.stepId : '';
}

test('fresh exact target stops only its own terminal and persists the approval identity', async t => {
  const f = await fixture(t); const arch = await f.create('检查Copilot架构与实现不足'); const browser = await f.create('检查浏览器通知问题');
  const observed = await f.observe(browser.id); const actions = f.actions();
  const intent = actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
    sessionId: browser.id, observationId: observed.step.id, expectedTitle: '检查浏览器通知问题' } });
  assert.equal(JSON.parse(intent.resources_json).stopTarget.taskTitle, '检查浏览器通知问题');
  const receipt = await actions.execute(intent.id);
  assert.equal(receipt.outcome, 'confirmed');
  assert.equal((receipt.result as { stopScope: string }).stopScope, 'terminal_process_group');
  assert.deepEqual(f.killed, [browser.runtimeSessionName]);
  assert.equal(f.sessions.getById(arch.id)?.status, 'running');
  assert.deepEqual(await actions.execute(intent.id), receipt);
  assert.equal(f.killed.length, 1);
});

test('another conversation or tenant cannot reuse a target observation', async t => {
  const f = await fixture(t); const session = await f.create('task'); const observed = await f.observe(session.id);
  const conversation = f.ledger.log.createConversation('Other');
  const runId = f.ledger.admit({ userId: f.user.id, conversationId: conversation.id, userText: 'stop' }, 10);
  const step = f.ledger.addStep(runId, { kind: 'tool', toolName: 'stop_session', effect: 'write' });
  const commands = new Map(createSessionCommands().map(c => [c.id, c]));
  const other = new PlatformActions({ ...f.context, actionOrigin: { kind: 'copilot', runId, stepId: step.id } }, commands);
  const input = { sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' };
  assert.throws(() => other.preview({ commandId: 'session.stop', idempotencyKey: step.id, input }), /TARGET_STALE/);
  const user = new UserRepository(f.db).create('other-target@test.dev', 'hash');
  const tenant = new PlatformActions({ ...f.context, userId: user.id }, commands);
  assert.throws(() => tenant.preview({ commandId: 'session.stop', idempotencyKey: 'other-tenant', input }), /not found/i);
  assert.deepEqual(f.killed, []);
});

test('expired, unavailable and truncated observations fail closed', async t => {
  const f = await fixture(t); const session = await f.create('task');
  for (const mode of ['expired', 'cached', 'truncated'] as const) {
    const observed = await f.observe(session.id); const actions = f.actions();
    if (mode === 'expired') f.db.prepare('UPDATE copilot_run_steps SET completed_at=1 WHERE id=?').run(observed.step.id);
    else f.ledger.completeStep(observed.step.id, JSON.stringify(mode === 'cached' ? { ...observed.output, live: false } : { truncated: true }));
    assert.throws(() => actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
      sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' } }), /TARGET_STALE/);
  }
  assert.deepEqual(f.killed, []);
});

test('large terminal output retains usable identity through the real output cap', async t => {
  const f = await fixture(t); const session = await f.create('检查浏览器通知问题');
  f.panes.set(session.runtimeSessionName!, '巨量输出'.repeat(30000) + '\nGPT-6 high · /tmp · 检查浏览器通知问题');
  const observed = await f.observe(session.id); const actions = f.actions();
  assert.equal(observed.output.target.taskTitle, '检查浏览器通知问题');
  const intent = actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
    sessionId: session.id, observationId: observed.step.id, expectedTitle: observed.output.target.taskTitle } });
  await actions.execute(intent.id); assert.equal(f.killed.length, 1);
});

test('restoring a legacy bare stop intent through the owner executor does not bypass Copilot validation', async t => {
  const f = await fixture(t); const session = await f.create('task'); const observed = await f.observe(session.id); const actions = f.actions();
  const intent = actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
    sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' } });
  // Seed the persisted input of a pre-upgrade Copilot approval.
  f.db.prepare('UPDATE platform_action_intents SET input_json=? WHERE id=?').run(JSON.stringify({ sessionId: session.id }), intent.id);
  const owner = new PlatformActions(f.context, new Map(createSessionCommands().map(c => [c.id, c])));
  await assert.rejects(owner.execute(intent.id), /OBSERVATION_REQUIRED/);
  assert.deepEqual(f.killed, []);
});

test('owner stop of legacy Codex explicitly reports external execution as unverified', async t => {
  const f = await fixture(t, false); const session = await f.create('task');
  const owner = new PlatformActions(f.context, new Map(createSessionCommands().map(c => [c.id, c])));
  const result = await owner.executeOwner('session.stop', { sessionId: session.id }, 'legacy-owner') as { terminalStopped: boolean; externalExecutionStopped: null; warning: string };
  assert.equal(result.terminalStopped, true); assert.equal(result.externalExecutionStopped, null);
  assert.match(result.warning, /CODEX_EXTERNAL_RUNTIME_UNVERIFIED/);
});

for (const mode of ['fallback', 'option-after-separator'] as const) test(`${mode} is not proof of isolated Codex execution`, async t => {
  const f = await fixture(t); const session = await f.create('task'); const live = f.manager.getSession(session.id)!;
  if (mode === 'fallback') live.launchPlan = createFallbackLaunchPlan('/tmp', session.id);
  else live.launchPlan.args = ['--', '--no-daemon'];
  const observed = await f.observe(session.id); const actions = f.actions();
  assert.throws(() => actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
    sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' } }), /EXECUTION_SCOPE_UNVERIFIED/);
  assert.deepEqual(f.killed, []);
});

test('a rejected legacy stop does not cancel a pending programmatic submission', async t => {
  const f = await fixture(t, false); const session = await f.create('task');
  f.panes.set(session.runtimeSessionName!, '› Ask Codex to do anything\n\nGPT-6 high · /tmp · task');
  const observed = await f.observe(session.id); const resume = f.pauseInput();
  const submission = f.manager.submitProgrammaticTask(session.id, { adapter: 'codex', message: 'hello' });
  try {
    await f.inputStaged;
    const command = createSessionCommands().find(c => c.id === 'session.stop')!;
    await assert.rejects(async () => command.execute({ ...f.context, actionOrigin: { kind: 'copilot', runId: f.runId, stepId: observed.step.id } }, {
      sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' }), /EXECUTION_SCOPE_UNVERIFIED/);
  } finally { resume(); }
  await submission; assert.deepEqual(f.entered, [session.runtimeSessionName]); assert.deepEqual(f.killed, []);
});

test('a restart while stop is waiting on the lifecycle mutex cannot stop the replacement', async t => {
  const f = await fixture(t); const session = await f.create('task'); const observed = await f.observe(session.id); const actions = f.actions();
  const intent = actions.preview({ commandId: 'session.stop', idempotencyKey: actionKey(actions), input: {
    sessionId: session.id, observationId: observed.step.id, expectedTitle: 'task' } });
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const lock = f.manager.runExclusive(session.id, () => gate);
  const stopped = actions.execute(intent.id);
  for (let i = 0; i < 50 && actions.intents.get(intent.id)?.status !== 'executing'; i++) await new Promise(r => setTimeout(r, 1));
  f.sessions.update(session.id, { attachToken: 'replacement-runtime' }); release(); await lock;
  await assert.rejects(stopped, /TARGET_STALE/);
  assert.deepEqual(f.killed, []); assert.equal(f.sessions.getById(session.id)?.status, 'running');
});

test('the real orchestrator keeps the observed target through approval and resume', async t => {
  const f = await fixture(t); const session = await f.create('检查浏览器通知问题');
  const conversation = f.ledger.log.createConversation('Approval roundtrip'); let round = 0;
  const llm: AgentLlmClient = {
    async stream(request) {
      if (round++ === 0) request.onEvent({ type: 'tool_call', toolCall: { id: 'read-target', name: 'get_session_output', arguments: JSON.stringify({ sessionId: session.id }) } });
      else if (round === 2) {
        const observation = request.messages.find(m => m.role === 'tool' && m.toolCallId === 'read-target');
        assert.ok(observation); const target = JSON.parse(observation.content).target;
        request.onEvent({ type: 'tool_call', toolCall: { id: 'stop-target', name: 'stop_session', arguments: JSON.stringify({ sessionId: session.id, observationId: target.observationId, expectedTitle: target.taskTitle }) } });
      } else request.onEvent({ type: 'text_delta', text: 'Terminal process group stopped.' });
      return { message: '' };
    }, async summarize() { return ''; }, async generateTitle() { return ''; }, async proposeMemory() { return []; }
  };
  const create = () => createCopilotOrchestrator({ db: f.db, masterKey: 'x'.repeat(32), sessionManager: f.manager, llm,
    toolRegistry: createAgentToolRegistry([...createSessionTools(), ...createPlatformManagementTools()]), eventBus: new ForgeBadgerEventBus() });
  const runId = await create().runTurn({ userId: f.user.id, conversationId: conversation.id, userText: '停止检查浏览器通知问题的会话' });
  assert.equal(f.ledger.get(runId)?.status, 'awaiting_approval'); assert.deepEqual(f.killed, []);
  const pending = f.ledger.log.listPendingActions(runId)[0]!; const intent = f.db.prepare('SELECT resources_json FROM platform_action_intents WHERE idempotency_key=?').get(pending.stepId) as { resources_json: string };
  assert.equal(JSON.parse(intent.resources_json).stopTarget.taskTitle, '检查浏览器通知问题');
  await create().resumeAfterApproval({ userId: f.user.id, runId, actionId: pending.id, approved: true });
  assert.equal(f.ledger.get(runId)?.status, 'completed'); assert.deepEqual(f.killed, [session.runtimeSessionName]);
});
