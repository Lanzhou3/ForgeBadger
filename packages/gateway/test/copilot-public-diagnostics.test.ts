import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { providerRejection } from '../src/services/agent/provider-error.js';
import { appendProvisionalText, provisionalText, clearProvisionalText } from '../src/services/agent/provisional-text.js';

it('persists safe HTTP classifications and visible diagnostics without provider bodies', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('diagnostic@test.invalid', 'fixture');
  const ledger = new CopilotRunLedger(db, user.id);
  try {
    for (const [status, category] of [[401, 'authentication'], [403, 'permission'], [429, 'rate_limit']] as const) {
      const conversation = ledger.log.createConversation();
      const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(32), eventBus: new ForgeBadgerEventBus(), toolRegistry: createAgentToolRegistry([]),
        llm: { async stream() { throw await providerRejection(new Response('SYNTHETIC_PRIVATE_BODY', { status }), new AbortController().signal); },
          async summarize() { return ''; }, async generateTitle() { return ''; }, async proposeMemory() { return []; } } });
      await assert.rejects(orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, userText: 'Fixture.' }), { code: 'AGENT_HTTP_ERROR' });
      const run = ledger.log.listRuns(conversation.id)[0]!;
      const result = JSON.parse(ledger.steps(run.id)[0]!.result_json!);
      assert.equal(result.httpStatus, status); assert.equal(result.category, category);
      const messages = ledger.log.listMessages(conversation.id);
      assert.ok(messages.some(m => m.kind === 'error' && m.content.includes(String(status))));
      assert.equal(JSON.stringify(messages).includes('SYNTHETIC_PRIVATE_BODY'), false);
    }
  } finally { db.close(); }
});

it('safe provisional snapshots are tenant/fence isolated, contiguous and bounded', () => {
  const db = new Database(':memory:');
  try {
    appendProvisionalText(db, 'a', 'r', 's', 2, 1, 'Safe ');
    appendProvisionalText(db, 'a', 'r', 's', 2, 2, 'text.');
    appendProvisionalText(db, 'a', 'r', 'old', 1, 1, 'obsolete');
    assert.equal(provisionalText(db, 'b', 'r'), undefined);
    assert.deepEqual(provisionalText(db, 'a', 'r')?.steps, [{ stepId: 's', fence: 2, sequence: 2, text: 'Safe text.' }]);
    appendProvisionalText(db, 'a', 'r', 's', 2, 3, 'x'.repeat(300_000));
    assert.equal(provisionalText(db, 'a', 'r'), undefined);
    appendProvisionalText(db, 'a', 'r', 'new', 3, 1, 'Safe.');
    clearProvisionalText(db, 'r');
    assert.equal(provisionalText(db, 'a', 'r'), undefined);
  } finally { db.close(); }
});

it('keeps published text from earlier model steps in chronological snapshots', () => {
  const db = new Database(':memory:');
  try {
    appendProvisionalText(db, 'u', 'r', 'first', 1, 1, 'Earlier. ');
    appendProvisionalText(db, 'u', 'r', 'first', 1, 2, 'Recovered gap. ');
    appendProvisionalText(db, 'u', 'r', 'second', 1, 1, 'Later. ');
    assert.deepEqual(provisionalText(db, 'u', 'r')?.steps.map(step => [step.stepId, step.text]),
      [['first', 'Earlier. Recovered gap. '], ['second', 'Later. ']]);
    appendProvisionalText(db, 'u', 'r', 'first', 1, 3, 'Late obsolete callback.');
    assert.equal(provisionalText(db, 'u', 'r')?.steps[0]?.sequence, 2);
  } finally { db.close(); }
});
