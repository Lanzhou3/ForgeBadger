import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { PlatformActionRepository, type ActionIntent, type ActionReceipt } from '../src/db/repositories/platform-action-repository.js';
import { patchTaskAttempt, taskPromptDigest, taskRuntimeIdentity, type TaskDispatchAttempt } from '../src/services/project-manager/task-execution.js';
import { getTaskProgress } from '../src/services/project-manager/task-progress.js';
import { buildTaskPacket, withTaskPacketSessionLink } from '../src/services/project-manager/task-packets.js';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const db = new Database(':memory:'); databases.push(db);
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('guidance@test.dev', 'hash');
  const project = new ProjectRepository(db, user.id).create({ name: 'Guidance', path: '/tmp/pm-guidance', aiTool: 'codex' });
  const pm = new ProjectManagerRepository(db, user.id);
  const item = pm.createWorkItem(project.id, { title: 'Legacy task' });
  const session = new SessionRepository(db, user.id).create({ projectId: project.id, name: 'Existing CLI', aiTool: 'codex', workingDir: project.path });
  pm.updateWorkItem(project.id, item.id, { details: withTaskPacketSessionLink(item.details, session, project) });
  const ctx = { db, userId: user.id };
  const progress = () => {
    const result = getTaskProgress(ctx, project.id, item.id);
    assert.equal(result.found, true);
    if (!result.found) throw new Error('missing fixture');
    return result;
  };
  const intent = (options: { status?: ActionIntent['status']; outcome?: ActionReceipt['outcome']; userId?: string; command?: string; input?: unknown; result?: unknown } = {}) => {
    const actions = new PlatformActionRepository(db, options.userId ?? user.id);
    const row = actions.create({ actor_user_id: options.userId ?? user.id, grant_id: null, grant_revision: null, authority: 'owner_action', command_id: options.command ?? 'pm.task.execute', input_json: JSON.stringify(options.input ?? { projectId: project.id, workItemId: item.id }), digest: 'fixture', resources_json: '{}', policy_version: 1, expires_at: Date.now() + 100_000, idempotency_key: randomUUID(), status: options.outcome ? 'executing' : options.status ?? 'executing' });
    if (options.outcome) actions.finish(row.id, options.outcome, options.result ?? { error: 'legacy fixture', privateDetail: 'must not be returned' });
    return row.id;
  };
  const saveAttempt = (status: TaskDispatchAttempt['status'], options: { error?: string; manual?: boolean } = {}) => {
    const id = randomUUID();
    const originIntentId = intent({ outcome: 'confirmed', result: status === 'not_sent'
      ? { executionStatus: 'incomplete', attemptId: id, error: options.error ?? 'PROGRAMMATIC_SUBMIT_NOT_READY', dispatch: { status: 'not_sent' } }
      : { executionStatus: 'dispatched', attemptId: id, session: { id: session.id }, dispatch: { dispatched: true } } });
    const fresh = pm.getWorkItem(project.id, item.id)!;
    const attempt: TaskDispatchAttempt = { id, originIntentId, sessionId: session.id, status,
      notificationBaseline: 0, createdAt: new Date().toISOString(), runtimeIdentity: taskRuntimeIdentity(session),
      promptDigest: taskPromptDigest(buildTaskPacket({ project, workItem: fresh, session }).prompt),
      ...(options.manual ? { manualInterventionAt: new Date().toISOString() } : {}) };
    patchTaskAttempt(ctx, project.id, item.id, attempt);
    return attempt;
  };
  return { db, user, project, item, session, pm, ctx, progress, intent, saveAttempt };
}

describe('PM missing-attempt progress guidance', () => {
  it('reports insufficient dispatch evidence instead of instructing a legacy task to wait', () => {
    const f = fixture();
    const result = f.progress();
    assert.equal(result.attempt, null);
    assert.equal(result.dispatchStatus, 'unverified');
    assert.equal(result.evidenceStatus, 'missing_attempt');
    assert.match(result.nextAction, /cannot establish whether.*dispatched/i);
    assert.match(result.nextAction, /inspect|check/i);
    assert.match(result.nextAction, /automatic replay is prohibited/i);
    assert.doesNotMatch(result.nextAction, /wait for persisted CLI evidence|never dispatched|not yet dispatched/i);
  });

  it('highlights unknown historical delivery and does not let a newer no-effect intent mask it', () => {
    const f = fixture();
    const unknown = f.intent({ outcome: 'unknown' });
    f.intent({ outcome: 'no_effect' });
    const before = (f.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const result = f.progress();
    assert.equal(result.dispatchStatus, 'unknown');
    assert.equal(result.evidenceStatus, 'missing_attempt');
    assert.deepEqual(result.dispatchHistory, { intentId: unknown, status: 'indeterminate', receiptOutcome: 'unknown' });
    assert.match(result.nextAction, /automatic replay is prohibited/i);
    assert.ok(!JSON.stringify(result).includes('must not be returned'));
    assert.equal((f.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n, before);
  });

  it('reports an executing legacy task intent as in flight rather than suggesting a new dispatch', () => {
    const f = fixture();
    const executing = f.intent();
    const result = f.progress();
    assert.equal(result.dispatchStatus, 'in_flight');
    assert.equal(result.dispatchHistory?.intentId, executing);
    assert.match(result.nextAction, /inspect.*intent|intent.*inspect/i);
    assert.match(result.nextAction, /automatic replay is prohibited/i);
  });

  it('also inspects unknown generic dispatch history for the currently linked session', () => {
    const f = fixture();
    const unknown = f.intent({ command: 'session.dispatch', input: { sessionId: f.session.id, message: 'legacy task prompt' }, outcome: 'unknown' });
    const result = f.progress();
    assert.equal(result.dispatchStatus, 'unknown');
    assert.equal(result.dispatchHistory?.intentId, unknown);
    assert.ok(!JSON.stringify(result).includes('legacy task prompt'));
  });

  it('does not infer a reliable current attempt from a legacy confirmed receipt or dispatchedAt marker', () => {
    const f = fixture();
    f.intent({ outcome: 'confirmed' });
    const item = f.pm.getWorkItem(f.project.id, f.item.id)!;
    f.pm.updateWorkItem(f.project.id, f.item.id, { details: { ...item.details, taskPacket: { ...(item.details.taskPacket as object), dispatchedAt: new Date().toISOString() } } });
    const result = f.progress();
    assert.equal(result.dispatchStatus, 'unverified');
    assert.equal(result.evidenceStatus, 'missing_attempt');
    assert.match(result.nextAction, /automatic replay is prohibited/i);
  });

  it('ignores other tenants and unrelated task/session histories without leaking their references', () => {
    const f = fixture();
    const other = new UserRepository(f.db).create('other-guidance@test.dev', 'hash');
    const foreign = f.intent({ userId: other.id, outcome: 'unknown' });
    f.intent({ input: { projectId: f.project.id, workItemId: 'unrelated' }, outcome: 'unknown' });
    f.intent({ command: 'session.dispatch', input: { sessionId: 'unrelated', message: 'private' }, outcome: 'unknown' });
    const result = f.progress();
    assert.equal(result.dispatchStatus, 'unverified');
    assert.equal(result.dispatchHistory, null);
    assert.ok(!JSON.stringify(result).includes(foreign));
    assert.deepEqual(getTaskProgress({ db: f.db, userId: other.id }, f.project.id, f.item.id), { found: false });
  });
  it('keeps ordinary not-sent readiness recovery distinct from a native owner trust decision', () => {
    const f = fixture();
    f.saveAttempt('not_sent');
    const ready = f.progress();
    assert.equal(ready.dispatchStatus, 'not_sent');
    assert.match(ready.nextAction, /Check session readiness.*new intent/);
    f.saveAttempt('not_sent', { error: 'PROGRAMMATIC_SUBMIT_NATIVE_APPROVAL_REQUIRED' });
    const approval = f.progress();
    assert.equal(approval.dispatchStatus, 'not_sent');
    assert.match(approval.nextAction, /Stop dispatch attempts.*owner trust or permission decision/);
    assert.doesNotMatch(approval.nextAction, /Check session readiness/);
  });

  it('preserves verified dispatch, review and manual-intervention guidance without writing state', () => {
    const f = fixture();
    f.saveAttempt('dispatched');
    f.pm.updateWorkItemStatus(f.project.id, f.item.id, { status: 'in_progress' });
    const dispatched = f.progress();
    assert.equal(dispatched.dispatchStatus, 'confirmed');
    assert.equal(dispatched.evidenceStatus, 'awaiting_notification');
    assert.match(dispatched.nextAction, /wait for persisted CLI evidence/);
    f.pm.updateWorkItemStatus(f.project.id, f.item.id, { status: 'ready_for_review' });
    assert.match(f.progress().nextAction, /independently verify acceptance/);
    f.saveAttempt('dispatched', { manual: true });
    const before = (f.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const manual = f.progress();
    assert.equal(manual.evidenceStatus, 'manual_intervention');
    assert.match(manual.nextAction, /Manual input or takeover/);
    assert.equal((f.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n, before);
  });

  it('does not wait for automatically attributable evidence after task semantics change', () => {
    const f = fixture();
    f.saveAttempt('dispatched');
    f.pm.updateWorkItem(f.project.id, f.item.id, { title: 'Changed task' });
    const result = f.progress();
    assert.equal(result.dispatchStatus, 'unverified');
    assert.equal(result.evidenceStatus, 'unverified');
    assert.match(result.nextAction, /automatic replay is prohibited/i);
    assert.doesNotMatch(result.nextAction, /wait for persisted/);
  });

  it('does not let a newer not-sent attempt erase an unresolved older unknown dispatch', () => {
    const f = fixture();
    const unknown = f.intent({ outcome: 'unknown' });
    f.saveAttempt('not_sent');
    const result = f.progress();
    assert.equal(result.dispatchStatus, 'unknown');
    assert.equal(result.dispatchHistory?.intentId, unknown);
    assert.match(result.nextAction, /automatic replay is prohibited/i);
    assert.doesNotMatch(result.nextAction, /execute the remaining dispatch/);
  });

  it('treats an unknown receipt for the current not-sent attempt as unresolved instead of recommending retry', () => {
    const f = fixture();
    const attempt = f.saveAttempt('not_sent');
    f.db.prepare("UPDATE platform_action_receipts SET outcome='unknown' WHERE user_id=? AND intent_id=?").run(f.user.id, attempt.originIntentId);
    const result = f.progress();
    assert.equal(result.dispatchStatus, 'unknown');
    assert.equal(result.dispatchHistory?.intentId, attempt.originIntentId);
    assert.match(result.nextAction, /automatic replay is prohibited/i);
  });

});
