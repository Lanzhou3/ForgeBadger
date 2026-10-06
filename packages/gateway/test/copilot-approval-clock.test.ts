import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { CopilotRunLedger, type Claim } from '../src/services/agent/run-ledger.js';
import { RunGovernance } from '../src/services/agent/run-governance.js';

function fixture(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
  const userId = new UserRepository(db).create('approval-clock@test.dev', 'hash').id;
  const ledger = new CopilotRunLedger(db, userId);
  const conversationId = ledger.log.createConversation().id;
  const runId = ledger.admit({ userId, conversationId, userText: 'bounded task' }, 16);
  db.prepare('UPDATE copilot_runs SET max_duration_ms=60000 WHERE id=?').run(runId);
  const claim = ledger.claim(runId, 'clock-worker', 30_000)!;
  return { db, ledger, userId, runId, claim, meter: new RunGovernance(db, userId, runId) };
}

function wait(ledger: CopilotRunLedger, claim: Claim, toolCallId: string) {
  const step = ledger.addStep(claim.runId, { kind: 'tool', toolName: 'write_fixture', toolCallId, inputJson: '{}' });
  ledger.waitApproval(claim, step);
  return ledger.log.listPendingActions(claim.runId).find(action => action.stepId === step.id)!;
}

function clockRow(db: Database.Database, runId: string) {
  return db.prepare('SELECT started_at,approval_wait_ms,approval_wait_started_at FROM copilot_runs WHERE id=?')
    .get(runId) as { started_at: number; approval_wait_ms: number; approval_wait_started_at: number | null };
}

it('persists approval-only pause across database reopen without resetting original started_at', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const root = mkdtempSync(join(tmpdir(), 'fb-approval-clock-'));
  const filename = join(root, 'state.db');
  const f = fixture(filename);
  const startedAt = now;
  let restored: Database.Database | undefined;
  try {
    now += 20_000;
    const action = wait(f.ledger, f.claim, 'pause-1');
    now += 40 * 60_000;
    assert.doesNotThrow(() => f.meter.check());
    assert.equal(f.meter.remainingDurationMs(), 40_000);
    f.db.close();
    restored = new Database(filename);
    const ledger = new CopilotRunLedger(restored, f.userId);
    const meter = new RunGovernance(restored, f.userId, f.runId);
    assert.equal(meter.remainingDurationMs(), 40_000);
    assert.equal(ledger.decide(f.runId, action.id, true), true);
    assert.deepEqual(clockRow(restored, f.runId), { started_at: startedAt, approval_wait_ms: 40 * 60_000, approval_wait_started_at: null });
    ledger.claim(f.runId, 'reopened-worker', 60_000);
    now += 39_999;
    assert.doesNotThrow(() => meter.check());
    now++;
    assert.throws(() => meter.check(), /elapsed-time budget/);
    assert.equal(meter.remainingDurationMs(), 0);
    assert.deepEqual(restored.pragma('foreign_key_check'), []);
  } finally {
    if (f.db.open) f.db.close();
    restored?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('accumulates multiple waits once and charges ordinary pending downtime after each decision', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const first = wait(f.ledger, f.claim, 'first');
    now += 120_000;
    assert.equal(f.ledger.decide(f.runId, first.id, true), true);
    const firstClock = clockRow(f.db, f.runId);
    now += 10_000;
    assert.equal(f.ledger.decide(f.runId, first.id, true), false);
    assert.deepEqual(clockRow(f.db, f.runId), firstClock);
    const secondClaim = f.ledger.claim(f.runId, 'second-worker', 30_000)!;
    const second = wait(f.ledger, secondClaim, 'second');
    now += 180_000;
    assert.equal(f.ledger.decide(f.runId, second.id, false), true);
    assert.equal(clockRow(f.db, f.runId).approval_wait_ms, 300_000);
    assert.equal(f.meter.remainingDurationMs(), 50_000);
    now += 50_000;
    assert.throws(() => f.meter.check(), /elapsed-time budget/);
  } finally { f.db.close(); }
});

it('settles cancelled approval once and prevents another tenant or mismatched action from altering pause evidence', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const action = wait(f.ledger, f.claim, 'cancel');
    now += 80_000;
    const otherId = new UserRepository(f.db).create('other-approval-clock@test.dev', 'hash').id;
    const other = new CopilotRunLedger(f.db, otherId);
    const before = clockRow(f.db, f.runId);
    assert.equal(other.decide(f.runId, action.id, true), false);
    assert.equal(other.cancel(f.runId), false);
    assert.throws(() => new RunGovernance(f.db, otherId, f.runId).remainingDurationMs(), /Run not found/);
    assert.deepEqual(clockRow(f.db, f.runId), before);
    f.db.prepare("UPDATE copilot_pending_actions SET input_digest='changed' WHERE id=?").run(action.id);
    assert.equal(f.ledger.decide(f.runId, action.id, true), false);
    assert.deepEqual(clockRow(f.db, f.runId), before);
    f.db.prepare('UPDATE copilot_pending_actions SET input_digest=? WHERE id=?').run(action.inputDigest, action.id);
    assert.equal(f.ledger.cancel(f.runId), true);
    assert.equal(clockRow(f.db, f.runId).approval_wait_ms, 80_000);
    assert.equal(clockRow(f.db, f.runId).approval_wait_started_at, null);
    now += 80_000;
    assert.equal(f.ledger.cancel(f.runId), false);
    assert.equal(f.ledger.decide(f.runId, action.id, true), false);
    assert.equal(clockRow(f.db, f.runId).approval_wait_ms, 80_000);
  } finally { f.db.close(); }
});

it('ignores a stale claim before opening a persisted approval wait', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const step = f.ledger.addStep(f.runId, { kind: 'tool', toolName: 'write_fixture', toolCallId: 'stale', inputJson: '{}' });
    now += 30_001;
    f.ledger.claim(f.runId, 'new-worker', 30_000);
    f.ledger.waitApproval(f.claim, step);
    // The expired claim cannot commit, so no pending action opens and the
    // run keeps executing under its current owner.
    assert.equal(clockRow(f.db, f.runId).approval_wait_started_at, null);
    assert.equal(f.ledger.get(f.runId)?.status, 'running');
    assert.equal(f.ledger.log.listPendingActions(f.runId).length, 0);
  } finally { f.db.close(); }
});

it('settles the run terminally when a wait targets a step from another run', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const otherConversation = f.ledger.log.createConversation().id;
    const otherRun = f.ledger.admit({ userId: f.userId, conversationId: otherConversation, userText: 'other' }, 1);
    const otherStep = f.ledger.addStep(otherRun, { kind: 'tool', toolName: 'write_fixture', toolCallId: 'cross-run', inputJson: '{}' });
    f.ledger.waitApproval(f.claim, otherStep);
    const run = f.ledger.get(f.runId)!;
    assert.equal(run.status, 'failed');
    assert.equal(run.stop_reason, 'COPILOT_APPROVAL_CHECKPOINT_MISMATCH');
    assert.equal(run.error, 'COPILOT_APPROVAL_CHECKPOINT_MISMATCH');
    assert.equal(clockRow(f.db, f.runId).approval_wait_started_at, null);
    assert.equal(f.ledger.log.listPendingActions(f.runId).length, 0);
    // The foreign step and run are untouched.
    assert.equal(f.ledger.steps(otherRun).find(step => step.id === otherStep.id)?.status, 'pending');
    assert.equal(f.ledger.get(otherRun)?.status, 'pending');
    // A settled run is terminal: the recovery pump must not re-drive it.
    assert.equal(f.ledger.claim(f.runId, 'recovery-worker', 30_000), undefined);
  } finally { f.db.close(); }
});

it('settles the run terminally when the stored step fails the consistency re-check', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const step = f.ledger.addStep(f.runId, { kind: 'tool', toolName: 'write_fixture', toolCallId: 'tampered', inputJson: '{}' });
    // Tamper with the durable step digest after it was recorded.
    f.db.prepare("UPDATE copilot_run_steps SET input_digest='forged' WHERE id=?").run(step.id);
    f.ledger.waitApproval(f.claim, step);
    const run = f.ledger.get(f.runId)!;
    assert.equal(run.status, 'failed');
    assert.equal(run.stop_reason, 'COPILOT_APPROVAL_CHECKPOINT_MISMATCH');
    assert.equal(f.ledger.steps(f.runId).find(row => row.id === step.id)?.status, 'failed');
    assert.equal(f.ledger.log.listPendingActions(f.runId).length, 0);
  } finally { f.db.close(); }
});

it('opens a persisted approval wait when the stored step matches the request', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const step = f.ledger.addStep(f.runId, { kind: 'tool', toolName: 'write_fixture', toolCallId: 'match', inputJson: '{}' });
    now += 30_001;
    const current = f.ledger.claim(f.runId, 'new-worker', 30_000)!;
    f.ledger.waitApproval(current, step);
    assert.equal(clockRow(f.db, f.runId).approval_wait_started_at, now);
    assert.equal(f.ledger.get(f.runId)?.status, 'awaiting_approval');
  } finally { f.db.close(); }
});

it('keeps ordinary running downtime and pending time charged and does not revive exhausted budgets', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    now += 61_000;
    assert.equal(f.meter.remainingDurationMs(), 0);
    assert.throws(() => f.meter.check(), /elapsed-time budget/);
    f.db.prepare("UPDATE copilot_runs SET status='pending',lease_owner=NULL,lease_expires_at=NULL WHERE id=?").run(f.runId);
    f.ledger.claim(f.runId, 'after-downtime', 30_000);
    assert.equal(f.meter.remainingDurationMs(), 0);
    assert.throws(() => f.meter.check(), /elapsed-time budget/);
  } finally { f.db.close(); }
});

it('settles an approved wait before finish while stale terminal commits cannot alter pending approval', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const action = wait(f.ledger, f.claim, 'finish');
    now += 90_000;
    const before = clockRow(f.db, f.runId);
    assert.equal(f.ledger.finish(f.claim, 'completed'), false);
    assert.deepEqual(clockRow(f.db, f.runId), before);
    assert.equal(f.ledger.decide(f.runId, action.id, true), true);
    const current = f.ledger.claim(f.runId, 'finishing-worker', 30_000)!;
    now += 10_000;
    assert.equal(f.ledger.finish(current, 'completed'), true);
    assert.equal(clockRow(f.db, f.runId).approval_wait_ms, 90_000);
    assert.equal(clockRow(f.db, f.runId).approval_wait_started_at, null);
    now += 10_000;
    assert.equal(f.ledger.finish(current, 'completed'), false);
    assert.equal(clockRow(f.db, f.runId).approval_wait_ms, 90_000);
  } finally { f.db.close(); }
});

it('a failed approval checkpoint rolls back both action decision and accumulated pause', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const action = wait(f.ledger, f.claim, 'rollback');
    now += 90_000;
    const before = clockRow(f.db, f.runId);
    f.db.exec(`CREATE TRIGGER reject_approval_checkpoint BEFORE UPDATE OF status ON copilot_runs
      WHEN NEW.status='pending' BEGIN SELECT RAISE(ABORT, 'fixture approval checkpoint failure'); END`);
    assert.throws(() => f.ledger.decide(f.runId, action.id, true), /fixture approval checkpoint failure/);
    assert.deepEqual(clockRow(f.db, f.runId), before);
    assert.equal(f.ledger.log.getPendingAction(action.id)?.status, 'pending');
    assert.equal(f.ledger.get(f.runId)?.status, 'awaiting_approval');
    f.db.exec('DROP TRIGGER reject_approval_checkpoint');
    assert.equal(f.ledger.decide(f.runId, action.id, true), true);
    assert.equal(clockRow(f.db, f.runId).approval_wait_ms, 90_000);
  } finally { f.db.close(); }
});

it('never grants time credit from forged stored digests and bounds persisted cumulative credit', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  try {
    const action = wait(f.ledger, f.claim, 'forged');
    now += 90_000;
    f.db.prepare("UPDATE copilot_pending_actions SET input_digest='forged' WHERE id=?").run(action.id);
    f.db.prepare("UPDATE copilot_run_steps SET input_digest='forged' WHERE id=?").run(action.stepId);
    assert.equal(f.meter.remainingDurationMs(), 0);
    assert.equal(f.ledger.decide(f.runId, action.id, true), false);
    assert.equal(f.ledger.cancel(f.runId), true);
    assert.equal(clockRow(f.db, f.runId).approval_wait_ms, 0);
    f.db.prepare('UPDATE copilot_runs SET approval_wait_ms=-1 WHERE id=?').run(f.runId);
    assert.equal(f.meter.remainingDurationMs(), 0);
    f.db.prepare('UPDATE copilot_runs SET approval_wait_ms=900000 WHERE id=?').run(f.runId);
    assert.equal(f.meter.remainingDurationMs(), 60_000);
  } finally { f.db.close(); }
});

it('research governance shares the originating run approval-adjusted remaining budget', t => {
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  const root = mkdtempSync(join(tmpdir(), 'fb-approval-research-'));
  try {
    const project = new ProjectRepository(f.db, f.userId).create({ name: 'research', path: root, aiTool: 'codex' });
    now += 20_000;
    const action = wait(f.ledger, f.claim, 'parent');
    now += 90_000;
    assert.equal(f.ledger.decide(f.runId, action.id, true), true);
    const conversationId = f.ledger.log.createConversation().id;
    const child = f.ledger.admit({ userId: f.userId, conversationId, userText: 'research', projectId: project.id,
      executionMode: 'research', parentRunId: f.runId }, 6);
    f.db.prepare('INSERT INTO copilot_research_jobs(id,user_id,origin_run_id,source_key,conversation_id,child_run_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('research-job', f.userId, f.runId, 'parent-call', conversationId, child, now);
    f.ledger.claim(child, 'research-worker', 60_000);
    const childMeter = new RunGovernance(f.db, f.userId, child);
    assert.equal(f.meter.remainingDurationMs(), 40_000);
    assert.doesNotThrow(() => childMeter.check());
    now += 40_000;
    assert.ok(childMeter.remainingDurationMs() > 0);
    assert.throws(() => childMeter.check(), /elapsed-time budget/);
    assert.doesNotThrow(() => childMeter.check(0, false));
  } finally { f.db.close(); rmSync(root, { recursive: true, force: true }); }
});
