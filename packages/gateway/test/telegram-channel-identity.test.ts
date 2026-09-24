import assert from 'node:assert/strict';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { UserRepository } from '../src/db/repositories/user-repository.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from '../src/services/channels/channel-identity-service.js';
import { NativeChannelInbox, createFeishuNativeIngress, createTelegramNativeIngress } from '../src/services/channels/native-channel-inbox.js';
import { decryptSecret, type EncryptedSecret } from '../src/crypto/secret-box.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

function fixture() {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder });
  const user = new UserRepository(db).create('telegram-channel@test.dev', 'fixture');
  const other = new UserRepository(db).create('other@test.dev', 'fixture');
  const key = randomBytes(32).toString('hex');

  const feishuAccounts = new FeishuChannelRepository(db, user.id, key);
  const feishuAccount = feishuAccounts.upsertAccount({ appId: 'fixture', appSecret: randomBytes(24).toString('hex'), enabled: true });
  const feishuConfig = new FeishuIntegrationRepository(db, user.id);
  feishuConfig.upsertConfig({ enabled: true, emergencyDisabled: false });

  const telegramAccounts = new TelegramChannelRepository(db, user.id, key);
  const telegramAccount = telegramAccounts.upsertAccount({ botToken: 'tg-token', botUsername: 'fb_bot', enabled: true });
  const telegramConfig = new TelegramIntegrationRepository(db, user.id);
  telegramConfig.upsertConfig({ enabled: true, emergencyDisabled: false });

  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'p', path: '/private/tmp/tg-channel-project', aiTool: 'claude' });
  // Channel admission requires the project-level Copilot autonomy switch; the
  // flow tests run with it enabled and the dedicated switch tests toggle it.
  projects.setCopilotAutonomy(project.id, true);
  const service = new ChannelIdentityService(db, user.id, key);
  const pair = (channel: 'feishu' | 'telegram', accountId: string, accountRevision: number, externalUserId: string, chatId: string) => {
    const peer: TrustedChannelPeer = { channel, accountId, accountRevision, externalUserId, chatId, chatType: 'p2p' };
    const issued = service.createPairing({ channel, accountId });
    const claimed = service.claimPairing(issued.token, peer);
    const identity = service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId, chatId });
    return { peer, identity };
  };
  return { db, user, other, key, feishuAccounts, feishuAccount, feishuConfig, telegramAccounts, telegramAccount, telegramConfig, projects, project, service, pair };
}

it('completes the telegram pairing, confirmation, routing and admission flow', () => {
  const f = fixture();
  try {
    const { peer, identity } = f.pair('telegram', f.telegramAccount.id, f.telegramAccount.configRevision, 'tg-owner', 'tg-private');
    assert.equal(identity.channel, 'telegram');
    assert.equal(identity.status, 'active');
    const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    const admitted = f.service.admit(route.id, peer, { capability: 'project.update', projectIds: [f.project.id] });
    assert.equal(admitted.conversationId, route.conversationId);
    assert.throws(() => f.service.admit(route.id, peer, { capability: 'project.update', projectIds: ['foreign'] }), /CHANNEL_AUTHORITY_REJECTED/);
    const actions = f.db.prepare("SELECT action FROM audit_logs WHERE resource_type='channel_authority'").all().map(row => (row as { action: string }).action);
    assert.ok(actions.includes('channel.pairing.create') && actions.includes('channel.pairing.claim')
      && actions.includes('channel.identity.confirm') && actions.includes('channel.route.create'));
  } finally { f.db.close(); }
});

it('isolates channels: a telegram peer cannot claim a feishu pairing and vice versa', () => {
  const f = fixture();
  try {
    const issued = f.service.createPairing({ channel: 'feishu', accountId: f.feishuAccount.id });
    const telegramPeer: TrustedChannelPeer = { channel: 'telegram', accountId: f.telegramAccount.id, accountRevision: f.telegramAccount.configRevision, externalUserId: 'tg-owner', chatId: 'tg-private', chatType: 'p2p' };
    assert.throws(() => f.service.claimPairing(issued.token, telegramPeer));
    const feishuPeer: TrustedChannelPeer = { channel: 'feishu', accountId: f.feishuAccount.id, accountRevision: f.feishuAccount.configRevision, externalUserId: 'ou-owner', chatId: 'oc-private', chatType: 'p2p' };
    const telegramIssued = f.service.createPairing({ channel: 'telegram', accountId: f.telegramAccount.id });
    assert.throws(() => f.service.claimPairing(telegramIssued.token, feishuPeer));
    assert.equal(f.service.records.listIdentities().length, 0);
  } finally { f.db.close(); }
});

it('admits a whitelisted, mentioned group peer and rejects every other group shape', () => {
  const f = fixture();
  try {
    const { peer, identity } = f.pair('telegram', f.telegramAccount.id, f.telegramAccount.configRevision, 'tg-owner', 'tg-private');
    const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    const groupPeer: TrustedChannelPeer = { ...peer, chatId: 'tg-group', chatType: 'group', mentionedBot: true };

    // Empty allowlist rejects every group (opposite of the p2p "empty = unrestricted" rule).
    assert.throws(() => f.service.admit(route.id, groupPeer));
    f.telegramConfig.upsertConfig({ allowedChatIds: ['tg-group'] });
    assert.ok(f.service.admit(route.id, groupPeer));

    // Non-whitelisted group, foreign sender, strict p2p chatId and missing mention are all rejected.
    assert.throws(() => f.service.admit(route.id, { ...groupPeer, chatId: 'tg-other-group' }));
    assert.throws(() => f.service.admit(route.id, { ...groupPeer, externalUserId: 'imposter' }));
    assert.throws(() => f.service.admit(route.id, { ...peer, chatId: 'tg-group' }));
    assert.throws(() => f.service.admit(route.id, { ...groupPeer, mentionedBot: false } as unknown as TrustedChannelPeer));

    // Removing the group from the allowlist fences admission immediately.
    f.telegramConfig.upsertConfig({ allowedChatIds: [] });
    assert.throws(() => f.service.admit(route.id, groupPeer));
  } finally { f.db.close(); }
});

it('routes and adopts a whitelisted group message end to end without touching the p2p flow', () => {
  const f = fixture();
  try {
    const { peer, identity } = f.pair('feishu', f.feishuAccount.id, f.feishuAccount.configRevision, 'ou-owner', 'oc-private');
    const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    f.feishuConfig.upsertConfig({ allowedChatIds: ['oc-group'] });
    const inbox = new NativeChannelInbox(f.db, f.user.id, f.key);
    const groupPeer: TrustedChannelPeer = { ...peer, chatId: 'oc-group', chatType: 'group', mentionedBot: true };
    const stored = inbox.receive(groupPeer, { eventId: 'group-event', messageId: 'group-message', text: '请检查进度' });
    const row = f.db.prepare('SELECT payload_encrypted FROM channel_messages WHERE id = ?').get(stored.id) as { payload_encrypted: string };
    const payload = JSON.parse(decryptSecret(JSON.parse(row.payload_encrypted) as EncryptedSecret, { key: f.key })) as { peer: TrustedChannelPeer; text: string };
    assert.equal(payload.text, '请检查进度');
    assert.equal(payload.peer.chatType, 'group');
    assert.equal(payload.peer.chatId, 'oc-group');
    const adopted = inbox.adoptNext();
    assert.equal(adopted.status, 'adopted');
    assert.equal(f.service.records.peerRoute(groupPeer)?.id, route.id);
  } finally { f.db.close(); }
});

it('feishu ingress admits a mentioned group message with the mention stripped and ignores the rest', () => {
  const f = fixture();
  try {
    const { identity } = f.pair('feishu', f.feishuAccount.id, f.feishuAccount.configRevision, 'ou-owner', 'oc-private');
    f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    f.feishuConfig.upsertConfig({ allowedChatIds: ['oc-group'] });
    const handle = createFeishuNativeIngress({ db: f.db, userId: f.user.id, masterKey: f.key, accountId: f.feishuAccount.id, accountRevision: f.feishuAccount.configRevision });
    const event = (text: string, chatType = 'group', mentions: unknown[] = []) => ({
      sender: { sender_id: { open_id: 'ou-owner' } },
      message: { message_id: 'group-msg', chat_id: 'oc-group', chat_type: chatType, message_type: 'text', mentions, content: JSON.stringify({ text }) }
    });
    const mentioned = handle(event('@_user_1 请检查进度', 'group', [{ id: { open_id: 'bot-open-id' }, name: 'Bot' }]), { botOpenId: 'bot-open-id' });
    assert.equal(mentioned.status, 'admitted');
    if (mentioned.status === 'admitted') {
      const row = f.db.prepare('SELECT payload_encrypted FROM channel_messages WHERE id = ?').get(mentioned.id) as { payload_encrypted: string };
      const payload = JSON.parse(decryptSecret(JSON.parse(row.payload_encrypted) as EncryptedSecret, { key: f.key })) as { peer: TrustedChannelPeer; text: string };
      assert.equal(payload.text, '请检查进度');
      assert.equal(payload.peer.chatType, 'group');
    }
    assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as { n: number }).n, 1);

    // No mention, thread replies and pairing attempts in a group stay out of the inbox.
    assert.equal(handle(event('没人提到机器人'), { botOpenId: 'bot-open-id' }).status, 'ignored');
    const threaded = { sender: { sender_id: { open_id: 'ou-owner' } }, message: { message_id: 'thread-msg', chat_id: 'oc-group', chat_type: 'group', message_type: 'text', thread_id: 'om-thread', mentions: [{ id: { open_id: 'bot-open-id' } }], content: JSON.stringify({ text: '@_user_1 话题回复' }) } };
    assert.equal(handle(threaded, { botOpenId: 'bot-open-id' }).status, 'ignored');
    const issued = f.service.createPairing({ channel: 'feishu', accountId: f.feishuAccount.id });
    assert.equal(handle(event(`/pair ${issued.token}`, 'group', [{ id: { open_id: 'bot-open-id' }, name: 'Bot' }]), { botOpenId: 'bot-open-id' }).status, 'ignored');
    assert.equal(f.service.records.pairing(issued.pairing.id)?.status, 'pending');
    assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as { n: number }).n, 1);
  } finally { f.db.close(); }
});

it('telegram ingress admits private and mentioned group messages and ignores everything else', () => {
  const f = fixture();
  try {
    const { peer } = f.pair('telegram', f.telegramAccount.id, f.telegramAccount.configRevision, 'tg-owner', 'tg-private');
    const identity = f.service.records.listIdentities().find(i => i.channel === 'telegram')!;
    f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    // The legacy allowlist gates p2p chats when non-empty, so whitelist the private chat alongside the group.
    f.telegramConfig.upsertConfig({ allowedChatIds: ['tg-private', 'tg-group'] });
    const handle = createTelegramNativeIngress({ db: f.db, userId: f.user.id, masterKey: f.key, accountId: f.telegramAccount.id, accountRevision: f.telegramAccount.configRevision });
    const event = (overrides: Record<string, unknown>) => ({ kind: 'message', eventId: 'tg:1', messageId: 'tg-m1', chatId: peer.chatId, chatType: 'p2p', senderId: 'tg-owner', text: 'hello', mentionedBot: false, ...overrides });

    const privateResult = handle(event({ eventId: 'tg:1', messageId: 'tg-m1' }));
    assert.equal(privateResult.status, 'admitted');

    const groupResult = handle(event({ eventId: 'tg:2', messageId: 'tg-m2', chatId: 'tg-group', chatType: 'group', text: '@fb_bot 群里的请求', mentionedBot: true }));
    assert.equal(groupResult.status, 'admitted');
    if (groupResult.status === 'admitted') {
      const row = f.db.prepare('SELECT payload_encrypted FROM channel_messages WHERE id = ?').get(groupResult.id) as { payload_encrypted: string };
      const payload = JSON.parse(decryptSecret(JSON.parse(row.payload_encrypted) as EncryptedSecret, { key: f.key })) as { peer: TrustedChannelPeer; text: string };
      assert.equal(payload.text, '群里的请求');
      assert.equal(payload.peer.chatType, 'group');
      assert.equal(payload.peer.channel, 'telegram');
    }

    assert.equal(handle(event({ eventId: 'tg:3', messageId: 'tg-m3', chatId: 'tg-group', chatType: 'group', text: '没有提及机器人', mentionedBot: false })).status, 'ignored');
    assert.equal(handle(event({ eventId: 'tg:4', messageId: 'tg-m4', chatId: 'tg-group', chatType: 'group', text: '@fb_bot ', mentionedBot: true })).status, 'ignored');
    assert.equal(handle({ kind: 'edited_message', eventId: 'tg:5' }).status, 'ignored');

    const issued = f.service.createPairing({ channel: 'telegram', accountId: f.telegramAccount.id });
    assert.equal(handle(event({ eventId: 'tg:6', messageId: 'tg-m6', chatId: 'tg-group', chatType: 'group', text: `@fb_bot /pair ${issued.token}`, mentionedBot: true })).status, 'ignored');
    assert.equal(f.service.records.pairing(issued.pairing.id)?.status, 'pending');

    const claimed = handle(event({ eventId: 'tg:7', text: `/pair ${issued.token}` }));
    assert.equal(claimed.status, 'pairing_claimed');
    assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as { n: number }).n, 2);
  } finally { f.db.close(); }
});

it('refuses channel admission and inbox intake while the project copilot autonomy switch is off', () => {
  const f = fixture();
  try {
    f.projects.setCopilotAutonomy(f.project.id, false);
    const { peer, identity } = f.pair('telegram', f.telegramAccount.id, f.telegramAccount.configRevision, 'tg-owner', 'tg-private');
    // Route creation only validates project ownership; the switch gates admission, not routing.
    const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    assert.throws(() => f.service.admit(route.id, peer), /CHANNEL_AUTHORITY_REJECTED/);
    assert.throws(() => f.service.admitRoute(route.id), /CHANNEL_AUTHORITY_REJECTED/);
    const inbox = new NativeChannelInbox(f.db, f.user.id, f.key);
    assert.throws(() => inbox.receive(peer, { eventId: 'off-event', messageId: 'off-message', text: 'hello' }), /CHANNEL_AUTHORITY_REJECTED/);
    assert.equal((f.db.prepare('SELECT count(*) n FROM channel_messages').get() as { n: number }).n, 0);
    f.projects.setCopilotAutonomy(f.project.id, true);
    const admitted = f.service.admit(route.id, peer);
    assert.deepEqual(admitted.projectIds, [f.project.id]);
  } finally { f.db.close(); }
});

it('fences a live route and its backlog when the project copilot autonomy switch is flipped off', () => {
  const f = fixture();
  try {
    const { peer, identity } = f.pair('telegram', f.telegramAccount.id, f.telegramAccount.configRevision, 'tg-owner', 'tg-private');
    const route = f.service.createRoute({ identityId: identity.id, projectId: f.project.id });
    assert.ok(f.service.admit(route.id, peer));
    const inbox = new NativeChannelInbox(f.db, f.user.id, f.key);
    inbox.receive(peer, { eventId: 'pre-flip-event', messageId: 'pre-flip-message', text: 'before the switch' });
    f.projects.setCopilotAutonomy(f.project.id, false);
    assert.throws(() => f.service.admit(route.id, peer), /CHANNEL_AUTHORITY_REJECTED/);
    assert.throws(() => inbox.receive(peer, { eventId: 'post-flip-event', messageId: 'post-flip-message', text: 'after the switch' }), /CHANNEL_AUTHORITY_REJECTED/);
    assert.equal(inbox.adoptNext().status, 'rejected');
    assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_runs').get() as { n: number }).n, 0);
    f.projects.setCopilotAutonomy(f.project.id, true);
    inbox.receive(peer, { eventId: 'reopen-event', messageId: 'reopen-message', text: 'after reopening' });
    assert.equal(inbox.adoptNext().status, 'adopted');
  } finally { f.db.close(); }
});

it('scopes channel route creation to the project owner without leaving a conversation or route', () => {
  const f = fixture();
  try {
    const { identity } = f.pair('telegram', f.telegramAccount.id, f.telegramAccount.configRevision, 'tg-owner', 'tg-private');
    const foreign = new ProjectRepository(f.db, f.other.id).create({ name: 'foreign', path: '/private/tmp/tg-channel-foreign', aiTool: 'claude' });
    assert.throws(() => f.service.createRoute({ identityId: identity.id, projectId: foreign.id }), /CHANNEL_AUTHORITY_REJECTED/);
    assert.throws(() => f.service.createRoute({ identityId: identity.id, projectId: 'missing-project' }), /CHANNEL_AUTHORITY_REJECTED/);
    assert.equal(f.service.records.listRoutes().length, 0);
    assert.equal((f.db.prepare('SELECT count(*) n FROM copilot_conversations').get() as { n: number }).n, 0);
  } finally { f.db.close(); }
});
