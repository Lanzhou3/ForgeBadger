/** Opt-in real CLI acceptance harness. Supports scripted or configured live Copilot models. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { startAndConnectSessionServer } from '../src/services/session-server-integration.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { createDbSessionRecoveryStore } from '../src/services/db-session-recovery-store.js';
import { configureCliAutonomyAdapters } from '../src/services/adapter-autonomy.js';
import { createGatewayApp } from '../src/server.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { getTaskProgress } from '../src/services/project-manager/task-progress.js';
import { readTaskDispatchAttempt } from '../src/services/project-manager/task-execution.js';
import { redactAgentText } from '../src/services/agent/redaction.js';
import { isProgrammaticComposerReady } from '../src/services/programmatic-terminal-submit.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';

if (process.env.FORGEBADGER_REAL_CLI_TEST !== '1') throw new Error('Explicit opt-in required: FORGEBADGER_REAL_CLI_TEST=1');
const root = mkdtempSync(join(tmpdir(), 'fb-copilot-flow-'));
const projectPath = join(root, 'project');
const statePath = join(root, 'state');
mkdirSync(projectPath); mkdirSync(statePath);
writeFileSync(join(projectPath, 'add.cjs'), 'module.exports = (a, b) => { throw new Error("not implemented"); };\n');
writeFileSync(join(projectPath, 'add.test.cjs'), `const { test } = require('node:test');
const assert = require('node:assert/strict'); const add = require('./add.cjs');
test('positive', () => assert.equal(add(2, 3), 5));
test('negative', () => assert.equal(add(-2, -3), -5));
test('fraction', () => assert.equal(add(0.5, 0.25), 0.75));\n`);
execFileSync('git', ['init', '-q', projectPath]);
const originalTests = readFileSync(join(projectPath, 'add.test.cjs'), 'utf8');
process.env.FORGEBADGER_STATE_DIR = statePath;
const db = new Database(join(statePath, 'test.db'));
migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
const masterKey = randomBytes(32).toString('hex');
const realPlanner = process.env.FORGEBADGER_REAL_COPILOT_TEST === '1';
let sourceDb: Database.Database | undefined;
let liveLlm: AgentLlmClient | undefined;
if (realPlanner) {
  assert.ok(process.env.FORGEBADGER_MASTER_KEY, 'Load the existing Gateway master key via run-with-root-env; never print it.');
  sourceDb = new Database(process.env.FORGEBADGER_DB_PATH ?? join(homedir(), '.forgebadger', 'forgebadger.db'), { readonly: true, fileMustExist: true });
  const owners = sourceDb.prepare('SELECT DISTINCT user_id AS id FROM model_profiles WHERE is_default=1 AND status=\'active\'').all() as Array<{ id: string }>;
  const modelOwner = process.env.FORGEBADGER_TEST_MODEL_USER ?? (owners.length === 1 ? owners[0]!.id : undefined);
  assert.ok(modelOwner, 'Multiple configured model owners; provide FORGEBADGER_TEST_MODEL_USER.');
  // Use the existing configured provider in memory; no credentials are copied to the test database or logs.
  liveLlm = createAgentLlmClient({ modelProviderRepository: new ModelProviderRepository(sourceDb, modelOwner, process.env.FORGEBADGER_MASTER_KEY) });
}
const user = new UserRepository(db).create('flow@example.test', 'not-a-login');
const project = new ProjectRepository(db, user.id).create({ name: 'Isolated CLI acceptance', path: projectPath, aiTool: 'codex' });
const pm = new ProjectManagerRepository(db, user.id);
const log = new CopilotConversationLog(db, user.id);
const conversation = log.createConversation();
const eventBus = new ForgeBadgerEventBus();
const daemon = await startAndConnectSessionServer({ stateDir: statePath });
const inspectPane = daemon.client.inspectPane.bind(daemon.client);
let lastInspection = '';
daemon.client.inspectPane = async (...args) => {
  const pane = await inspectPane(...args);
  if (pane.content !== lastInspection) console.log('INSPECT', redactAgentText(pane.content.trim()).slice(-7000));
  lastInspection = pane.content;
  return pane;
};
const manager = new InMemorySessionManager(daemon.client, createDbSessionRecoveryStore(db, masterKey), eventBus, { db });
configureCliAutonomyAdapters(['codex']);
const app = createGatewayApp({ db, masterKey, jwtSecret: randomBytes(32).toString('hex'),
  sessionManager: manager, sessionServerIpcPath: daemon.ipcPath, eventBus,
  apiKeyStore: new InMemoryApiKeyStore({ masterKey }) });
await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
const address = app.server.address(); assert.ok(address && typeof address !== 'string');
process.env.FORGEBADGER_GATEWAY_URL = `http://127.0.0.1:${address.port}`;
let phase: 'create' | 'dispatch' | 'finish' | 'close' = 'create';
let toolOrdinal = 0;
const llm: AgentLlmClient = {
  async stream(request) {
    let name: string | undefined; let input: unknown;
    const item = pm.listWorkItems(project.id)[0];
    if (phase === 'create') {
      name = 'pm_create_work_item'; input = { projectId: project.id, title: 'Implement add.cjs',
        description: 'Implement addition in add.cjs and run node --test add.test.cjs. Work only in this temporary project. Do not change tests. Do not commit, push, install dependencies or access unrelated files. Report the test result.',
        acceptanceCriteria: ['The original three tests pass with node --test add.test.cjs.', 'Only add.cjs is changed.'] };
      phase = 'dispatch';
    } else if (phase === 'dispatch') {
      assert.ok(item); name = 'pm_execute_task_packet'; input = { projectId: project.id, workItemId: item.id, aiTool: 'codex' }; phase = 'finish';
    } else if (phase === 'close') {
      assert.ok(item); const progress = getTaskProgress({ db, userId: user.id }, project.id, item.id);
      assert.ok(progress.found && progress.attempt && progress.notifications[0]);
      name = 'pm_close_task'; input = { projectId: project.id, workItemId: item.id,
        attemptId: progress.attempt.id, notificationId: progress.notifications[0].id,
        summary: 'CLI completion received. Independent acceptance is recorded by the test harness.' }; phase = 'finish';
    }
    if (name) request.onEvent({ type: 'tool_call', toolCall: { id: `flow-${++toolOrdinal}`, name, arguments: JSON.stringify(input) } });
    else request.onEvent({ type: 'text_delta', text: 'Follow the recorded task progress; CLI completion still requires acceptance verification.' });
    return { message: '' };
  },
  async summarize() { return ''; }, async generateTitle() { return ''; }, async proposeMemory() { return []; },
};
const orchestrator = createCopilotOrchestrator({ db, masterKey, eventBus, sessionManager: manager,
  toolRegistry: createAgentToolRegistry(createPlatformTools()), llm: liveLlm ?? llm });
let lastPane = '';
const terminal = setInterval(() => {
  const session = manager.listSessions()[0];
  if (!session) return;
  void daemon.client.capturePane(session.runtimeSessionName).then(pane => {
    if (pane !== lastPane) { lastPane = pane; console.log('PANE', redactAgentText(pane).slice(-7000)); }
  }).catch(() => {});
}, 3000);
const stdin = createInterface({ input: process.stdin });
stdin.on('line', line => {
  // A human/test operator may answer an inspected native trust prompt. Never disable native approval.
  if (!line.startsWith('input:')) return;
  const session = manager.listSessions()[0];
  if (session) void daemon.client.sendInput(session.runtimeSessionName, JSON.parse(line.slice(6)) as string);
});
console.log(JSON.stringify({ root, pid: process.pid, planner: realPlanner ? 'real-model' : 'scripted', cli: 'real-codex', gateway: process.env.FORGEBADGER_GATEWAY_URL }));
try {
  const run = await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, projectId: project.id,
    userText: `在当前临时项目 ${project.id} 创建且执行一个任务：仅实现 add.cjs 的加法函数，运行 node --test add.test.cjs，原有3条测试必须通过。不要修改测试、提交、安装依赖或访问其他项目。用 Codex CLI，通过 pm_execute_task_packet 派发；用 pm_get_task_progress 跟进、pm_close_task 收尾并汇报。已有当前项目上下文，不需要创建项目。CLI 若尚未就绪，保留 not_sent 结果，待原生信任确认后再续派；结果未知禁止重试。不要将CLI完成当成独立验收通过。` });
  console.log('RUN', log.getRun(run)?.status);
  assert.ok(['completed', 'stopped'].includes(log.getRun(run)?.status ?? ''));
  assert.equal(log.listPendingActions(run).length, 0);
  const item = pm.listWorkItems(project.id)[0]!;
  console.log('INITIAL', JSON.stringify(getTaskProgress({ db, userId: user.id }, project.id, item.id)));
  let retries = 0;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const current = pm.getWorkItem(project.id, item.id)!;
    const attempt = readTaskDispatchAttempt(current);
    const runtime = manager.listSessions()[0];
    const pane = runtime ? await daemon.client.inspectPane(runtime.runtimeSessionName).catch(() => undefined) : undefined;
    if (attempt?.status === 'not_sent' && retries < 2 && pane && isProgrammaticComposerReady('codex', pane.content)) {
      phase = 'dispatch'; retries++;
      await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, projectId: project.id, userText: 'Retry only the not-sent task after native CLI readiness.' });
    }
    if (current.status === 'ready_for_review') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(pm.getWorkItem(project.id, item.id)?.status, 'ready_for_review');
  phase = 'close';
  const closing = await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, projectId: project.id, userText: 'Record the evidence-backed task closeout.' });
  assert.equal(log.getRun(closing)?.status, 'completed');
  assert.equal(log.listPendingActions(closing).length, 0);
  assert.ok(db.prepare(`SELECT 1 FROM platform_action_intents i JOIN platform_action_receipts r
    ON r.user_id=i.user_id AND r.intent_id=i.id WHERE i.user_id=? AND i.command_id='pm.task.close'
    AND r.outcome='confirmed'`).get(user.id), 'Closeout must be backed by an actual confirmed platform receipt');
  assert.equal(readFileSync(join(projectPath, 'add.test.cjs'), 'utf8'), originalTests);
  const independentTests = execFileSync(process.execPath, ['--test', 'add.test.cjs'], { cwd: projectPath, encoding: 'utf8' });
  await new Promise(resolve => setTimeout(resolve, 6000));
  const reports = log.listMessages(conversation.id).filter(message => message.toolName === 'pm_task_report');
  assert.equal(reports.length, 1);
  const evidence = { root, planner: realPlanner ? 'real-model' : 'scripted', cli: 'real-codex', taskId: item.id,
    closeoutReceiptConfirmed: true,
    status: pm.getWorkItem(project.id, item.id)?.status, pendingApprovals: log.listPendingActions(run).length + log.listPendingActions(closing).length,
    progress: getTaskProgress({ db, userId: user.id }, project.id, item.id), reports, independentTests };
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log('ACCEPTED', JSON.stringify({ root, planner: evidence.planner, status: evidence.status, pendingApprovals: evidence.pendingApprovals, reports: reports.length, independentTests }));
} finally {
  clearInterval(terminal); stdin.close();
  await daemon.stop(); // Only the dedicated daemon created above; never the user's normal daemon.
  await app.close();
  sourceDb?.close();
}
