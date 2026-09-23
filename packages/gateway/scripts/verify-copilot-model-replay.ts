/** Opt-in real-provider smoke; synthetic read-only tools and a disposable database. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';
import { createAgentPublicFetch } from '../src/services/agent/llm-public-fetch.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';

assert.equal(process.env.FORGEBADGER_REAL_COPILOT_TEST, '1', 'Explicit real-provider opt-in required');
assert.ok(process.env.FORGEBADGER_MASTER_KEY, 'Load the configured key through run-with-root-env');
const source = new Database(process.env.FORGEBADGER_DB_PATH ?? join(homedir(), '.forgebadger/forgebadger.db'), { readonly: true, fileMustExist: true });
const root = mkdtempSync(join(tmpdir(), 'fb-model-replay-'));
const db = new Database(join(root, 'test.db'));
try {
  const owners = source.prepare("SELECT DISTINCT user_id AS id FROM model_profiles WHERE is_default=1 AND status='active'").all() as Array<{ id: string }>;
  const owner = process.env.FORGEBADGER_TEST_MODEL_USER ?? (owners.length === 1 ? owners[0]!.id : undefined);
  assert.ok(owner, 'Select a configured model owner using FORGEBADGER_TEST_MODEL_USER');
  migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations', import.meta.url).pathname });
  const user = new UserRepository(db).create('replay-smoke@example.test', 'not-a-login');
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation('Protocol smoke');
  const transport = createAgentPublicFetch();
  const wire: Array<{ assistants: number; toolResults: number; combinedAssistantCalls: number }> = [];
  const llm = createAgentLlmClient({
    modelProviderRepository: new ModelProviderRepository(source, owner, process.env.FORGEBADGER_MASTER_KEY),
    timeoutMs: 120_000,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: unknown; tool_calls?: unknown[] }> };
      const assistants = body.messages.filter(message => message.role === 'assistant');
      wire.push({ assistants: assistants.length, toolResults: body.messages.filter(message => message.role === 'tool').length,
        combinedAssistantCalls: assistants.filter(message => message.tool_calls?.length).length });
      return transport(url, init);
    },
  });
  const modelId = process.env.FORGEBADGER_TEST_MODEL_PROFILE;
  const itemId = randomUUID();
  const calls: string[] = [];
  const tools = createAgentToolRegistry([
    { name: 'list_fixture_items', description: 'List the synthetic read-only items available in this test.', risk: 'read', requiresApproval: false,
      inputSchema: z.object({}), async execute() { calls.push('list'); return [{ id: itemId, name: 'protocol fixture' }]; } },
    { name: 'read_fixture_item', description: 'Read a synthetic item by the exact id returned from list_fixture_items.', risk: 'read', requiresApproval: false,
      inputSchema: z.object({ id: z.string() }), async execute(input) {
        assert.equal(input.id, itemId); calls.push('read'); return { status: 'verified', value: 73 };
      } },
  ]);
  const orchestrator = createCopilotOrchestrator({ db, masterKey: randomBytes(32).toString('hex'), llm, toolRegistry: tools, eventBus: new ForgeBadgerEventBus(), maxSteps: 8 });
  const run = await orchestrator.runTurn({ userId: user.id, conversationId: conversation.id, ...(modelId ? { modelId } : {}),
    userText: 'Inspect the available fixture items and obtain the details of the protocol fixture, then report its observed status and value. Use actual tool results; do not invent IDs or values.' });
  const modelSteps = ledger.steps(run).filter(step => step.kind === 'model').map(step => {
    const value = JSON.parse(step.result_json!);
    return { finishReason: value.finishReason, toolCallCount: value.toolCallCount };
  });
  const evidence = { timestamp: new Date().toISOString(), model: llm.resolveProvider(modelId).modelId,
    status: ledger.get(run)?.status, calls, modelSteps, wire,
    approvals: ledger.log.listPendingActions(run).length };
  writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ evidencePath: join(root, 'evidence.json'), ...evidence }, null, 2));
  assert.equal(evidence.status, 'completed');
  assert.deepEqual(calls, ['list', 'read']);
  assert.equal(evidence.approvals, 0);
  assert.ok(ledger.log.listRunMessages(run).some(message => message.kind === 'text' && message.role === 'assistant' && /73/u.test(message.content)));
} finally { db.close(); source.close(); }
