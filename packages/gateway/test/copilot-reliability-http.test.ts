import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createGatewayApp } from '../src/server.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { CopilotToolPreferenceRepository } from '../src/db/repositories/copilot-tool-preference-repository.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { signJwt } from '../src/auth/jwt.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { publishCompletion } from '../src/services/agent/llm-response.js';

async function fixture(llm: AgentLlmClient) {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('reliability-owner@test.invalid', 'fixture');
  const outsider = new UserRepository(db).create('reliability-outsider@test.invalid', 'fixture');
  const masterKey = 'a'.repeat(32), jwtSecret = 'b'.repeat(32);
  const eventBus = new ForgeBadgerEventBus();
  const app = createGatewayApp({ db, masterKey, jwtSecret, eventBus, sessionServerIpcPath: '/tmp/fb-unused-reliability.sock',
    apiKeyStore: new InMemoryApiKeyStore({ masterKey }), sessionManager: new InMemorySessionManager({
      async listSessions() { return []; }, async createSession() {}, async killSession() {}, async capturePane() { return ''; }, async hasSession() { return false; }
    }) });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/v1/copilot`;
  const headers = (actor = user) => ({ Authorization: `Bearer ${signJwt({ userId: actor.id, email: actor.email }, jwtSecret)}`, 'Content-Type': 'application/json' });
  const ledger = new CopilotRunLedger(db, user.id);
  const conversation = ledger.log.createConversation('Fixed fixture');
  const orchestrator = createCopilotOrchestrator({ db, masterKey, llm, eventBus, toolRegistry: createAgentToolRegistry(createPlatformTools()) });
  return { db, user, outsider, app, url, headers, ledger, conversation, orchestrator };
}

it('GET run restores only safely published provisional text and isolates the tenant', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const raw = 'Visible progress.\n-----BEGIN PRIVATE KEY-----\nSYNTHETIC_PRIVATE_BODY\n-----END PRIVATE KEY-----';
  const f = await fixture({ async stream(request) {
    request.onEvent({ type: 'text_delta', text: 'Visible progress.\n' });
    for (const text of ['-----BEGIN', ' PRIVATE KEY-----\nSYNTHETIC_PRIVATE_BODY\n-----END PRIVATE KEY-----']) request.onEvent({ type: 'text_delta', text });
    started(); await gate; return { message: raw };
  }, async summarize() { return ''; }, async generateTitle() { return ''; } });
  const executing = f.orchestrator.runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Inspect fixture' });
  try {
    await ready;
    const run = f.ledger.log.listRuns(f.conversation.id)[0]!;
    const response = await fetch(`${f.url}/runs/${run.id}`, { headers: f.headers() });
    assert.equal(response.status, 200);
    const body = await response.json() as { data: { provisionalText: { steps: Array<{ text: string; sequence: number }> } } };
    assert.equal(body.data.provisionalText.steps.map(step => step.text).join(''), 'Visible progress.\n');
    assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_PRIVATE_BODY|PRIVATE_THINKING/);
    assert.equal((await fetch(`${f.url}/runs/${run.id}`, { headers: f.headers(f.outsider) })).status, 404);
    release(); await executing;
    const settled = await fetch(`${f.url}/runs/${run.id}`, { headers: f.headers() });
    assert.equal((await settled.json() as { data: { provisionalText?: unknown } }).data.provisionalText, undefined);
  } finally { release(); await executing; await f.app.close(); }
});

it('approval HTTP preserves a known tool rejection code and does not consume the approval', async () => {
  let projectId = '', calls = 0;
  const f = await fixture({ async stream(request) {
    const first = calls++ === 0;
    return publishCompletion({ message: first ? '' : 'Done.', thinking: '', finishReason: first ? 'tool_calls' : 'stop',
      toolCalls: first ? [{ id: 'change', name: 'update_project', arguments: JSON.stringify({ projectId, name: 'Unexecuted change' }) }] : [] },
      request.onEvent, request.signal ?? new AbortController().signal, false);
  }, async summarize() { return ''; }, async generateTitle() { return ''; } });
  try {
    const projects = new ProjectRepository(f.db, f.user.id);
    const project = projects.create({ name: 'Fixture', path: '/tmp', aiTool: 'pi' }); projectId = project.id;
    const runId = await f.orchestrator.runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Fixture', projectId, source: 'reactive' });
    const action = f.ledger.log.listPendingActions(runId)[0]!;
    new CopilotToolPreferenceRepository(f.db, f.user.id).setEnabled('update_project', false);
    const response = await fetch(`${f.url}/runs/${runId}/pending-actions/${action.id}/decide`, {
      method: 'POST', headers: f.headers(), body: JSON.stringify({ approved: true })
    });
    const body = await response.json() as { details: { code: string } };
    assert.equal(response.status, 400); assert.equal(body.details.code, 'COPILOT_TOOL_DISABLED');
    assert.equal(f.ledger.log.getPendingAction(action.id)?.status, 'pending');
    assert.equal(projects.getById(project.id)?.name, 'Fixture');
  } finally { await f.app.close(); }
});

it('retains safe text while awaiting approval and across its new execution fence', async () => {
  let projectId = '', calls = 0, release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const f = await fixture({ async stream(request) {
    const first = calls++ === 0;
    const text = first ? 'Before approval. ' : 'After approval. ';
    request.onEvent({ type: 'text_delta', text });
    if (!first) { started(); await gate; }
    return { message: text, assistant: { role: 'assistant', content: text,
      ...(first ? { toolCalls: [{ id: 'change', name: 'update_project', arguments: JSON.stringify({ projectId, name: 'Approved fixture' }) }] } : {}) } };
  }, async summarize() { return ''; }, async generateTitle() { return ''; } });
  let executing: Promise<unknown> | undefined;
  try {
    const projects = new ProjectRepository(f.db, f.user.id);
    const project = projects.create({ name: 'Fixture', path: '/tmp', aiTool: 'pi' }); projectId = project.id;
    const runId = await f.orchestrator.runTurn({ userId: f.user.id, conversationId: f.conversation.id, userText: 'Fixture', projectId, source: 'reactive' });
    const read = async () => {
      const response = await fetch(`${f.url}/runs/${runId}`, { headers: f.headers() });
      return await response.json() as { data: { provisionalText?: { steps: Array<{ text: string; fence: number }> } } };
    };
    assert.equal(f.ledger.get(runId)?.status, 'awaiting_approval');
    assert.equal((await read()).data.provisionalText?.steps.map(step => step.text).join(''), 'Before approval. ');
    const action = f.ledger.log.listPendingActions(runId)[0]!;
    executing = f.orchestrator.resumeAfterApproval({ userId: f.user.id, runId, actionId: action.id, approved: true, decisionOrigin: 'web' });
    await ready;
    const snapshot = (await read()).data.provisionalText!;
    assert.equal(snapshot.steps.map(step => step.text).join(''), 'Before approval. After approval. ');
    assert.ok(snapshot.steps[1]!.fence > snapshot.steps[0]!.fence);
    await f.orchestrator.cancelRun({ userId: f.user.id, runId });
    assert.equal((await read()).data.provisionalText, undefined);
  } finally { release(); await executing; await f.app.close(); }
});
