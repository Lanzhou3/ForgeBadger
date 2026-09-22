import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { executionControl } from '../src/services/agent/execution-control.js';
import { createAgentToolRegistry, executeAgentTool, type AgentTool } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { createDiscoveryTools } from '../src/services/agent/tools/discovery.js';
import { discoverToolSchemas, selectDiscoveredTools, DISCOVERY_CORE_TOOLS } from '../src/services/agent/tool-discovery.js';
import { visibleToolSchemas } from '../src/services/agent/tool-availability.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { createCopilotRoutes } from '../src/routes/copilot.js';
import { signJwt } from '../src/auth/jwt.js';

function database(filename = ':memory:') {
  const db = new Database(filename);
  migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations/', import.meta.url).pathname });
  return db;
}
function fixture(t: TestContext, filename?: string) {
  const db = database(filename);
  t.after(() => { if (db.open) db.close(); });
  const userId = new UserRepository(db).create('discovery@example.test', 'hash').id;
  const ledger = new CopilotRunLedger(db, userId);
  const conversationId = ledger.log.createConversation().id;
  const masterKey = randomBytes(32).toString('hex');
  const registry = createAgentToolRegistry(createPlatformTools());
  const disabled = new Set<string>();
  const makeOrchestrator = (stream: AgentLlmClient['stream'], selectedDb = db) => createCopilotOrchestrator({ db: selectedDb, masterKey,
    eventBus: new ForgeBadgerEventBus(), toolRegistry: registry, isToolDisabled: name => disabled.has(name),
    llm: { stream, async summarize() { return ''; }, async generateTitle() { return ''; }, async proposeMemory() { return []; } } });
  return { db, userId, ledger, conversationId, masterKey, registry, disabled, makeOrchestrator };
}

it('discovers through a real tool receipt and activates it only on the next model round', async t => {
  const f = fixture(t); let turns = 0;
  const orchestrator = f.makeOrchestrator(async request => {
    turns++;
    const names = request.tools.map(tool => tool.name);
    assert.ok(names.includes('discover_tools'));
    if (turns === 1) {
      assert.equal(names.includes('get_project'), false);
      request.onEvent({ type: 'tool_call', toolCall: { id: 'discover-call', name: 'discover_tools', arguments: '{"query":"get_project","limit":1}' } });
    } else {
      assert.ok(names.includes('get_project'));
      assert.ok(request.messages.some(message => message.role === 'tool' && message.toolCallId === 'discover-call' && message.content.includes('get_project')));
      request.onEvent({ type: 'text_delta', text: 'done' });
    }
    return { message: '' };
  });
  const runId = await orchestrator.runTurn({ userId: f.userId, conversationId: f.conversationId, userText: 'inspect project', toolDiscovery: true });
  assert.equal(turns, 2);
  assert.equal(f.ledger.steps(runId).find(step => step.tool_name === 'discover_tools')?.status, 'completed');
  assert.equal(JSON.parse(f.ledger.get(runId)!.input_json).toolDiscovery, true);
});

it('restores discovery from durable receipts after file DB close and reopen', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'copilot-discovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'state.db'); const f = fixture(t, filename); let turns = 0;
  const initial = f.makeOrchestrator(async request => {
    if (++turns === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'discover-call', name: 'discover_tools', arguments: '{"query":"get_project","limit":1}' } });
    else executionControl(f.db).stopped = true;
    return { message: '' };
  });
  const runId = await initial.runTurn({ userId: f.userId, conversationId: f.conversationId, userText: 'inspect', toolDiscovery: true });
  f.db.prepare('UPDATE copilot_runs SET lease_expires_at=0 WHERE id=?').run(runId); f.db.close();
  const reopened = database(filename); t.after(() => reopened.close());
  let resumed = false;
  await f.makeOrchestrator(async request => {
    resumed = true; assert.ok(request.tools.some(tool => tool.name === 'get_project'));
    request.onEvent({ type: 'text_delta', text: 'resumed' }); return { message: 'resumed' };
  }, reopened).executeRun(f.userId, runId);
  assert.equal(resumed, true);
  assert.equal(new CopilotRunLedger(reopened, f.userId).get(runId)?.status, 'completed');
});

it('keeps default full mode and includes discovery mode in idempotency without breaking legacy keys', async t => {
  const f = fixture(t);
  const input = { userId: f.userId, conversationId: f.conversationId, userText: 'inspect', clientRequestId: 'stable-key' };
  const runId = f.ledger.admit(input, 16);
  const oldDigest = createHash('sha256').update(JSON.stringify({ content: 'inspect', modelId: null, projectId: null, grantId: null, source: 'user', skipUserMessage: false })).digest('hex');
  f.db.prepare('UPDATE copilot_runs SET request_digest=? WHERE id=?').run(oldDigest, runId);
  assert.equal(f.ledger.admit({ ...input, toolDiscovery: false }, 16), runId);
  assert.throws(() => f.ledger.admit({ ...input, toolDiscovery: true }, 16), { code: 'COPILOT_REQUEST_CONFLICT' });
  let checked = false;
  await f.makeOrchestrator(async request => { checked = true; assert.ok(request.tools.some(tool => tool.name === 'get_project')); return { message: 'done' }; }).executeRun(f.userId, runId);
  assert.equal(checked, true);
});

it('intersects discovered selections with current owner switches and source permissions', async t => {
  const f = fixture(t); let turns = 0;
  await f.makeOrchestrator(async request => {
    if (++turns === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'discover-call', name: 'discover_tools', arguments: '{"query":"get_project","limit":1}' } });
    else if (turns === 2) { assert.equal(request.tools.some(tool => tool.name === 'get_project'), true); f.disabled.add('get_project'); request.onEvent({ type: 'tool_call', toolCall: { id: 'again', name: 'discover_tools', arguments: '{"query":"get_project","limit":1}' } }); }
    else { assert.equal(request.tools.some(tool => tool.name === 'get_project'), false); request.onEvent({ type: 'text_delta', text: 'done' }); }
    return { message: '' };
  }).runTurn({ userId: f.userId, conversationId: f.conversationId, userText: 'inspect', toolDiscovery: true });
  assert.equal(turns, 3);
  const registry = createAgentToolRegistry([...createPlatformTools(), { name: 'mcp_external', description: 'external', risk: 'operate', requiresApproval: true, inputSchema: z.object({}), async execute() { return {}; } }]);
  const visible = visibleToolSchemas(registry, { hasSessionManager: false, grantBound: true, scheduled: true });
  assert.equal(discoverToolSchemas(visible, 'mcp', 12).length, 0);
  assert.equal(discoverToolSchemas(visible, 'get_usage_summary', 12).length, 0);
  assert.equal(discoverToolSchemas(visible, 'start_session', 12).length, 0);
});

it('validates discover query and limit, caps activation, and rejects forged or cross-run receipts', async t => {
  const f = fixture(t); const discovery = createDiscoveryTools()[0]!;
  assert.equal(discovery.inputSchema.safeParse({ query: 'x'.repeat(101) }).success, false);
  assert.equal(discovery.inputSchema.safeParse({ query: 'x', limit: 13 }).success, false);
  const extra: AgentTool[] = Array.from({ length: 48 }, (_, i) => ({ name: `group${Math.floor(i / 12)}_read_${i}`, description: `Read group${Math.floor(i / 12)}`, risk: 'read', requiresApproval: false, inputSchema: z.object({}), async execute() { return {}; } }));
  const allVisible = createAgentToolRegistry([...createPlatformTools(), ...extra]).toModelSchemas();
  const runId = f.ledger.admit({ userId: f.userId, conversationId: f.conversationId, userText: 'inspect', toolDiscovery: true }, 16);
  const claim = f.ledger.claim(runId, 'test-owner', 10_000)!;
  for (let group = 0; group < 4; group++) {
    const raw = { query: `group${group}`, limit: 12 }; const step = f.ledger.addStep(runId, { kind: 'tool', toolCallId: `call${group}`, toolName: 'discover_tools', inputJson: JSON.stringify(raw), effect: 'read' });
    f.ledger.startStep(claim, step);
    const result = await executeAgentTool(discovery, raw, { db: f.db, userId: f.userId, masterKey: f.masterKey, runId, stepId: step.id,
      availableToolSchemas: allVisible, checkExecutionAuthority: () => true });
    assert.equal(result.ok, true);
    f.ledger.receipt(claim, step, JSON.stringify(result.output));
  }
  const select = (steps = f.ledger.steps(runId), selectedRun = runId) => selectDiscoveredTools({ allVisible, steps, userId: f.userId, runId: selectedRun, masterKey: f.masterKey, enabled: true });
  assert.equal(select().filter(tool => tool.name.startsWith('group')).length, 32);
  assert.equal(select(f.ledger.steps(runId), 'other-run').some(tool => tool.name.startsWith('group')), false);
  const forged = f.ledger.steps(runId).map(step => ({ ...step, result_json: JSON.stringify({ version: 1, query: 'group0', tools: [{ name: 'group0_read_0', summary: 'fake' }], selectionProof: '0'.repeat(64) }) }));
  assert.equal(select(forged).some(tool => tool.name.startsWith('group')), false);
  assert.equal(select(f.ledger.steps(runId).map(step => ({ ...step, status: 'indeterminate' }))).some(tool => tool.name.startsWith('group')), false);
  assert.equal(select(f.ledger.steps(runId).map(step => ({ ...step, result_json: 'Tool error: failed' }))).some(tool => tool.name.startsWith('group')), false);
});

it('reduces the actual platform schema character footprint in optional initial discovery mode', async t => {
  const f = fixture(t); const allVisible = visibleToolSchemas(f.registry, { hasSessionManager: false });
  const selected = selectDiscoveredTools({ allVisible, steps: [], userId: f.userId, runId: 'new-run', masterKey: f.masterKey, enabled: true });
  assert.ok(selected.length <= 8); assert.ok(selected.every(tool => DISCOVERY_CORE_TOOLS.has(tool.name)));
  assert.ok(JSON.stringify(selected).length < JSON.stringify(allVisible).length / 2);
  assert.deepEqual(selectDiscoveredTools({ allVisible, steps: [], userId: f.userId, runId: 'new-run', masterKey: f.masterKey, enabled: false }), allVisible);
  t.diagnostic(`actual schema chars: full=${JSON.stringify(allVisible).length}, discovery initial=${JSON.stringify(selected).length}`);
});

it('accepts the strict HTTP mode flag, persists it and rejects key reuse under another mode', async t => {
  const f = fixture(t); const jwtSecret = randomBytes(32).toString('hex');
  const app = express(); app.use(express.json()); app.locals.db = f.db; app.locals.jwtSecret = jwtSecret;
  app.use('/api/v1/copilot', createCopilotRoutes({ db: f.db, masterKey: f.masterKey, eventBus: new ForgeBadgerEventBus() }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const headers = { Authorization: `Bearer ${signJwt({ userId: f.userId, email: 'discovery@example.test' }, jwtSecret)}`, 'Content-Type': 'application/json' };
  const url = `http://127.0.0.1:${address.port}/api/v1/copilot/conversations/${f.conversationId}/messages`;
  const send = (body: unknown) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const response = await send({ content: 'inspect', clientRequestId: 'http-key', toolDiscovery: true });
  assert.equal(response.status, 201); const body = await response.json() as { data: { runId: string } };
  assert.equal(JSON.parse(f.ledger.get(body.data.runId)!.input_json).toolDiscovery, true);
  assert.equal((await send({ content: 'inspect', clientRequestId: 'http-key', toolDiscovery: false })).status, 409);
  assert.equal((await send({ content: 'inspect', toolDiscovery: 'true' })).status, 400);
});

it('keeps readback authorized by all visible tools even when its source schema is not loaded', async t => {
  const f = fixture(t);
  const prior = f.ledger.admit({ userId: f.userId, conversationId: f.conversationId, userText: 'previous inspection' }, 16);
  const claim = f.ledger.claim(prior, 'previous-owner', 10_000)!;
  const step = f.ledger.addStep(prior, { kind: 'tool', toolCallId: 'usage-call', toolName: 'get_usage_summary', inputJson: '{}', effect: 'read' });
  f.ledger.startStep(claim, step); f.ledger.receipt(claim, step, JSON.stringify({ evidence: 'readback-authority-preserved' }));
  f.ledger.finish(claim, 'completed');
  const message = f.ledger.log.listRunMessages(prior).find(row => row.kind === 'tool_result')!;
  let turns = 0;
  await f.makeOrchestrator(async request => {
    assert.equal(request.tools.some(tool => tool.name === 'get_usage_summary'), false);
    if (++turns === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'readback-call', name: 'read_tool_result', arguments: JSON.stringify({ messageId: message.id }) } });
    else {
      const receipt = request.messages.find(row => row.role === 'tool' && row.toolCallId === 'readback-call');
      assert.match(receipt!.content, /readback-authority-preserved/);
      request.onEvent({ type: 'text_delta', text: 'done' });
    }
    return { message: '' };
  }).runTurn({ userId: f.userId, conversationId: f.conversationId, userText: 'read previous evidence', toolDiscovery: true });
  assert.equal(turns, 2);
});

it('does not let discovery authorize a subsequent write', async t => {
  const f = fixture(t); let writes = 0, turns = 0;
  const registry = createAgentToolRegistry([...createPlatformTools(), { name: 'write_fixture', description: 'Write fixture after exact owner approval',
    risk: 'operate', requiresApproval: true, inputSchema: z.object({}).strict(), async execute() { writes++; return {}; } }]);
  const orchestrator = createCopilotOrchestrator({ db: f.db, masterKey: f.masterKey, eventBus: new ForgeBadgerEventBus(), toolRegistry: registry,
    llm: { async stream(request) {
      if (++turns === 1) request.onEvent({ type: 'tool_call', toolCall: { id: 'discover-write', name: 'discover_tools', arguments: '{"query":"write_fixture","limit":1}' } });
      else { assert.ok(request.tools.some(tool => tool.name === 'write_fixture')); request.onEvent({ type: 'tool_call', toolCall: { id: 'write-call', name: 'write_fixture', arguments: '{}' } }); }
      return { message: '' };
    }, async summarize() { return ''; }, async generateTitle() { return ''; }, async proposeMemory() { return []; } } });
  const runId = await orchestrator.runTurn({ userId: f.userId, conversationId: f.conversationId, userText: 'prepare operation', toolDiscovery: true });
  assert.equal(turns, 2); assert.equal(writes, 0); assert.equal(f.ledger.get(runId)?.status, 'awaiting_approval');
  assert.equal(f.ledger.log.listPendingActions(runId).length, 1);
});
