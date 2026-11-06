import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { signJwt } from '../src/auth/jwt.js';
import { createNotificationRoutes } from '../src/routes/notifications.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { ChannelIdentityService } from '../src/services/channels/channel-identity-service.js';
import { NotificationRepository } from '../src/db/repositories/notification-repository.js';
import { NotificationService } from '../src/services/notification-service.js';
import { FeishuNotifications } from '../src/services/notifications/feishu-notifications.js';
import { TelegramNotifications } from '../src/services/notifications/telegram-notifications.js';
import { TelegramNotificationWorker } from '../src/services/notifications/telegram-notification-worker.js';
import type { TelegramBotApiIO } from '../src/services/integrations/telegram-bot-api.js';
import { createNativeFeishuRuntime } from '../src/services/channels/native-feishu-runtime.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
type Reply = () => Response | Promise<Response>;

function fixture() {
  const db = new Sqlite(':memory:'); migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create('owner@test.dev', 'fixture'), other = new UserRepository(db).create('other@test.dev', 'fixture');
  const key = randomBytes(32).toString('hex');
  const accounts = new TelegramChannelRepository(db, user.id, key);
  const account = accounts.upsertAccount({ botToken: '123456:fixture-token', botUsername: 'fb_bot', enabled: true });
  const integration = new TelegramIntegrationRepository(db, user.id);
  integration.upsertConfig({ enabled: true, emergencyDisabled: false });
  const identities = new ChannelIdentityService(db, user.id, key);
  const peer = { channel: 'telegram' as const, accountId: account.id, accountRevision: account.configRevision, externalUserId: '4242', chatId: '4242', chatType: 'p2p' as const };
  const pair = identities.createPairing({ channel: 'telegram', accountId: account.id }), claim = identities.claimPairing(pair.token, peer);
  const identity = identities.confirmPairing(claim.id, { revision: claim.revision, externalUserId: '4242', chatId: '4242' });
  const service = new TelegramNotifications(db, user.id), notifications = new NotificationRepository(db, user.id);
  const enable = (extra: Record<string, unknown> = {}) => service.update({ ...service.records.config(), enabled: true, targetId: `private:${identity.id}`, ...extra });
  const create = (type = 'task_completed', message = '已完成', sessionId?: string) => new NotificationService(db, user.id).create({
    type: 'session_notification', titleKey: 'notifications.taskCompleted', message, href: '/sessions/not-trusted',
    ...(sessionId ? { sessionId } : {}), payload: { notification_type: type, project_name: 'Project', session_name: 'Session', adapter: 'codex' },
  });
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const replies: Reply[] = [];
  const io: TelegramBotApiIO = { validate: async () => {}, fetch: async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return (replies.shift() ?? (() => Response.json({ ok: true, result: { message_id: 77 } })))();
  } };
  const worker = (custom: TelegramBotApiIO = io) => new TelegramNotificationWorker(db, user.id, key, custom).runOnce(new AbortController().signal);
  return { db, user, other, key, accounts, account, integration, identities, identity, service, notifications, enable, create, io, calls, replies, worker };
}
const latest = (f: ReturnType<typeof fixture>) => f.service.records.list()[0];

it('exposes an owner-only, disabled-by-default Telegram subscription over HTTP', async () => {
  const f = fixture();
  const secret = randomBytes(32).toString('hex');
  const app = express(); app.locals.db = f.db; app.locals.jwtSecret = secret; app.use(express.json());
  app.use('/notifications', createNotificationRoutes(f.db));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/notifications/telegram`;
  const request = (path: string, method = 'GET', body?: unknown, user = f.user) => fetch(url + path, {
    method, headers: { authorization: `Bearer ${signJwt({ userId: user.id, email: user.email }, secret)}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await fetch(url)).status, 401);
    const initial = await request('');
    assert.equal(initial.status, 200); assert.equal(initial.headers.get('cache-control'), 'no-store');
    const state = (await initial.json()).data;
    assert.equal(state.config.enabled, false); assert.deepEqual(state.config.types, ['attention', 'failure', 'completion']);
    assert.deepEqual(state.targets.map((t: { id: string }) => t.id), [`private:${f.identity.id}`]);
    const input = { ...f.service.records.config(), enabled: true, targetId: `private:${f.identity.id}` };
    const foreign = await request('', 'PUT', input, f.other);
    assert.equal(foreign.status, 409); assert.equal((await foreign.json()).details.code, 'TARGET_INVALID');
    assert.equal((await request('', 'PUT', { ...input, chatId: 'arbitrary' })).status, 400);
    for (const webBaseUrl of ['not a URL', 'https://user:pass@example.com', 'javascript:alert(1)']) {
      const invalid = await request('', 'PUT', { ...input, webBaseUrl });
      assert.equal(invalid.status, 400); assert.equal((await invalid.json()).details.code, 'WEB_URL_INVALID');
    }
    assert.equal((await request('', 'PUT', { ...input, types: [] })).status, 409);
    const saved = await request('', 'PUT', input);
    assert.equal(saved.status, 200); assert.equal((await saved.json()).data.config.revision, 1);
    assert.equal((await request('', 'PUT', input)).status, 409, 'stale revision is a conflict');
    assert.equal((await request('/test', 'POST', { requestId: randomUUID(), text: 'arbitrary' })).status, 400);
    const body = { requestId: randomUUID() };
    const first = await request('/test', 'POST', body);
    assert.equal(first.status, 202);
    assert.deepEqual((await (await request('/test', 'POST', body)).json()).data, (await first.json()).data);
    const own = (await (await request('/deliveries')).json()).data.deliveries;
    assert.equal(own.length, 1); assert.deepEqual(Object.keys(own[0]).sort(), ['createdAt', 'errorCode', 'id', 'status', 'type']);
    assert.deepEqual((await (await request('/deliveries', 'GET', undefined, f.other)).json()).data.deliveries, []);
    assert.deepEqual((await (await request('', 'GET', undefined, f.other)).json()).data.targets, []);
    f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id);
    assert.equal((await request('/test', 'POST', { requestId: randomUUID() })).status, 401);
  } finally { await new Promise<void>(r => server.close(() => r())); f.db.close(); }
});

it('delivers a plain-text message to the paired private chat without a remote route', async () => {
  const f = fixture(); try {
    f.enable({ webBaseUrl: 'https://forge.example.com/' });
    f.create('task_completed', '已完成 <b>bold</b>', '58999b1a-1234-4321-9876-123456789abc');
    await f.worker();
    assert.equal(f.calls.length, 1);
    const sent = f.calls[0]!;
    assert.match(sent.url, /\/bot123456:fixture-token\/sendMessage$/);
    assert.equal(sent.body.chat_id, '4242'); assert.equal(sent.body.parse_mode, undefined);
    const text = String(sent.body.text);
    assert.match(text, /^ForgeBadger · 回复结束\n/);
    assert.match(text, /<b>bold<\/b>/, 'markup stays literal because parse_mode is never set');
    assert.match(text, /查看会话：https:\/\/forge\.example\.com\/sessions\/58999b1a-1234-4321-9876-123456789abc$/);
    assert.equal(latest(f)?.status, 'delivered');
    assert.equal((f.db.prepare('SELECT provider_message_id FROM telegram_notification_deliveries').get() as { provider_message_id: string }).provider_message_id, '77');
    assert.equal(f.identities.records.listRoutes().length, 0);
  } finally { f.db.close(); }
});

it('redacts secrets and bounds message size before sending', async () => {
  const f = fixture(); try {
    f.enable();
    f.create('task_failed', '失败 sk-SECRET12345678 Bearer secret-token ' + '甲'.repeat(5000));
    await f.worker();
    const text = String(f.calls[0]!.body.text);
    assert.doesNotMatch(text, /SECRET12345678|secret-token/);
    assert.ok(text.length < 4096, 'stays within one Telegram message');
  } finally { f.db.close(); }
});

it('filters event types, never backfills, and runs independently of Feishu', () => {
  const f = fixture(); try {
    f.create(); assert.equal(f.service.records.list().length, 0);
    f.enable({ types: ['failure'] });
    for (const type of ['task_completed', 'attention', 'permission_prompt', 'session_ended', 'invented']) f.create(type);
    f.create('task_failed'); f.create('permission_denied');
    assert.equal(f.service.records.list().length, 2);
    assert.ok(f.service.records.list().every(d => d.event_type === 'failure'));
    assert.equal(new FeishuNotifications(f.db, f.user.id).records.list().length, 0);
    assert.equal(new TelegramNotifications(f.db, f.other.id).records.list().length, 0);
  } finally { f.db.close(); }
});

it('foreign and revoked targets never block local notification persistence', () => {
  const f = fixture(); try {
    assert.throws(() => new TelegramNotifications(f.db, f.other.id).update({ ...f.service.records.config(), enabled: true, targetId: `private:${f.identity.id}` }), /TARGET_INVALID/);
    assert.throws(() => f.enable({ targetId: 'group:anything' }), /TARGET_INVALID/);
    f.enable(); f.identities.revokeIdentity(f.identity.id); f.create();
    assert.equal(f.notifications.list().length, 1); assert.equal(f.service.records.list().length, 0);
  } finally { f.db.close(); }
});

it('re-checks authority at send time and cancels instead of redirecting', async () => {
  const cases: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ['IDENTITY_INVALID', f => f.identities.revokeIdentity(f.identity.id)],
    ['CHANNEL_DISABLED', f => f.integration.upsertConfig({ emergencyDisabled: true })],
    ['ACCOUNT_CHANGED', f => f.accounts.upsertAccount({ botToken: '123456:rotated-token', enabled: true })],
    ['NOTIFICATION_REMOVED', f => f.notifications.clearAll()],
    ['USER_DISABLED', f => f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id)],
  ];
  for (const [code, mutate] of cases) {
    const f = fixture(); try {
      f.enable(); f.create(); mutate(f); await f.worker();
      assert.equal(f.calls.length, 0, code); assert.equal(latest(f)?.status, 'cancelled', code); assert.equal(latest(f)?.error_code, code);
    } finally { f.db.close(); }
  }
  const f = fixture(); try {
    f.enable(); f.create();
    f.service.update({ ...f.service.records.config(), types: ['failure'] });
    assert.equal(latest(f)?.error_code, 'SUBSCRIPTION_CHANGED'); await f.worker(); assert.equal(f.calls.length, 0);
  } finally { f.db.close(); }
});

it('fences a send when the subscription changes during endpoint validation', async () => {
  const f = fixture(); try {
    f.enable(); f.create();
    await f.worker({ ...f.io, validate: async () => { f.integration.upsertConfig({ emergencyDisabled: true }); } });
    assert.equal(f.calls.length, 0); assert.equal(latest(f)?.status, 'cancelled'); assert.equal(latest(f)?.error_code, 'CHANNEL_DISABLED');
  } finally { f.db.close(); }
});

it('maps Telegram outcomes to retry, failure and uncertain without resending', async () => {
  const f = fixture(); try {
    f.enable(); f.create();
    f.replies.push(() => Response.json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } }, { status: 429 }));
    const before = Date.now(); await f.worker();
    const retried = latest(f)!;
    assert.equal(retried.status, 'pending'); assert.equal(retried.error_code, 'RETRY_SCHEDULED'); assert.ok(retried.next_attempt_at >= before + 7000);
    f.db.prepare('UPDATE telegram_notification_deliveries SET next_attempt_at=0').run();
    f.replies.push(() => Response.json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, { status: 403 }));
    await f.worker();
    assert.equal(latest(f)?.status, 'failed'); assert.equal(latest(f)?.error_code, 'SEND_REJECTED');
  } finally { f.db.close(); }
  for (const reply of [() => { throw new TypeError('socket hang up'); }, () => Response.json({ ok: false, error_code: 502, description: 'Bad Gateway' }, { status: 502 })] as Reply[]) {
    const g = fixture(); try {
      g.enable(); g.create(); g.replies.push(reply); await g.worker();
      assert.equal(latest(g)?.status, 'unknown'); assert.equal(latest(g)?.error_code, 'SEND_UNCERTAIN');
      await g.worker(); assert.equal(g.calls.length, 1, 'an uncertain send is never retried');
    } finally { g.db.close(); }
  }
});

it('the production channel runtime drains Telegram notifications', async () => {
  const f = fixture();
  const runtime = createNativeFeishuRuntime(f.db, f.key, {
    ...f.io,
    sdkFactory: { createWebSocketClient: (_config, callbacks) => ({
      start: async () => { callbacks.onReady?.(); }, close: () => {},
      getConnectionStatus: () => ({ state: 'connected', reconnectAttempts: 0 }),
    }) },
  });
  try {
    f.enable(); f.create();
    await runtime.start();
    const deadline = Date.now() + 5000;
    while (latest(f)?.status !== 'delivered' && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    assert.equal(latest(f)?.status, 'delivered');
    assert.equal(f.calls.filter(call => call.url.endsWith('/sendMessage')).length, 1);
  } finally { await runtime.stop(); f.db.close(); }
});

it('migration creates tenant-scoped tables with status and source constraints', () => {
  const f = fixture(); try {
    assert.throws(() => f.db.prepare("INSERT INTO telegram_notification_deliveries(id,user_id,event_type,subscription_revision,identity_revision,expires_at,created_at,status,test_key) VALUES('x',?, 'test',1,1,1,1,'bogus','k')").run(f.user.id), /CHECK/);
    assert.throws(() => f.db.prepare("INSERT INTO telegram_notification_deliveries(id,user_id,event_type,subscription_revision,identity_revision,expires_at,created_at) VALUES('y',?, 'test',1,1,1,1)").run(f.user.id), /CHECK/);
    f.enable(); f.db.prepare('DELETE FROM users WHERE id=?').run(f.user.id);
    assert.equal((f.db.prepare('SELECT count(*) n FROM telegram_notification_settings').get() as { n: number }).n, 0);
  } finally { f.db.close(); }
});

it('never claims, cancels or finishes another tenant\'s queued deliveries', async () => {
  const f = fixture(); try {
    f.enable(); f.create();
    const foreign = new TelegramNotifications(f.db, f.other.id).records;
    assert.equal(foreign.claim(), undefined);
    foreign.cancelPending('SUBSCRIPTION_CHANGED');
    assert.equal(latest(f)?.status, 'pending');
    await new TelegramNotificationWorker(f.db, f.other.id, f.key, f.io).runOnce(new AbortController().signal);
    assert.equal(f.calls.length, 0); assert.equal(latest(f)?.status, 'pending');
    await f.worker(); assert.equal(latest(f)?.status, 'delivered');
  } finally { f.db.close(); }
});

it('bounds 429 retries and fails after five attempts', async () => {
  const f = fixture(); try {
    f.enable(); f.create();
    for (let attempt = 1; attempt <= 5; attempt++) {
      f.replies.push(() => Response.json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } }, { status: 429 }));
      await f.worker();
      f.db.prepare('UPDATE telegram_notification_deliveries SET next_attempt_at=0').run();
    }
    assert.equal(latest(f)?.status, 'failed'); assert.equal(latest(f)?.error_code, 'RETRY_EXHAUSTED'); assert.equal(f.calls.length, 5);
  } finally { f.db.close(); }
});
