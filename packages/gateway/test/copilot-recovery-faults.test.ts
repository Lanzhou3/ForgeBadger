import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { startCopilotRuntime } from '../src/services/agent/runtime.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { executionControl } from '../src/services/agent/execution-control.js';
import { appendProvisionalText, provisionalText } from '../src/services/agent/provisional-text.js';

it('contains recovery write faults without rejecting readiness or stopping other recovery', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  new UserRepository(db).create('recovery@test.invalid', 'fixture');
  db.pragma('query_only=ON');
  const runtime = startCopilotRuntime({ db, masterKey: 'a'.repeat(32), eventBus: new ForgeBadgerEventBus() });
  try { await assert.doesNotReject(runtime.ready); }
  finally {
    appendProvisionalText(db, 'fixture', 'paused', 'step', 1, 1, 'Public paused progress.');
    await runtime.stop();
    assert.equal(provisionalText(db, 'fixture', 'paused'), undefined, 'shutdown also clears inactive approval snapshots');
    db.close();
  }
});

it('contains lease renewal and queued execution failures during a database write fault', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('lease-fault@test.invalid', 'fixture');
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let signal: AbortSignal | undefined;
  const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32), leaseMs: 60,
    eventBus: new ForgeBadgerEventBus(), toolRegistry: createAgentToolRegistry([]), llm: {
      async stream(request) {
        signal = request.signal!;
        started();
        await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
        return { message: '' };
      }, async summarize() { return ''; }, async generateTitle() { return ''; }
    } });
  try {
    orchestrator.enqueue({ userId: user.id, conversationId: conversation.id, userText: 'Fixture' });
    await ready;
    db.pragma('query_only=ON');
    for (let i = 0; i < 100 && executionControl(db).active.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(signal?.aborted, true);
    assert.equal(executionControl(db).active.size, 0);
  } finally { db.pragma('query_only=OFF'); db.close(); }
});
