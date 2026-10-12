import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { CopilotFollowups } from '../src/services/agent/followups.js';
import { RunGovernance } from '../src/services/agent/run-governance.js';

function fixture(filename = ':memory:') {
  const db = new Database(filename); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('governance@test.dev', 'hash').id;
  const ledger = new CopilotRunLedger(db, userId), queue = new CopilotFollowups(db, userId);
  const conversationId = ledger.log.createConversation().id;
  return { db, userId, ledger, queue, input: { userId, conversationId, userText: 'original goal' } };
}

it('queues idempotently without polluting active context, then promotes once after completion', () => {
  const f = fixture();
  try {
    const active = f.ledger.admit(f.input, 2);
    const next = { ...f.input, userText: 'next goal', clientRequestId: 'next' };
    const row = f.queue.enqueue(next);
    assert.equal(f.queue.enqueue(next).id, row.id);
    assert.throws(() => f.queue.enqueue({ ...next, userText: 'different' }), /another request/);
    assert.deepEqual(f.queue.promote(), []);
    assert.deepEqual(f.ledger.log.listMessages(f.input.conversationId).map(row => row.content), ['original goal']);
    f.ledger.cancel(active);
    const promoted = new CopilotFollowups(f.db, f.userId).promote();
    assert.equal(promoted.length, 1);
    assert.deepEqual(f.queue.promote(), []);
    assert.equal(f.queue.cancel(row.id), false);
    assert.deepEqual(f.ledger.log.listMessages(f.input.conversationId).map(row => row.content), ['original goal', 'next goal']);
  } finally { f.db.close(); }
});

it('cancellation and revoked owner prevent promotion; another tenant cannot inspect or cancel', () => {
  const f = fixture();
  try {
    const row = f.queue.enqueue({ ...f.input, clientRequestId: 'cancel' });
    const other = new UserRepository(f.db).create('other-governance@test.dev', 'hash').id;
    const otherQueue = new CopilotFollowups(f.db, other);
    assert.equal(otherQueue.get(row.id), undefined); assert.equal(otherQueue.cancel(row.id), false);
    assert.equal(f.queue.cancel(row.id), true); assert.deepEqual(f.queue.promote(), []);
    const revoked = f.queue.enqueue({ ...f.input, clientRequestId: 'revoked' });
    f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.userId);
    assert.deepEqual(f.queue.promote(), []); assert.equal(f.queue.get(revoked.id)?.status, 'failed');
    assert.equal(f.ledger.log.listMessages(f.input.conversationId).length, 0);
  } finally { f.db.close(); }
});

it('persists reported usage, conservatively charges missing/failed usage, and enforces budgets after reconstruction', async () => {
  const f = fixture();
  try {
    const run = f.ledger.admit(f.input, 2); f.ledger.claim(run, 'worker', 30000);
    const meter = new RunGovernance(f.db, f.userId, run);
    await meter.measure('model', 'input', async () => ({ usage: { inputTokens: 10, outputTokens: 5 } }), result => result.usage);
    assert.equal(meter.usage().reportedTokens, 15);
    await meter.measure('summary', 'history', async () => 'summary');
    await assert.rejects(meter.measure('model', 'input', async () => { throw new Error('lost response'); }));
    const restored = new RunGovernance(f.db, f.userId, run);
    assert.equal(restored.usage().calls, 3); assert.equal(restored.usage().estimatedCalls, 2);
    assert.ok(restored.usage().chargedTokens > 15);
    f.db.prepare('UPDATE copilot_runs SET token_budget=1 WHERE id=?').run(run);
    assert.throws(() => restored.check(), /token budget/);
    f.db.prepare('UPDATE copilot_runs SET token_budget=500000,started_at=1 WHERE id=?').run(run);
    assert.throws(() => restored.check(), /elapsed-time budget/);
  } finally { f.db.close(); }
});


it('recovers queued input from a file database once across two independent connections', () => {
  const root = mkdtempSync(join(tmpdir(), 'fb-followup-reopen-'));
  const filename = join(root, 'state.db'); const f = fixture(filename);
  const active = f.ledger.admit(f.input, 2);
  f.queue.enqueue({ ...f.input, userText: 'durable follow-up', clientRequestId: 'reopen' });
  f.db.close();
  const a = new Database(filename), b = new Database(filename);
  try {
    const ledger = new CopilotRunLedger(a, f.userId);
    assert.equal(ledger.log.listMessages(f.input.conversationId).length, 1);
    assert.deepEqual(new CopilotFollowups(a, f.userId).promote(), []);
    ledger.cancel(active);
    assert.equal(new CopilotFollowups(a, f.userId).promote().length, 1);
    assert.deepEqual(new CopilotFollowups(b, f.userId).promote(), []);
    assert.equal(ledger.log.listMessages(f.input.conversationId).filter(m => m.content === 'durable follow-up').length, 1);
    assert.deepEqual(a.pragma('foreign_key_check'), []);
  } finally { a.close(); b.close(); rmSync(root, { recursive: true, force: true }); }
});
