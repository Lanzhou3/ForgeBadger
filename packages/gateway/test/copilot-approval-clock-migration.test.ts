import assert from 'node:assert/strict';
import { it } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { RunGovernance } from '../src/services/agent/run-governance.js';

it('upgrades populated 0124 conservatively, preserving wall-clock budgets and all prior execution evidence', () => {
  const root = new URL('../src/db/migrations/', import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), 'fb-approval-migration-'));
  const legacy = join(dir, 'legacy');
  mkdirSync(join(legacy, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(root, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter(entry => Number(entry.tag.slice(0, 4)) <= 124);
  writeFileSync(join(legacy, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(join(root, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`));
  const filename = join(dir, 'fixture.db');
  let db = new Database(filename);
  try {
    db.pragma('foreign_keys=ON');
    migrate(drizzle(db), { migrationsFolder: legacy });
    const userId = new UserRepository(db).create('migration-approval@test.dev', 'hash').id;
    const otherId = new UserRepository(db).create('migration-approval-other@test.dev', 'hash').id;
    const ledger = new CopilotRunLedger(db, userId);
    const startedAt = Date.now() - 2_400_000;
    const waitAt = startedAt + 10_000;
    function run(status: string) {
      const conversationId = ledger.log.createConversation().id;
      const id = ledger.admit({ userId, conversationId, userText: `legacy ${status}` }, 16);
      db.prepare('UPDATE copilot_runs SET status=?,started_at=?,fence=7,revision=11,lease_owner=?,lease_expires_at=?,max_duration_ms=60000 WHERE id=?')
        .run(status, startedAt, status === 'running' ? 'legacy-owner' : null, status === 'running' ? startedAt + 30_000 : null, id);
      return id;
    }
    function awaiting(mutation?: 'digest' | 'json' | 'call' | 'tenant' | 'rejected') {
      const id = run('awaiting_approval');
      const step = ledger.addStep(id, { kind: 'tool', toolName: 'write_fixture', toolCallId: `${id}-call`, inputJson: '{}' });
      db.prepare("UPDATE copilot_run_steps SET status='awaiting_approval' WHERE id=?").run(step.id);
      const action = ledger.log.createPendingAction({ runId: id, tool: step.tool_name!, inputJson: step.input_json!, inputDigest: step.input_digest! });
      db.prepare('UPDATE copilot_pending_actions SET step_id=?,tool_call_id=?,created_at=? WHERE id=?').run(step.id, step.tool_call_id, waitAt, action.id);
      if (mutation === 'digest') {
        // Equal stored digests are insufficient: actual JSON must hash to them.
        db.prepare("UPDATE copilot_pending_actions SET input_digest='forged' WHERE id=?").run(action.id);
        db.prepare("UPDATE copilot_run_steps SET input_digest='forged' WHERE id=?").run(step.id);
      }
      if (mutation === 'json') db.prepare("UPDATE copilot_pending_actions SET input_json='{\"different\":true}' WHERE id=?").run(action.id);
      if (mutation === 'call') db.prepare("UPDATE copilot_pending_actions SET tool_call_id='wrong-call' WHERE id=?").run(action.id);
      if (mutation === 'tenant') db.prepare('UPDATE copilot_pending_actions SET user_id=? WHERE id=?').run(otherId, action.id);
      if (mutation === 'rejected') db.prepare("UPDATE copilot_pending_actions SET status='rejected' WHERE id=?").run(action.id);
      return { id, actionId: action.id };
    }
    const valid = awaiting();
    const invalid = ['digest', 'json', 'call', 'tenant', 'rejected'].map(kind => awaiting(kind as Parameters<typeof awaiting>[0]));
    const missing = run('awaiting_approval');
    const running = run('running');
    const pending = run('pending');
    const completed = run('completed');
    const originalRuns = db.prepare('SELECT * FROM copilot_runs ORDER BY id').all() as Record<string, unknown>[];
    const evidenceTables = ['copilot_run_steps', 'copilot_pending_actions', 'copilot_messages', 'platform_action_intents', 'platform_action_receipts'];
    const evidence = evidenceTables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
    migrate(drizzle(db), { migrationsFolder: root });
    const upgraded = db.prepare('SELECT * FROM copilot_runs ORDER BY id').all() as Record<string, unknown>[];
    for (let i = 0; i < originalRuns.length; i++) {
      const { approval_wait_ms, approval_wait_started_at, ...unchanged } = upgraded[i];
      assert.deepEqual(unchanged, originalRuns[i]);
      assert.equal(approval_wait_ms, 0);
      if (originalRuns[i].id === valid.id) assert.equal(approval_wait_started_at, waitAt);
      else if (originalRuns[i].id !== invalid[0].id) assert.equal(approval_wait_started_at, null);
    }
    for (let i = 0; i < evidenceTables.length; i++) assert.deepEqual(db.prepare(`SELECT * FROM ${evidenceTables[i]} ORDER BY 1`).all(), evidence[i]);
    const meter = new RunGovernance(db, userId, valid.id);
    assert.ok(meter.remainingDurationMs() > 49_000 && meter.remainingDurationMs() <= 50_000);
    for (const id of [...invalid.map(row => row.id), missing, running, pending]) {
      assert.equal(new RunGovernance(db, userId, id).remainingDurationMs(), 0);
      assert.throws(() => new RunGovernance(db, userId, id).check(), /elapsed-time budget/);
    }
    migrate(drizzle(db), { migrationsFolder: root });
    assert.deepEqual(db.prepare('SELECT * FROM copilot_runs ORDER BY id').all(), upgraded);
    db.close();
    db = new Database(filename);
    const reopened = new CopilotRunLedger(db, userId);
    assert.equal(reopened.decide(valid.id, valid.actionId, true), true);
    assert.equal(reopened.get(completed)?.status, 'completed');
    assert.equal((db.prepare('SELECT started_at FROM copilot_runs WHERE id=?').get(valid.id) as { started_at: number }).started_at, startedAt);
    assert.ok(new RunGovernance(db, userId, valid.id).remainingDurationMs() > 49_000);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); }
});
