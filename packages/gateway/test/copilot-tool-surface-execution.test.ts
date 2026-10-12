import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { CopilotConnectionRepository } from '../src/db/repositories/copilot-connection-repository.js';
import { createConnectionToolRegistry } from '../src/services/extensions/connection-tools.js';

for (const source of ['reactive', 'scheduled'] as const) it(`${source} run rejects owner-disabled external read calls even if the model emits them`, async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const userId = new UserRepository(db).create(`${source}@review.invalid`, 'fixture').id;
    const ledger = new CopilotRunLedger(db, userId);
    const conversationId = ledger.log.createConversation().id;
    const runId = ledger.admit({ userId, conversationId, userText: 'Inspect event', source }, 3);
    let executions = 0, calls = 0;
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(64), eventBus: new ForgeBadgerEventBus(),
      isToolDisabled: name => name === 'mcp_query',
      toolRegistry: createAgentToolRegistry([{ name: 'mcp_query', description: 'External read', risk: 'read', requiresApproval: false,
        inputSchema: z.object({}), async execute() { executions++; return 'external contents'; } }]),
      llm: { async stream(request) {
        assert.equal(request.tools.some(t => t.name === 'mcp_query'), false, 'catalog must hide tool');
        if (++calls === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'forged', name: 'mcp_query', arguments: '{}' } });
        return { message: 'done', usage: { totalTokens: 10 } };
      }, async summarize() { return ''; }, async generateTitle() { return ''; } }
    });
    await orchestrator.executeRun(userId, runId);
    assert.equal(executions, 0, 'excluded tool must never execute');
    assert.equal(ledger.log.listPendingActions(runId).length, 0);
  } finally { db.close(); }
});

it('real MCP registry rejects disabled reactive calls before creating approval', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const userId = new UserRepository(db).create('real-mcp@review.invalid', 'fixture').id;
    const repo = new CopilotConnectionRepository(db, userId);
    const row = repo.create('Fixture server', 'https://review.invalid/mcp', null);
    repo.save(row.id, row.revision, { ...row, enabled: 1,
      tools_json: JSON.stringify([{ name: 'query', description: 'fixture', inputSchema: { type: 'object', properties: {} }, compatible: true, unavailableReason: null }]),
      enabled_tools_json: JSON.stringify(['query']) });
    const registry = createConnectionToolRegistry([], db, userId, 'a'.repeat(64));
    const name = registry.toModelSchemas()[0].name;
    const ledger = new CopilotRunLedger(db, userId), conversationId = ledger.log.createConversation().id;
    const runId = ledger.admit({ userId, conversationId, userText: 'Event', source: 'reactive' }, 3);
    let calls = 0;
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(64), eventBus: new ForgeBadgerEventBus(),
      toolRegistry: registry, isToolDisabled: () => true,
      llm: { async stream(request) {
        if (++calls === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'forged', name, arguments: '{}' } });
        return { message: 'done', usage: { totalTokens: 10 } };
      }, async summarize() { return ''; }, async generateTitle() { return ''; } }
    });
    await orchestrator.executeRun(userId, runId);
    assert.notEqual(ledger.get(runId)?.status, 'awaiting_approval');
    assert.deepEqual(ledger.log.listPendingActions(runId), []);
    assert.ok(ledger.log.listMessages(conversationId).some(m => m.content.includes('Tool disabled by owner')));
  } finally { db.close(); }
});

for (const revoke of ['owner', 'source'] as const) it(`revalidates ${revoke} authority for an already pending MCP approval`, async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  try {
    const userId = new UserRepository(db).create(`mcp-approval-${revoke}@test.local`, 'fixture').id;
    const repo = new CopilotConnectionRepository(db, userId);
    const row = repo.create('Fixture server', 'https://review.invalid/mcp', null);
    repo.save(row.id, row.revision, { ...row, enabled: 1,
      tools_json: JSON.stringify([{ name: 'query', description: 'fixture', inputSchema: { type: 'object', properties: {} }, compatible: true, unavailableReason: null }]),
      enabled_tools_json: JSON.stringify(['query']) });
    const registry = createConnectionToolRegistry([], db, userId, 'a'.repeat(64));
    const name = registry.toModelSchemas()[0]!.name;
    const ledger = new CopilotRunLedger(db, userId), conversationId = ledger.log.createConversation().id;
    const input = { userId, conversationId, userText: 'Query external server', source: 'user' as const };
    const runId = ledger.admit(input, 3);
    let disabled = false, calls = 0;
    const orchestrator = createCopilotOrchestrator({ db, masterKey: 'a'.repeat(64), eventBus: new ForgeBadgerEventBus(),
      toolRegistry: registry, isToolDisabled: () => disabled,
      llm: { async stream(request) {
        if (++calls === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'pending', name, arguments: '{}' } });
        return { message: 'done', usage: { totalTokens: 10 } };
      }, async summarize() { return ''; }, async generateTitle() { return ''; } }
    });
    await orchestrator.executeRun(userId, runId);
    assert.equal(ledger.get(runId)?.status, 'awaiting_approval');
    const action = ledger.log.listPendingActions(runId)[0]!;
    if (revoke === 'owner') disabled = true;
    // A pending action persisted by the old gate from a reactive origin must
    // also fail after upgrade; seed that historical origin in the fixture.
    db.prepare("UPDATE copilot_runs SET input_json=?, source='reactive' WHERE id=? AND user_id=?").run(JSON.stringify({ ...input, source: 'reactive' }), runId, userId);
    await assert.rejects(orchestrator.resumeAfterApproval({ userId, runId, actionId: action.id, approved: true, decisionOrigin: 'web' }),
      revoke === 'owner' ? /disabled by its owner/ : /cannot execute the requested tool/);
    assert.equal(ledger.log.getPendingAction(action.id)?.status, 'pending');
  } finally { db.close(); }
});
