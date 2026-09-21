import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { CopilotGrantRepository } from '../src/db/repositories/copilot-grant-repository.js';

it('deduplicates a client request before busy checks and after completion', () => {
  const db = new Database(':memory:');
  try {
    migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
    const user = new UserRepository(db).create('request@example.test', 'hash');
    const ledger = new CopilotRunLedger(db, user.id);
    const conversation = ledger.log.createConversation();
    const input = { userId: user.id, conversationId: conversation.id, userText: 'Inspect project', clientRequestId: 'logical-request' };
    const first = ledger.admit(input, 16);
    assert.equal(ledger.admit(input, 16), first);
    assert.throws(() => ledger.admit({ ...input, userText: 'Different' }, 16), /request key.*different/i);
    assert.throws(() => ledger.admit({ ...input, modelId: 'different' }, 16), /request key.*different/i);
    assert.throws(() => ledger.admit({ ...input, source: 'scheduled' }, 16), /request key.*different/i);
    const claim = ledger.claim(first, 'test', 30_000)!;
    ledger.finish(claim, 'completed');
    assert.equal(ledger.admit(input, 16), first);
    assert.equal(ledger.log.listMessages(conversation.id).length, 1);
    assert.equal(ledger.log.listRuns(conversation.id).length, 1);
    assert.notEqual(ledger.admit({ ...input, clientRequestId: 'intentional-new-request' }, 16), first);
    db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(user.id);
    assert.throws(() => ledger.admit(input, 16), /not active/);
  } finally { db.close(); }
});

it('scopes request keys to tenant/conversation and rechecks revoked grant on replay', () => {
  const db = new Database(':memory:');
  try {
    migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
    const users = new UserRepository(db);
    const alice = users.create('alice-request@example.test', 'hash');
    const bob = users.create('bob-request@example.test', 'hash');
    const ledger = new CopilotRunLedger(db, alice.id), other = new CopilotRunLedger(db, bob.id);
    const grants = new CopilotGrantRepository(db, alice.id);
    const grant = grants.create({ name: 'limited', scope: { projectIds: [], capabilities: ['memory.write'], allowedRoots: [] }, expiresAt: null, maxActions: 5, maxConcurrency: 1 });
    const conversation = ledger.log.createConversation();
    const input = { userId: alice.id, conversationId: conversation.id, userText: 'Inspect', clientRequestId: 'same', grantId: grant.id };
    const first = ledger.admit(input, 16);
    assert.equal(ledger.admit(input, 16), first);
    const second = other.admit({ userId: bob.id, conversationId: other.log.createConversation().id, userText: 'Inspect', clientRequestId: 'same' }, 16);
    assert.notEqual(second, first);
    assert.throws(() => other.admit({ ...input, userId: bob.id }, 16), /not found/i);
    db.prepare("UPDATE copilot_grants SET status='revoked' WHERE id=?").run(grant.id);
    assert.throws(() => ledger.admit(input, 16), /revoked/i);
  } finally { db.close(); }
});
