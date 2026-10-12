import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from "node:url";
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createGatewayApp } from "../src/server.js";
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { RunGovernance } from '../src/services/agent/run-governance.js';
import { listRunTrace, sanitizeTraceDetail, traceRunEvent } from '../src/services/agent/run-trace.js';
import { InMemorySessionManager } from "../src/services/session-manager.js";
import { InMemoryApiKeyStore } from "../src/secrets/api-key-store.js";
import { signJwt } from "../src/auth/jwt.js";

function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('trace@test.dev', 'hash').id;
  const ledger = new CopilotRunLedger(db, userId);
  const conversationId = ledger.log.createConversation().id;
  return { db, userId, ledger, input: { userId, conversationId, userText: 'original goal with secret-ish content' } };
}

it('emits a monotonic decision timeline across a run lifecycle', async () => {
  const f = fixture();
  try {
    const run = f.ledger.admit(f.input, 4);
    const claim = f.ledger.claim(run, 'worker', 30000)!;
    assert.ok(claim);
    await new RunGovernance(f.db, f.userId, run).measure('model', 'input',
      async () => ({ usage: { inputTokens: 10, outputTokens: 5 } }), result => result.usage);
    // Simulate an interrupted owner: force the lease to expire, then reclaim.
    f.db.prepare('UPDATE copilot_runs SET lease_expires_at=1 WHERE user_id=? AND id=?').run(f.userId, run);
    const reclaimed = f.ledger.claim(run, 'worker-2', 30000)!;
    assert.ok(reclaimed);
    const toolStep = f.ledger.addStep(run, { kind: 'tool', toolCallId: 'call-1', toolName: 'operate_session', inputJson: JSON.stringify({ command: 'ls' }), effect: 'write' });
    f.ledger.waitApproval(reclaimed, toolStep);
    const action = f.ledger.log.listPendingActions(run)[0]!;
    assert.equal(f.ledger.decide(run, action.id, true), true);
    const finalClaim = f.ledger.claim(run, 'worker-2', 30000)!;
    assert.ok(finalClaim);
    assert.equal(f.ledger.finish(finalClaim, 'completed'), true);

    const events = listRunTrace(f.db, f.userId, run);
    const names = events.map(event => event.event);
    for (const expected of ['admitted', 'claimed', 'llm_call_completed', 'run_recovered', 'approval_parked', 'approval_decided', 'run_finished'])
      assert.ok(names.includes(expected), `missing ${expected} in ${names.join(',')}`);
    assert.deepEqual(events.map(event => event.seq), events.map((_, index) => index + 1));
    assert.deepEqual(events.map(event => event.seq), [...events.map(event => event.seq)].sort((a, b) => a - b));
    assert.ok(events.every(event => event.fence >= 0));
    assert.ok(events.some(event => event.event === 'run_recovered' && event.fence >= 2));
    const parked = events.find(event => event.event === 'approval_parked')!;
    assert.equal(parked.step_id, toolStep.id);
    assert.equal((JSON.parse(parked.detail_json!) as { toolName: string }).toolName, 'operate_session');
    const finished = events.find(event => event.event === 'run_finished')!;
    assert.equal((JSON.parse(finished.detail_json!) as { status: string }).status, 'completed');
  } finally { f.db.close(); }
});

it('stores metadata only: detail is whitelisted scalars and never message content', async () => {
  const f = fixture();
  try {
    const run = f.ledger.admit(f.input, 2);
    const events = listRunTrace(f.db, f.userId, run);
    assert.equal(events.length, 1);
    const detail = JSON.parse(events[0]!.detail_json!) as Record<string, unknown>;
    assert.ok(!('userText' in detail) && !('content' in detail));
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes('original goal with secret-ish content'));
    // Object passthrough and unknown keys are rejected by the sanitizer.
    const sanitized = sanitizeTraceDetail({ status: 'ok', tokens: 3, leaked: 'x', nested: { secret: true } as never, toolName: 't' });
    assert.deepEqual(sanitized, { status: 'ok', tokens: 3, toolName: 't' });
    traceRunEvent(f.db, f.userId, run, 1, 'tool_gate', { toolName: 'ok_tool', nested: { no: 'pass' } as never, extraKey: 'drop' }, undefined);
    const gate = listRunTrace(f.db, f.userId, run).at(-1)!;
    assert.deepEqual(JSON.parse(gate.detail_json!), { toolName: 'ok_tool' });
  } finally { f.db.close(); }
});

it('scopes trace reads to the owning tenant', () => {
  const f = fixture();
  try {
    const run = f.ledger.admit(f.input, 2);
    const other = new UserRepository(f.db).create('trace-other@test.dev', 'hash').id;
    assert.equal(listRunTrace(f.db, other, run).length, 0);
    assert.equal(listRunTrace(f.db, f.userId, run).length, 1);
  } finally { f.db.close(); }
});

it('serves the envelope-shaped trace over HTTP to the owner only', async () => {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const masterKey = 'a'.repeat(32), jwtSecret = 'b'.repeat(32);
  const users = new UserRepository(db);
  const owner = users.create('trace-http@test.dev', 'hash');
  const other = users.create('trace-http-other@test.dev', 'hash');
  const auth = (user: typeof owner) => ({ Authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, jwtSecret)}` });
  const log = new CopilotRunLedger(db, owner.id).log;
  const conversation = log.createConversation();
  const models = new ModelProviderRepository(db, owner.id, masterKey);
  const provider = models.createProviderProfile({ name: 'fixture', providerKey: 'fixture', baseUrl: 'https://8.8.8.8', apiFormat: 'openai-compatible', authType: 'api_key', supportedAdapters: ['opencode'] });
  models.createCredential({ providerProfileId: provider.id, label: 'test', plaintextSecret: 'fixture-secret' });
  models.createModelProfile({ providerProfileId: provider.id, name: 'fixture', modelId: 'fixture', capabilities: ['chat'], isDefault: true });
  const app = createGatewayApp({ db, masterKey, jwtSecret,
    sessionServerIpcPath: '/tmp/forgebadger-test-run-trace.sock',
    sessionManager: new InMemorySessionManager({ async listSessions() { return []; }, async createSession() {}, async killSession() {}, async capturePane() { return ''; } } as never),
    apiKeyStore: new InMemoryApiKeyStore({ masterKey }),
    llmFetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] })) });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/v1/copilot`;
  try {
    const accepted = await fetch(`${base}/conversations/${conversation.id}/messages`, { method: 'POST', headers: { ...auth(owner), 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'trace me' }) });
    assert.equal(accepted.status, 201);
    const { data: { runId } } = await accepted.json() as { data: { runId: string } };
    const trace = await fetch(`${base}/runs/${runId}/trace`, { headers: auth(owner) });
    assert.equal(trace.status, 200);
    const body = await trace.json() as { code: number; data: { events: Array<{ event: string; seq: number }> }; message: string };
    assert.equal(body.code, 0);
    assert.equal(body.message, '');
    assert.equal(body.data.events[0]?.event, 'admitted');
    assert.equal(body.data.events[0]?.seq, 1);
    assert.equal((await fetch(`${base}/runs/${runId}/trace`, { headers: auth(other) })).status, 404);
    assert.equal((await fetch(`${base}/runs/${runId}/trace`)).status, 401);
  } finally { await app.close(); db.close(); }
});
