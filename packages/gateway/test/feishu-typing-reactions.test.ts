import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from '../src/services/channels/channel-identity-service.js';
import { NativeChannelInbox } from '../src/services/channels/native-channel-inbox.js';
import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';
import { createFeishuNativeSender } from '../src/services/integrations/feishu-native-sender.js';
import { FeishuTypingWorker } from '../src/services/channels/feishu-typing-worker.js';
import { createNativeFeishuRuntime } from '../src/services/channels/native-feishu-runtime.js';

function fixture() {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('typing@test.dev', 'fixture');
  const other = new UserRepository(db).create('other@test.dev', 'fixture');
  const key = randomBytes(32).toString('hex');
  const accounts = new FeishuChannelRepository(db, user.id, key);
  const account = accounts.upsertAccount({ appId: 'test-app', appSecret: randomBytes(24).toString('hex'), enabled: true });
  const config = new FeishuIntegrationRepository(db, user.id);
  config.upsertConfig({ enabled: true, emergencyDisabled: false, allowedChatIds: ['chat'] });
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'typing', path: '/private/tmp/typing-test', aiTool: 'claude' });
  projects.setCopilotAutonomy(project.id, true);
  const service = new ChannelIdentityService(db, user.id, key);
  const peer: TrustedChannelPeer = { channel: 'feishu', accountId: account.id, accountRevision: account.configRevision,
    externalUserId: 'sender', chatId: 'chat', chatType: 'p2p', replyToMessageId: 'original' };
  const issued = service.createPairing({ channel: 'feishu', accountId: account.id });
  const claimed = service.claimPairing(issued.token, peer);
  const identity = service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: 'sender', chatId: 'chat' });
  const route = service.createRoute({ identityId: identity.id, projectId: project.id });
  const inbox = new NativeChannelInbox(db, user.id, key);
  const receive = () => inbox.receive(peer, { eventId: 'event', messageId: 'original', text: 'hello' });
  const calls: { url: string; method: string; body: unknown }[] = [];
  const io = { validate: async () => {}, fetch: (async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('tenant_access_token')) return Response.json({ code: 0, tenant_access_token: 'fixture-token' });
    if (method === 'GET') return Response.json({ code: 0, data: { items: [], has_more: false, page_token: '' } });
    if (url.endsWith('/reactions')) return Response.json({ code: 0, data: { reaction_id: 'own-reaction' } });
    return Response.json({ code: 0, data: { message_id: 'reply' } });
  }) as typeof fetch };
  const worker = () => new FeishuTypingWorker(db, user.id, key, io);
  const tick = () => worker().runOnce(new AbortController().signal);
  const due = () => db.prepare('UPDATE feishu_typing_reactions SET next_attempt_at=0').run();
  const finish = async () => {
    const adopted = inbox.adoptNext();
    assert.equal(adopted.status, 'adopted');
    if (adopted.status !== 'adopted') throw new Error('adoption failed');
    db.prepare("UPDATE copilot_runs SET status='completed' WHERE id=?").run(adopted.runId);
    await new NativeChannelDelivery(db, user.id, key, createFeishuNativeSender(db, user.id, key, io)).runOnce(new AbortController().signal);
  };
  return { db, user, other, key, accounts, account, config, service, route, peer, inbox, receive, calls, io, worker, tick, due, finish };
}

it('adds Typing to the original message once and removes it after the actual reply, across worker recreation', async () => {
  const f = fixture();
  try {
    f.receive(); f.receive();
    await f.tick();
    const adds = f.calls.filter(c => c.url.endsWith('/reactions') && c.method === 'POST');
    assert.equal(adds.length, 1);
    assert.ok(adds[0]!.url.includes('/messages/original/'));
    assert.deepEqual(adds[0]!.body, { reaction_type: { emoji_type: 'Typing' } });
    f.due(); await f.tick();
    assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 0);
    await f.finish(); f.due(); await f.tick();
    assert.equal(f.calls.filter(c => c.method === 'DELETE')[0]?.url.endsWith('/reactions/own-reaction'), true);
    f.due(); await f.tick();
    assert.equal(f.calls.filter(c => c.url.endsWith('/reactions') && c.method === 'POST').length, 1);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.db.close(); }
});

it('does not flash Typing for already replied, old, unauthorized or other-tenant messages', async () => {
  for (const scenario of ['replied', 'old', 'revoked', 'tenant'] as const) {
    const f = fixture();
    try {
      const message = f.receive();
      if (scenario === 'replied') await f.finish();
      if (scenario === 'old') f.db.prepare('UPDATE channel_messages SET created_at=0 WHERE id=?').run(message.id);
      if (scenario === 'revoked') f.service.revokeRoute(f.route.id);
      f.calls.length = 0;
      if (scenario === 'tenant') await new FeishuTypingWorker(f.db, f.other.id, f.key, f.io).runOnce(new AbortController().signal);
      else await f.tick();
      assert.equal(f.calls.length, 0, scenario);
    } finally { f.db.close(); }
  }
});

it('reaction API failure cannot prevent durable admission or the text reply', async () => {
  const f = fixture();
  try {
    const request = f.io.fetch;
    f.io.fetch = async (input, init) => String(input).includes('/reactions')
      ? Response.json({ code: 99991672 }, { status: 403 }) : request(input, init);
    f.receive(); await f.tick(); await f.finish();
    assert.equal((f.db.prepare('SELECT status FROM channel_deliveries').get() as {status: string}).status, 'delivered');
  } finally { f.db.close(); }
});

it('cleans a late successful POST when the reply or revocation wins the race', async () => {
  for (const scenario of ['reply', 'revoke', 'emergency'] as const) {
    const f = fixture();
    try {
      const request = f.io.fetch;
      f.io.fetch = async (input, init) => {
        const response = await request(input, init);
        if (String(input).endsWith('/reactions') && init?.method === 'POST') {
          if (scenario === 'reply') await f.finish();
          if (scenario === 'revoke') f.service.revokeRoute(f.route.id);
          if (scenario === 'emergency') {
            f.config.upsertConfig({ emergencyDisabled: true });
            f.accounts.upsertAccount({ appId: f.account.appId, enabled: false });
          }
        }
        return response;
      };
      f.receive(); await f.tick();
      assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1, scenario);
    } finally { f.db.close(); }
  }
});

it('rechecks add authority after token/DNS awaits and never POSTs after revocation', async () => {
  for (const boundary of ['token', 'dns'] as const) {
    const f = fixture();
    try {
      const request = f.io.fetch;
      if (boundary === 'token') f.io.fetch = async (input, init) => {
        const response = await request(input, init);
        if (String(input).includes('tenant_access_token')) f.service.revokeRoute(f.route.id);
        return response;
      };
      else f.io.validate = async () => { f.service.revokeRoute(f.route.id); };
      f.receive(); await f.tick();
      assert.equal(f.calls.filter(c => c.url.includes('/reactions') && c.method === 'POST').length, 0);
    } finally { f.db.close(); }
  }
});

it('uncertain POST recovery paginates and deletes only this application’s Typing, without another POST', async () => {
  const f = fixture();
  try {
    const request = f.io.fetch;
    let creates = 0, pages = 0;
    f.io.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/reactions') && init?.method === 'POST') { creates++; throw new Error('response lost'); }
      if (url.includes('/reactions?')) {
        pages++;
        const item = (id: string, type: string, app: string, emoji = 'Typing') => ({ reaction_id: id,
          operator: { operator_type: type, operator_id: app }, reaction_type: { emoji_type: emoji } });
        return Response.json({ code: 0, data: { items: pages === 1
          ? [item('human', 'user', 'test-app'), item('foreign', 'app', 'another'), item('heart', 'app', 'test-app', 'HEART')]
          : [item('recovered', 'app', 'test-app')], has_more: pages === 1, page_token: pages === 1 ? 'next' : '' } });
      }
      return request(input, init);
    };
    f.receive(); await f.tick();
    assert.equal((f.db.prepare('SELECT state FROM feishu_typing_reactions').get() as {state:string}).state, 'uncertain');
    f.due(); await f.tick();
    assert.equal(creates, 1); assert.equal(pages, 2);
    assert.deepEqual(f.calls.filter(c => c.method === 'DELETE').map(c => c.url.split('/').at(-1)), ['recovered']);
  } finally { f.db.close(); }
});

it('recovers crashed adding claims and lost receipt writes without repeating creation', async () => {
  for (const scenario of ['crash', 'receipt-write'] as const) {
    const f = fixture();
    try {
      f.receive();
      if (scenario === 'receipt-write') f.db.exec(`CREATE TRIGGER fail_receipt BEFORE UPDATE OF reaction_id ON feishu_typing_reactions
        WHEN NEW.reaction_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'disk failure'); END`);
      await f.tick();
      if (scenario === 'receipt-write') f.db.exec('DROP TRIGGER fail_receipt');
      else f.db.prepare("UPDATE feishu_typing_reactions SET state='adding',reaction_id=NULL,claim_token='dead',lease_until=0").run();
      const request = f.io.fetch;
      f.io.fetch = async (input, init) => String(input).includes('/reactions?') ? Response.json({ code: 0, data: {
        items: [{ reaction_id: 'own-reaction', operator: { operator_type: 'app', operator_id: 'test-app' }, reaction_type: { emoji_type: 'Typing' } }],
        has_more: false, page_token: '' } }) : request(input, init);
      f.due(); await f.tick();
      assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1, scenario);
      assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/reactions')).length, 1, scenario);
    } finally { f.db.close(); }
  }
});

it('rechecks an empty uncertain-create lookup so a delayed reaction is still cleaned', async () => {
  for (const scenario of ['late-receipt', 'never-created'] as const) {
    const f = fixture();
    try {
      const request = f.io.fetch;
      let creates = 0, lists = 0;
      f.io.fetch = async (input, init) => {
        if (String(input).endsWith('/reactions') && init?.method === 'POST') { creates++; throw new Error('timeout'); }
        if (String(input).includes('/reactions?')) {
          lists++;
          return Response.json({ code: 0, data: { items: lists > 1 && scenario === 'late-receipt'
            ? [{ reaction_id: 'late', operator: { operator_type: 'app', operator_id: 'test-app' }, reaction_type: { emoji_type: 'Typing' } }] : [],
            has_more: false, page_token: '' } });
        }
        return request(input, init);
      };
      f.receive(); await f.tick(); f.due(); await f.tick();
      assert.equal((f.db.prepare('SELECT state FROM feishu_typing_reactions').get() as {state:string}).state, 'uncertain');
      if (scenario === 'never-created') f.db.prepare('UPDATE feishu_typing_reactions SET reconcile_until=0').run();
      f.due(); await f.tick();
      assert.equal((f.db.prepare('SELECT state FROM feishu_typing_reactions').get() as {state:string}).state, 'done');
      assert.equal(creates, 1); assert.equal(lists, 2);
      assert.equal(f.calls.filter(c => c.method === 'DELETE').length, scenario === 'late-receipt' ? 1 : 0);
    } finally { f.db.close(); }
  }
});

it('retains cleanup on rate limit/incomplete pagination and retries after backoff', async () => {
  for (const scenario of ['delete-rate-limit', 'broken-page'] as const) {
    const f = fixture();
    try {
      f.receive(); await f.tick(); await f.finish();
      if (scenario === 'broken-page') f.db.prepare("UPDATE feishu_typing_reactions SET state='uncertain',reaction_id=NULL").run();
      const request = f.io.fetch;
      let failures = 0;
      f.io.fetch = async (input, init) => {
        if (scenario === 'delete-rate-limit' && init?.method === 'DELETE') { failures++; return new Response('', { status: 429, headers: { 'retry-after': '7200' } }); }
        if (scenario === 'broken-page' && String(input).includes('/reactions?')) { failures++; return Response.json({ code: 0, data: { items: [], has_more: true, page_token: '' } }); }
        return request(input, init);
      };
      f.due(); await f.tick(); await f.tick();
      assert.equal(failures, 1);
      const state = f.db.prepare('SELECT state,next_attempt_at FROM feishu_typing_reactions').get() as {state:string;next_attempt_at:number};
      assert.notEqual(state.state, 'done'); assert.ok(state.next_attempt_at > Date.now() + 25_000);
      if (scenario === 'delete-rate-limit') assert.ok(state.next_attempt_at > Date.now() + 7_190_000, 'do not shorten provider backoff');
      f.io.fetch = request;
      f.db.prepare('UPDATE feishu_typing_reactions SET reconcile_until=0').run();
      f.due(); await f.tick();
      assert.equal((f.db.prepare('SELECT state FROM feishu_typing_reactions').get() as {state:string}).state, 'done');
    } finally { f.db.close(); }
  }
});

it('does not use a replacement application to clean an old application’s reaction', async () => {
  const f = fixture();
  try {
    f.receive(); await f.tick();
    f.accounts.upsertAccount({ appId: 'replacement', appSecret: 'new-fixture-secret', enabled: true });
    f.calls.length = 0; f.due(); await f.tick();
    assert.equal(f.calls.length, 0);
    assert.equal((f.db.prepare('SELECT reaction_id FROM feishu_typing_reactions').get() as {reaction_id:string}).reaction_id, 'own-reaction');
  } finally { f.db.close(); }
});

it('reconciles an uncertain DELETE instead of repeatedly deleting a reaction that is already gone', async () => {
  const f = fixture();
  try {
    f.receive(); await f.tick(); await f.finish();
    const request = f.io.fetch;
    let deletes = 0, lists = 0;
    f.io.fetch = async (input, init) => {
      if (init?.method === 'DELETE') { deletes++; throw new Error('response lost after deleting'); }
      if (String(input).includes('/reactions?')) lists++;
      return request(input, init);
    };
    f.due(); await f.tick(); f.due(); await f.tick();
    assert.equal(deletes, 1); assert.equal(lists, 1);
    assert.equal((f.db.prepare('SELECT state FROM feishu_typing_reactions').get() as {state:string}).state, 'done');
  } finally { f.db.close(); }
});

it('concurrent workers never add twice and shutdown cannot start a new reaction', async () => {
  const f = fixture();
  try {
    f.receive();
    const stopped = new AbortController(); stopped.abort();
    await f.worker().runOnce(stopped.signal);
    assert.equal(f.calls.length, 0);
    await Promise.all([f.tick(), f.tick(), f.tick()]);
    assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/reactions')).length, 1);
  } finally { f.db.close(); }
});

it('reopens the durable receipt after a Gateway restart and cleans without recreating the reaction', async () => {
  const f = fixture();
  const directory = mkdtempSync(join(tmpdir(), 'fb-typing-reopen-'));
  try {
    f.receive(); await f.tick(); await f.finish();
    const path = join(directory, 'state.db');
    await f.db.backup(path); f.db.close();
    const reopened = new Sqlite(path);
    try {
      reopened.prepare('UPDATE feishu_typing_reactions SET next_attempt_at=0').run();
      await new FeishuTypingWorker(reopened, f.user.id, f.key, f.io).runOnce(new AbortController().signal);
      assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1);
      assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.endsWith('/reactions')).length, 1);
      assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { reopened.close(); }
  } finally { if (f.db.open) f.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('keeps Typing while completed output awaits delivery and clears an approval notice after delivery', async () => {
  const f = fixture();
  try {
    f.receive(); await f.tick();
    const adopted = f.inbox.adoptNext(); assert.equal(adopted.status, 'adopted');
    if (adopted.status !== 'adopted') throw new Error('adoption failed');
    f.db.prepare("UPDATE copilot_runs SET status='completed' WHERE id=?").run(adopted.runId);
    f.due(); await f.tick();
    assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 0);
    await new NativeChannelDelivery(f.db, f.user.id, f.key, createFeishuNativeSender(f.db, f.user.id, f.key, f.io)).runOnce(new AbortController().signal);
    f.db.prepare("UPDATE channel_deliveries SET phase='approval:fixture'").run();
    f.due(); await f.tick();
    assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1);
  } finally { f.db.close(); }
});

it('disabled users cannot cause cleanup I/O and an already removed reaction is idempotent', async () => {
  for (const scenario of ['disabled-user', 'not-found'] as const) {
    const f = fixture();
    try {
      f.receive(); await f.tick(); await f.finish();
      f.calls.length = 0;
      if (scenario === 'disabled-user') f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);
      else {
        const request = f.io.fetch;
        f.io.fetch = async (input, init) => init?.method === 'DELETE' ? new Response('', { status: 404 }) : request(input, init);
      }
      f.due(); await f.tick();
      if (scenario === 'disabled-user') assert.equal(f.calls.length, 0);
      else assert.equal((f.db.prepare('SELECT state FROM feishu_typing_reactions').get() as {state:string}).state, 'done');
    } finally { f.db.close(); }
  }
});

it('cleans stopped/failed and stale processing without waiting forever for a text reply', async () => {
  for (const status of ['cancelled', 'failed', 'stale'] as const) {
    const f = fixture();
    try {
      f.receive(); await f.tick();
      const adopted = f.inbox.adoptNext(); assert.equal(adopted.status, 'adopted');
      if (status === 'stale') f.db.prepare('UPDATE feishu_typing_reactions SET created_at=0').run();
      else if (adopted.status === 'adopted') f.db.prepare('UPDATE copilot_runs SET status=? WHERE id=?').run(status, adopted.runId);
      f.due(); await f.tick();
      assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1, status);
    } finally { f.db.close(); }
  }
});

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

it('production runtime keeps delivering while a reaction POST is blocked, then cleans its late receipt', async () => {
  const f = fixture();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const request = f.io.fetch;
  let adding = false;
  f.io.fetch = async (input, init) => {
    if (String(input).endsWith('/reactions') && init?.method === 'POST') { adding = true; await blocked; }
    return request(input, init);
  };
  const runtime = createNativeFeishuRuntime(f.db, f.key, { ...f.io, sdkFactory: {
    createWebSocketClient: (_config, callbacks) => ({
      start: async () => { callbacks.onReady?.(); }, close: () => {},
      getConnectionStatus: () => ({ state: 'connected', reconnectAttempts: 0 })
    })
  } });
  try {
    f.receive(); await runtime.start();
    await until(() => adding);
    f.db.prepare("UPDATE copilot_runs SET status='completed' WHERE user_id=?").run(f.user.id);
    await until(() => Boolean(f.db.prepare("SELECT 1 FROM channel_deliveries WHERE status='delivered'").get()));
    assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 0);
    release(); await until(() => f.calls.some(c => c.method === 'DELETE'));
  } finally { release(); await runtime.stop(); f.db.close(); }
});
