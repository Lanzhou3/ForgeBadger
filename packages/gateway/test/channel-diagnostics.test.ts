import assert from 'node:assert/strict';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { createServer as httpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

import { UserRepository } from '../src/db/repositories/user-repository.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from '../src/services/channels/channel-identity-service.js';
import { NativeChannelInbox } from '../src/services/channels/native-channel-inbox.js';
import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { createServer } from '../src/server.js';
import { signJwt } from '../src/auth/jwt.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { RuntimeAuthorizationInvalidator } from '../src/services/runtime-authorization-invalidation.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

function fixture() {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create('diagnostics@test.dev', 'fixture');
  const key = randomBytes(32).toString('hex');
  const accounts = new FeishuChannelRepository(db, user.id, key);
  const config = new FeishuIntegrationRepository(db, user.id);
  const telegramAccounts = new TelegramChannelRepository(db, user.id, key);
  const telegramConfig = new TelegramIntegrationRepository(db, user.id);
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'p', path: '/private/tmp/diagnostics-project', aiTool: 'claude' });
  const service = new ChannelIdentityService(db, user.id, key);
  const models = new ModelProviderRepository(db, user.id, key);
  return { db, user, key, accounts, config, telegramAccounts, telegramConfig, projects, project, service, models };
}

type Check = { key: string; ok: boolean; detail: string; fixHint: string };
type Checks = Record<string, Check>;

async function serve(f: ReturnType<typeof fixture>) {
  const jwtSecret = randomBytes(32).toString('hex');
  const app = createServer({ db: f.db, masterKey: f.key, jwtSecret,
    sessionManager: {} as InMemorySessionManager, apiKeyStore: new InMemoryApiKeyStore({ masterKey: f.key }),
    eventBus: new ForgeBadgerEventBus(), runtimeAuthorizationInvalidator: new RuntimeAuthorizationInvalidator() });
  const server = httpServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/channels`;
  const request = (path: string, userId = f.user.id) => fetch(base + path, {
    headers: { Authorization: `Bearer ${signJwt({ userId, email: 'fixture@test.dev' }, jwtSecret)}` }
  });
  const checks = async (path: string, userId = f.user.id): Promise<Checks> => {
    const response = await request(path, userId);
    assert.equal(response.status, 200);
    const data = (await response.json()).data as { channel: string; generatedAt: number; checks: Check[] };
    return Object.fromEntries(data.checks.map(check => [check.key, check]));
  };
  return { server, request, checks };
}

function pairFeishu(f: ReturnType<typeof fixture>) {
  const account = f.accounts.upsertAccount({ appId: 'diag', appSecret: randomBytes(24).toString('hex'), enabled: true });
  f.config.upsertConfig({ enabled: true, emergencyDisabled: false });
  const peer: TrustedChannelPeer = { channel: 'feishu', accountId: account.id, accountRevision: account.configRevision, externalUserId: 'ou-owner', chatId: 'oc-private', chatType: 'p2p' };
  const issued = f.service.createPairing({ channel: 'feishu', accountId: account.id });
  const claimed = f.service.claimPairing(issued.token, peer);
  const identity = f.service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: peer.externalUserId, chatId: peer.chatId });
  const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
  f.projects.setCopilotAutonomy(f.project.id, true);
  return { account, peer, identity, route };
}

function seedModel(f: ReturnType<typeof fixture>): ModelProviderRepository {
  const provider = f.models.createProviderProfile({ name: 'fixture', providerKey: 'fixture', baseUrl: 'https://8.8.8.8', apiFormat: 'openai', authType: 'api_key', supportedAdapters: ['opencode'] });
  f.models.createCredential({ providerProfileId: provider.id, label: 'fixture', plaintextSecret: 'fixture-key' });
  f.models.createModelProfile({ providerProfileId: provider.id, name: 'fixture', modelId: 'fixture', capabilities: ['chat'], isDefault: true });
  return f.models;
}

it('rejects unauthenticated and unknown-channel diagnostics requests', async () => {
  const f = fixture();
  const { server, request } = await serve(f);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/channels`;
    assert.equal((await fetch(base + '/feishu/diagnostics')).status, 401);
    assert.equal((await request('/discord/diagnostics')).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

it('reports every check with an actionable fix hint when nothing is configured', async () => {
  const f = fixture();
  const { server, checks, request } = await serve(f);
  try {
    const response = await request('/telegram/diagnostics');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const all = await checks('/telegram/diagnostics');
    assert.deepEqual(Object.keys(all), ['credentials', 'connection', 'identity', 'route', 'model', 'delivery']);
    for (const check of Object.values(all)) {
      assert.equal(check.ok, false, `${check.key} should fail on an empty setup`);
      assert.ok(check.fixHint.length > 0, `${check.key} must carry a fix hint`);
    }
    assert.match(all.credentials!.fixHint, /Bot Token/);
    assert.match(all.connection!.fixHint, /Bot Token/);
    assert.match(all.identity!.fixHint, /\/pair <配对码>/);
    assert.match(all.route!.fixHint, /启用远程操作/);
    assert.match(all.model!.fixHint, /Model Center/);
    assert.match(all.delivery!.fixHint, /Bot Token/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

it('returns all-green diagnostics for a fully wired channel', async () => {
  const f = fixture();
  const { account, peer } = pairFeishu(f);
  f.accounts.updateAccountHealth(account.id, { state: 'connected', lastConnectedAt: new Date() });
  seedModel(f);
  const inbox = new NativeChannelInbox(f.db, f.user.id, f.key);
  const stored = inbox.receive(peer, { eventId: 'diag-1', messageId: 'diag-m1', text: 'ping' });
  const adopted = inbox.adoptNext();
  assert.equal(adopted.status, 'adopted');
  if (adopted.status === 'adopted') {
    const ledger = new CopilotRunLedger(f.db, f.user.id);
    const claim = ledger.claim(adopted.runId, 'owner', 30_000)!;
    ledger.finish(claim, 'completed');
  }
  new NativeChannelDelivery(f.db, f.user.id, f.key, async () => ({ status: 'delivered', messageId: 'om-done' })).project();
  const worker = new NativeChannelDelivery(f.db, f.user.id, f.key, async input => { input.authorize(); return { status: 'delivered', messageId: 'om-done' }; });
  await worker.runOnce(new AbortController().signal);

  const { server, checks } = await serve(f);
  try {
    const all = await checks('/feishu/diagnostics');
    for (const check of Object.values(all)) {
      assert.equal(check.ok, true, `${check.key} should pass: ${check.detail}`);
      assert.equal(check.fixHint, '');
    }
    assert.match(all.connection!.detail, /connected/);
    assert.match(all.identity!.detail, /ou-owner/);
    assert.match(all.model!.detail, /fixture/);
    assert.match(all.delivery!.detail, /delivered/);
    assert.ok(stored.id);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

it('surfaces stale identity and an autonomy-off route with targeted fix hints', async () => {
  const f = fixture();
  const { account, route } = pairFeishu(f);
  f.accounts.updateAccountHealth(account.id, { state: 'connected', lastConnectedAt: new Date() });
  seedModel(f);

  let { server, checks } = await serve(f);
  let all: Checks;
  try {
    all = await checks('/feishu/diagnostics');
    assert.equal(all.identity!.ok, true);
    assert.equal(all.route!.ok, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  // Re-saving credentials bumps the revision and silently invalidates identity and route.
  f.accounts.upsertAccount({ appId: 'diag', enabled: true });
  f.accounts.updateAccountHealth(account.id, { state: 'connected', lastConnectedAt: new Date() });
  ({ server, checks } = await serve(f));
  try {
    all = await checks('/feishu/diagnostics');
    assert.equal(all.credentials!.ok, true);
    assert.equal(all.identity!.ok, false);
    assert.match(all.identity!.detail, /配置版本不匹配/);
    assert.match(all.identity!.fixHint, /\/pair <配对码>/);
    assert.equal(all.route!.ok, false);
    assert.match(all.route!.detail, /重新绑定/);
    assert.match(all.route!.fixHint, /重新绑定渠道授权/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  // Turning off the project's Copilot autonomy invalidates the route even when identity and revision match.
  f.service.revokeRoute(route.id);
  const fresh = pairFeishu(f);
  f.projects.setCopilotAutonomy(f.project.id, false);
  assert.throws(() => f.service.admit(fresh.route.id, fresh.peer));
  ({ server, checks } = await serve(f));
  try {
    all = await checks('/feishu/diagnostics');
    assert.equal(all.route!.ok, false);
    assert.match(all.route!.detail, /未开启 Copilot 自治/);
    assert.match(all.route!.fixHint, /开启该项目的 Copilot 自治/);
    assert.equal(fresh.route.status, 'active');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

it('distinguishes unhealthy connections, disabled models and failed deliveries', async () => {
  const f = fixture();
  const { account, peer } = pairFeishu(f);
  f.accounts.updateAccountHealth(account.id, { state: 'unhealthy', errorMessage: 'token invalid' });
  const provider = f.models.createProviderProfile({ name: 'fixture', providerKey: 'fixture', baseUrl: 'https://8.8.8.8', apiFormat: 'openai', authType: 'api_key', supportedAdapters: ['opencode'] });
  f.models.createCredential({ providerProfileId: provider.id, label: 'fixture', plaintextSecret: 'fixture-key' });
  f.models.createModelProfile({ providerProfileId: provider.id, name: 'fixture', modelId: 'fixture', capabilities: ['chat'], isDefault: true });
  f.db.prepare("UPDATE model_profiles SET status='disabled' WHERE user_id=?").run(f.user.id);
  const inbox = new NativeChannelInbox(f.db, f.user.id, f.key);
  inbox.receive(peer, { eventId: 'diag-2', messageId: 'diag-m2', text: 'ping' });
  const adopted = inbox.adoptNext();
  assert.equal(adopted.status, 'adopted');
  if (adopted.status === 'adopted') {
    const ledger = new CopilotRunLedger(f.db, f.user.id);
    const claim = ledger.claim(adopted.runId, 'owner', 30_000)!;
    ledger.finish(claim, 'completed');
  }
  new NativeChannelDelivery(f.db, f.user.id, f.key, async () => ({ status: 'failed' })).project();
  const worker = new NativeChannelDelivery(f.db, f.user.id, f.key, async input => { input.authorize(); return { status: 'failed' }; });
  await worker.runOnce(new AbortController().signal);

  const { server, checks } = await serve(f);
  try {
    const all = await checks('/feishu/diagnostics');
    assert.equal(all.connection!.ok, false);
    assert.match(all.connection!.detail, /unhealthy/);
    assert.match(all.connection!.fixHint, /飞书开放平台/);
    assert.equal(all.model!.ok, false);
    assert.match(all.model!.detail, /已停用/);
    assert.match(all.model!.fixHint, /启用该模型/);
    assert.equal(all.delivery!.ok, false);
    assert.match(all.delivery!.detail, /failed/);
    assert.match(all.delivery!.fixHint, /发送失败/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

it('keeps channel diagnostics isolated per platform', async () => {
  const f = fixture();
  f.telegramAccounts.upsertAccount({ botToken: 'tg-token', botUsername: 'fb_bot', enabled: true });
  f.telegramConfig.upsertConfig({ enabled: true, emergencyDisabled: false });
  const { server, checks } = await serve(f);
  try {
    const feishu = await checks('/feishu/diagnostics');
    assert.equal(feishu.credentials!.ok, false);
    assert.match(feishu.credentials!.detail, /飞书/);
    assert.doesNotMatch(JSON.stringify(feishu), /tg-token/);
    const telegram = await checks('/telegram/diagnostics');
    assert.equal(telegram.credentials!.ok, true);
    assert.equal(telegram.connection!.ok, false);
    assert.match(telegram.connection!.fixHint, /long polling/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    f.db.close();
  }
});

it('surfaces AGENT_NO_MODEL and generic failure categories in channel replies', async () => {
  const f = fixture();
  const account = f.accounts.upsertAccount({ appId: 'diag', appSecret: randomBytes(24).toString('hex'), enabled: true });
  f.config.upsertConfig({ enabled: true, emergencyDisabled: false });
  const peer: TrustedChannelPeer = { channel: 'feishu', accountId: account.id, accountRevision: account.configRevision, externalUserId: 'ou-owner', chatId: 'oc-private', chatType: 'p2p' };
  const issued = f.service.createPairing({ channel: 'feishu', accountId: account.id });
  const claimed = f.service.claimPairing(issued.token, peer);
  const identity = f.service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: peer.externalUserId, chatId: peer.chatId });
  f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
  f.projects.setCopilotAutonomy(f.project.id, true);

  const failWith = async (reason: string): Promise<string> => {
    const inbox = new NativeChannelInbox(f.db, f.user.id, f.key);
    inbox.receive(peer, { eventId: `evt-${reason}`, messageId: `msg-${reason}`, text: 'run' });
    const adopted = inbox.adoptNext();
    assert.equal(adopted.status, 'adopted');
    if (adopted.status !== 'adopted') throw new Error('fixture');
    const ledger = new CopilotRunLedger(f.db, f.user.id);
    const claim = ledger.claim(adopted.runId, 'owner', 30_000)!;
    ledger.finish(claim, 'failed', reason);
    let sent = '';
    const worker = new NativeChannelDelivery(f.db, f.user.id, f.key, async input => { input.authorize(); sent = input.text; return { status: 'delivered', messageId: 'om' }; });
    worker.project();
    await worker.runOnce(new AbortController().signal);
    return sent;
  };

  try {
    assert.equal(await failWith('AGENT_NO_MODEL'), '任务失败：尚未配置模型，请先在 Web 控制台的 Model Center 配置模型提供商。');
    assert.equal(await failWith('AGENT_PROVIDER_INACTIVE'), '任务失败：AGENT_PROVIDER_INACTIVE，请在 Web Copilot 查看详情。');
    assert.equal(await failWith('socket hang up'), '任务失败：执行错误，请在 Web Copilot 查看详情。');
  } finally { f.db.close(); }
});
