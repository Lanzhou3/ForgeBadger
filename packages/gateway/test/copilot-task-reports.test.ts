import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { configureCliAutonomyAdapters } from '../src/services/adapter-autonomy.js';
import { attachNotificationPersistence } from '../src/services/notification-events.js';
import { attachDispatchSupervisor } from '../src/services/agent/dispatch-supervisor.js';
import { publishTaskReports } from '../src/services/agent/task-reports.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { readTaskDispatchAttempt } from '../src/services/project-manager/task-execution.js';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); configureCliAutonomyAdapters([]); });

function fixture(options: { autonomy?: boolean; cancelAfterDispatch?: boolean; maxSteps?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fb-task-report-'));
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('report@test.dev', 'hash');
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'report fixture', path: root, aiTool: 'codex' });
  if (options.autonomy ?? true) projects.setCopilotAutonomy(project.id, true);
  const pm = new ProjectManagerRepository(db, user.id);
  const eventBus = new ForgeBadgerEventBus();
  attachNotificationPersistence({ db, eventBus });
  const supervisor = attachDispatchSupervisor({ db, eventBus });
  let pane = '› Ask Codex to do anything\nmodel · cwd';
  let enters = 0;
  const manager = new InMemorySessionManager({
    async createSession() {}, async killSession() {}, async listSessions() { return []; }, async hasSession() { return true; },
    async capturePane() { return pane; }, async inspectPane() { return { content: pane, dead: false }; },
    async stageProgrammaticInput(_name, data) { pane = `› ${data}\nmodel · cwd`; },
    async pressEnter() { enters++; pane = '› Ask Codex to do anything\nmodel · cwd'; }
  }, undefined, undefined, { sleep: async () => {} });
  configureCliAutonomyAdapters(['codex']);
  const deps = { db, masterKey: 'test', eventBus, sessionManager: manager, adapterCommandRunner: async (command: string) => ({ exitCode: 0, stdout: `${command} 1.0.0`, stderr: '' }) };
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation();
  let calls = 0;
  const orchestrator = createCopilotOrchestrator({ ...deps, ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }), toolRegistry: createAgentToolRegistry(createPlatformTools()), llm: {
    async stream({ onEvent }) {
      if (calls++ === 0) onEvent({ type: 'tool_call', toolCall: { id: 'create', name: 'pm_create_work_item', arguments: JSON.stringify({ projectId: project.id, title: 'Report origin task', acceptanceCriteria: ['Tests must be independently reviewed.'] }) } });
      else if (calls === 2) {
        const item = pm.listWorkItems(project.id)[0];
        if (item) onEvent({ type: 'tool_call', toolCall: { id: 'dispatch', name: 'pm_execute_task_packet', arguments: JSON.stringify({ projectId: project.id, workItemId: item.id }) } });
      } else if (options.cancelAfterDispatch) {
        const active = db.prepare("SELECT id FROM copilot_runs WHERE conversation_id = ? AND status = 'running'").get(conversation.id) as { id: string };
        assert.ok(active); assert.equal(ledger.cancel(active.id), true);
      }
      return { message: 'Task is dispatched; completion and verification are separate.' };
    },
    async summarize() { return ''; }, async generateTitle() { return ''; }
  } });
  const approveAll = async (runId: string) => {
    for (let guard = 0; guard < 10; guard++) {
      if (ledger.get(runId)?.status !== 'awaiting_approval') return;
      const pending = ledger.log.listPendingActions(runId).find(action => action.status === 'pending' && action.stepId);
      if (!pending) return;
      await orchestrator.resumeAfterApproval({ userId: user.id, runId, actionId: pending.id, approved: true });
    }
  };
  const run = async () => {
    const runId = await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, projectId: project.id, userText: 'Create and dispatch this task, then report completion here.' });
    await approveAll(runId);
    return runId;
  };
  const notify = () => {
    const item = pm.listWorkItems(project.id)[0]!;
    const attempt = readTaskDispatchAttempt(item)!;
    assert.equal(attempt.status, 'dispatched');
    eventBus.emitEvent({ type: 'claude_notification', userId: user.id, projectId: project.id, sessionId: attempt.sessionId, hookEventName: 'Stop', notificationType: 'task_completed', message: 'CLI completed its work' });
    return item;
  };
  const reports = () => db.prepare("SELECT * FROM copilot_messages WHERE user_id = ? AND tool_name = 'pm_task_report'").all(user.id) as Array<{ conversation_id: string; tool_call_id: string; content: string }>;
  cleanups.push(() => { supervisor.stop(); db.close(); rmSync(root, { recursive: true, force: true }); });
  return { db, user, project, pm, deps, ledger, conversation, eventBus, supervisor, run, notify, reports, enterCount: () => enters };
}

describe('Copilot durable task reports', () => {
  it('follows real orchestrator-created origin and receipt after supervisor recovery, then publishes once to the original conversation', async () => {
    const f = fixture();
    const runId = await f.run();
    assert.equal(f.ledger.get(runId)?.status, 'completed');
    assert.equal(f.ledger.log.listPendingActions(runId).filter(action => action.status === 'pending').length, 0);
    assert.equal(f.enterCount(), 1);
    const otherConversation = f.ledger.log.createConversation();
    f.supervisor.stop();
    const item = f.notify();
    assert.equal(f.pm.getWorkItem(f.project.id, item.id)?.status, 'in_progress');
    const restored = attachDispatchSupervisor({ db: f.db, eventBus: f.eventBus });
    restored.stop();
    assert.equal(f.pm.getWorkItem(f.project.id, item.id)?.status, 'ready_for_review');
    publishTaskReports(f.deps, f.user.id);
    publishTaskReports(f.deps, f.user.id);
    const reports = f.reports();
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.conversation_id, f.conversation.id);
    assert.equal(reports[0]?.tool_call_id, readTaskDispatchAttempt(f.pm.getWorkItem(f.project.id, item.id)!)?.id);
    assert.match(reports[0]?.content ?? '', /不代表测试通过/);
    assert.ok(reports[0]?.content.includes('\n会话：'));
    assert.ok(!reports[0]?.content.includes('\\n'));
    assert.equal(f.ledger.log.listMessages(otherConversation.id).length, 0);
    assert.equal(f.enterCount(), 1);
  });

  it('redacts task report text before conversation persistence and run event emission', async () => {
    const f = fixture();
    await f.run();
    const item = f.notify();
    const marker = 'sk-FAKETASKREPORT123456';
    f.db.prepare("UPDATE project_manager_work_items SET details_json=json_set(details_json,'$.taskPacket.attempt.report',?) WHERE user_id=? AND id=?")
      .run(`CLI report ${marker}`, f.user.id, item.id);
    const events: unknown[] = [];
    f.eventBus.on('event', event => events.push(event));
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 1);
    assert.equal(f.reports()[0]?.content.includes(marker), false);
    assert.equal(JSON.stringify(events).includes(marker), false);
    assert.match(f.reports()[0]?.content ?? '', /\[REDACTED\]/);
  });

  it('does not report a cancelled origin even after a confirmed dispatch and persisted completion', async () => {
    const f = fixture({ cancelAfterDispatch: true });
    const runId = await f.run();
    assert.equal(f.ledger.get(runId)?.status, 'cancelled');
    f.notify();
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 0);
    assert.equal(f.enterCount(), 1);
  });

  it('refuses to publish when the project autonomy switch never authorized the copilot dispatch', async () => {
    const f = fixture({ autonomy: false });
    const runId = await f.run();
    assert.equal(f.ledger.get(runId)?.status, 'completed');
    const toolSteps = f.ledger.steps(runId).filter(step => step.kind === 'tool');
    assert.ok(toolSteps.length > 0);
    for (const step of toolSteps) assert.match(step.result_json ?? '', /COPILOT_PROJECT_AUTONOMY_OFF/);
    assert.equal(f.pm.listWorkItems(f.project.id).length, 0);
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 0);
  });

  it('rechecks active user and task semantics before publishing', async () => {
    const f = fixture();
    await f.run();
    const item = f.notify();
    f.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(f.user.id);
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 0);
    f.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(f.user.id);
    f.pm.updateWorkItem(f.project.id, item.id, { acceptanceCriteria: ['A changed requirement must not inherit the old completion.'] });
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 0);
  });

  it('cannot publish a user report through another tenant and does not report without persistent notification evidence', async () => {
    const f = fixture();
    await f.run();
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 0);
    f.notify();
    const other = new UserRepository(f.db).create('other-report@test.dev', 'hash');
    publishTaskReports(f.deps, other.id);
    assert.equal(f.reports().length, 0);
    f.db.prepare('DELETE FROM notifications').run();
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 0);
  });

  it('advances a stable cursor across pumps so invalid older candidates cannot starve later valid reports', async () => {
    const f = fixture();
    await f.run();
    const item = f.notify();
    const attempt = readTaskDispatchAttempt(f.pm.getWorkItem(f.project.id, item.id)!)!;
    // These rows reference a real origin but not its task/session: they must never be published.
    for (let i = 0; i < 205; i++) {
      const stale = f.pm.createWorkItem(f.project.id, { title: `stale ${i}`, details: { taskPacket: { attempt } } });
      f.db.prepare('UPDATE project_manager_work_items SET updated_at = 0 WHERE user_id = ? AND id = ?').run(f.user.id, stale.id);
    }
    publishTaskReports(f.deps, f.user.id);
    publishTaskReports(f.deps, f.user.id);
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 1);
    assert.equal(f.reports()[0]?.tool_call_id, attempt.id);
    assert.match(f.reports()[0]?.content ?? '', /任务进度：Report origin task/);
  });

  it('reports confirmed dispatch completion after the actual originating run exhausts its model-step budget', async () => {
    const f = fixture({ maxSteps: 2 });
    const runId = await f.run();
    assert.equal(f.ledger.get(runId)?.status, 'stopped');
    assert.equal(f.ledger.get(runId)?.stop_reason, 'step_budget_exhausted');
    assert.equal(f.enterCount(), 1);
    f.notify();
    publishTaskReports(f.deps, f.user.id);
    publishTaskReports(f.deps, f.user.id);
    assert.equal(f.reports().length, 1);
    assert.equal(f.reports()[0]?.conversation_id, f.conversation.id);
    assert.equal(f.ledger.get(runId)?.status, 'stopped');
    assert.equal(f.enterCount(), 1);
  });

  for (const [status, reason] of [['stopped', 'operator_stop'], ['indeterminate', 'step_budget_exhausted']] as const) {
    it(`does not report when origin is ${status} with ${reason}`, async () => {
      const f = fixture({ maxSteps: 2 });
      const runId = await f.run();
      assert.equal(f.enterCount(), 1);
      f.notify();
      // Keep the authentic dispatch receipt, vary only the subsequently recorded origin state.
      f.db.prepare('UPDATE copilot_runs SET status = ?, stop_reason = ? WHERE user_id = ? AND id = ?').run(status, reason, f.user.id, runId);
      publishTaskReports(f.deps, f.user.id);
      assert.equal(f.reports().length, 0);
    });
  }
});
