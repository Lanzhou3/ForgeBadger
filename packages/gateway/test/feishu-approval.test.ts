import assert from 'node:assert/strict';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { FeishuChannelRepository } from '../src/db/repositories/feishu-channel-repository.js';
import { FeishuIntegrationRepository } from '../src/db/repositories/feishu-integration-repository.js';
import { ChannelIdentityService, type TrustedChannelPeer } from '../src/services/channels/channel-identity-service.js';
import { agentActions } from '../src/services/platform-commands/agent-actions.js';
import { NativeChannelInbox } from '../src/services/channels/native-channel-inbox.js';
import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';
import { createFeishuNativeSender } from '../src/services/integrations/feishu-native-sender.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';

function fixture(group = false) {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const key = randomBytes(32).toString('hex');
  const user = new UserRepository(db).create('approval@test.dev', 'fixture');
  const accounts = new FeishuChannelRepository(db, user.id, key);
  const account = accounts.upsertAccount({ appId: 'fixture', appSecret: 'fixture', enabled: true });
  const config = new FeishuIntegrationRepository(db, user.id);
  config.upsertConfig({ enabled: true, emergencyDisabled: false });
  const projects = new ProjectRepository(db, user.id);
  const project = projects.create({ name: 'Approval project', path: '/private/tmp/fb-approval', aiTool: 'claude' });
  projects.setCopilotAutonomy(project.id, true);
  const authority = new ChannelIdentityService(db, user.id);
  const peer: TrustedChannelPeer = { channel: 'feishu', accountId: account.id, accountRevision: account.configRevision,
    externalUserId: 'ou-owner', chatId: 'oc-private', chatType: 'p2p' };
  const pair = authority.createPairing({ channel: 'feishu', accountId: account.id });
  const claimed = authority.claimPairing(pair.token, peer);
  const identity = authority.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: peer.externalUserId, chatId: peer.chatId });
  const route = authority.createRoute({ identityId: identity.id, projectId: project.id });
  const sourcePeer: TrustedChannelPeer = group ? { ...peer, chatType: 'group', mentionedBot: true, chatId: 'oc-group', threadId: 'thread-1', replyToMessageId: 'om-request' } : peer;
  if (group) config.upsertConfig({ allowedChatIds: ['oc-group'] });
  const inbox = new NativeChannelInbox(db, user.id, key);
  const received = inbox.receive(sourcePeer, { eventId: 'ev-request', messageId: 'om-request', text: '请调整项目设置' });
  const adopted = inbox.adoptNext(); assert.equal(adopted.status, 'adopted');
  if (adopted.status !== 'adopted') throw new Error('admission failed');
  const ledger = new CopilotRunLedger(db, user.id);
  const claim = ledger.claim(adopted.runId, 'fixture', 30_000)!;
  const step = ledger.addStep(adopted.runId, { kind: 'tool', toolName: 'update_project', toolCallId: 'call-1',
    inputJson: JSON.stringify({ projectId: project.id, name: 'New project name' }), effect: 'write' });
  // A channel-scoped run may only await approval on channel-catalog writes, and
  // the orchestrator attaches the approved platform intent before pausing.
  agentActions({ db, userId: user.id, masterKey: key, runId: adopted.runId, stepId: step.id,
    conversationId: ledger.get(adopted.runId)!.conversation_id })
    .preview({ commandId: 'project.metadata.update', input: { projectId: project.id, name: 'New project name' }, idempotencyKey: step.id });
  ledger.waitApproval(claim, step);
  const action = ledger.log.listPendingActions(adopted.runId)[0]!;
  let sent: Record<string, unknown> | undefined;
  const sender = createFeishuNativeSender(db, user.id, key, { validate: async () => {}, fetch: async (url, init) => {
    if (String(url).includes('tenant_access_token')) return Response.json({ code: 0, tenant_access_token: 'fixture' });
    sent = JSON.parse(String(init?.body));
    return Response.json({ code: 0, data: { message_id: 'om-approval' } });
  } });
  const worker = new NativeChannelDelivery(db, user.id, key, sender);
  return { db, key, user, accounts, account, config, projects, project, authority, peer: sourcePeer, identity, route, inbox, received, ledger, action, worker,
    get sent() { return sent!; } };
}

it('delivers a native interactive approval card instead of redirecting the user to Web', async () => {
  const f = fixture();
  try {
    await f.worker.runOnce(new AbortController().signal);
    assert.equal(f.sent.msg_type, 'interactive');
    const card = JSON.parse(f.sent.content as string);
    assert.match(JSON.stringify(card), /批准本次/);
    assert.match(JSON.stringify(card), /拒绝/);
    assert.match(JSON.stringify(card), /New project name/);
    assert.match(JSON.stringify(card), /请调整项目设置/);
  } finally { f.db.close(); }
});

import { FeishuApprovalService } from '../src/services/channels/feishu-approval.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { encryptSecret } from '../src/crypto/secret-box.js';

type Fixture = ReturnType<typeof fixture>;
function runtime(f: Fixture, toolExists = true) {
  const orchestrator = createCopilotOrchestrator({ db: f.db, masterKey: f.key, eventBus: new ForgeBadgerEventBus(),
    toolRegistry: createAgentToolRegistry(toolExists ? [{ name: 'update_project', description: 'test approval', risk: 'operate', requiresApproval: true,
      inputSchema: z.object({ projectId: z.string(), name: z.string() }), execute: async () => ({ changed: true }) }] : []),
    llm: { async streamTurn() { return { text: '操作已处理', toolCalls: [] }; }, async summarize() { return ''; }, async generateTitle() { return '审批测试'; }, async proposeMemory() { return []; } } });
  return { orchestrator, projectName: () => f.projects.getById(f.project.id)!.name };
}
function callback(f: Fixture, approved = true) {
  const card = JSON.parse(f.sent.content as string);
  const actions = card.elements.find((element: {tag: string}) => element.tag === 'action').actions;
  const value = actions.find((button: {value: {approved: boolean}}) => button.value.approved === approved)?.value;
  assert.ok(value, 'expected decision button');
  return { operator: { open_id: f.peer.externalUserId }, context: { open_chat_id: f.peer.chatId, open_message_id: 'om-approval' },
    token: 'callback-token', action: { value } };
}
function handle(f: Fixture, event: unknown, r = runtime(f)) {
  return new FeishuApprovalService(f.db, f.user.id, f.key).handle(event, f.account.id, f.account.configRevision,
    decision => r.orchestrator.recordApprovalDecision({ userId: f.user.id, ...decision }));
}

for (const approved of [true, false]) it(`records ${approved ? 'approval' : 'rejection'} once and resumes through the native orchestrator`, async () => {
  const f = fixture(); const r = runtime(f);
  try {
    await f.worker.runOnce(new AbortController().signal);
    const event = callback(f, approved);
    const response = handle(f, event, r);
    assert.match(response.toast.content, approved ? /已批准/ : /已拒绝/);
    assert.ok('card' in response);
    assert.doesNotMatch(JSON.stringify(response), /批准本次/);
    assert.match(JSON.stringify(response), /请调整项目设置/);
    assert.match(JSON.stringify(response), /New project name/);
    assert.equal(f.ledger.log.getPendingAction(f.action.id)?.status, approved ? 'approved' : 'rejected');
    assert.equal(f.ledger.get(f.action.runId)?.status, 'pending');
    assert.equal(r.projectName(), 'Approval project', 'callback must not execute an external effect');
    assert.match(handle(f, event, r).toast.content, approved ? /已批准/ : /已拒绝/);
    assert.equal((f.db.prepare("SELECT count(*) n FROM audit_logs WHERE action='copilot.channel.approval'").get() as {n:number}).n, 1);
    await r.orchestrator.executeRun(f.user.id, f.action.runId);
    await r.orchestrator.executeRun(f.user.id, f.action.runId);
    assert.equal(r.projectName(), approved ? 'New project name' : 'Approval project');
  } finally { f.db.close(); }
});

const invalidCases: Array<[string, (f: Fixture, event: ReturnType<typeof callback>) => void]> = [
  ['another operator', (_f,e) => { e.operator.open_id = 'ou-other'; }],
  ['another chat', (_f,e) => { e.context.open_chat_id = 'oc-other'; }],
  ['forwarded message', (_f,e) => { e.context.open_message_id = 'om-forwarded'; }],
  ['decision tampering', (_f,e) => { e.action.value.approved = false; }],
  ['signature tampering', (_f,e) => { e.action.value.signature = '0'.repeat(64); }],
  ['revoked route', (f) => { f.authority.revokeRoute(f.route.id); }],
  ['revoked identity', (f) => { f.authority.revokeIdentity(f.identity.id); }],
  ['disabled autonomy', (f) => { f.projects.setCopilotAutonomy(f.project.id, false); }],
  ['emergency stop', (f) => { f.config.upsertConfig({ emergencyDisabled: true }); }],
  ['removed chat allowlist', (f) => { f.config.upsertConfig({ allowedChatIds: ['different-chat'] }); }],
  ['account revision change', (f) => { f.accounts.upsertAccount({ appId: 'replacement', appSecret: 'new', enabled: true }); }],
  ['disabled user', (f) => { f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(f.user.id); }],
  ['unknown send receipt', (f) => { f.db.prepare("UPDATE channel_deliveries SET status='unknown'").run(); }],
  ['absent message receipt', (f) => { f.db.prepare('UPDATE channel_deliveries SET provider_message_id=NULL').run(); }],
  ['changed input', (f) => { f.db.prepare("UPDATE copilot_pending_actions SET input_json='{}' WHERE id=?").run(f.action.id); }],
];
for (const [name, mutate] of invalidCases) it(`refuses ${name} without committing a decision`, async () => {
  const f = fixture();
  try {
    await f.worker.runOnce(new AbortController().signal);
    const event = callback(f); mutate(f, event);
    const response = handle(f, event);
    assert.equal(response.toast.type, 'error');
    assert.equal('card' in response, false, 'do not disclose or overwrite a card on authority failure');
    assert.equal(f.ledger.log.getPendingAction(f.action.id)?.status, 'pending');
  } finally { f.db.close(); }
});

it('rejects cross-tenant and wrong SDK account/revision callbacks', async () => {
  const f = fixture();
  try {
    await f.worker.runOnce(new AbortController().signal); const event = callback(f);
    const other = new UserRepository(f.db).create('other-approval@test.dev', 'fixture');
    for (const [userId, accountId, revision] of [[other.id, f.account.id, f.account.configRevision], [f.user.id, 'other', f.account.configRevision], [f.user.id, f.account.id, f.account.configRevision + 1]] as const) {
      const response = new FeishuApprovalService(f.db, userId, f.key).handle(event, accountId, revision, () => { throw new Error('must not decide'); });
      assert.equal(response.toast.type, 'error');
    }
    assert.equal(f.ledger.log.getPendingAction(f.action.id)?.status, 'pending');
  } finally { f.db.close(); }
});

it('preserves a Web decision and cancellation against late card clicks', async () => {
  for (const state of ['web', 'cancel'] as const) {
    const f = fixture(); const r = runtime(f);
    try {
      await f.worker.runOnce(new AbortController().signal); const event = callback(f);
      if (state === 'web') r.orchestrator.recordApprovalDecision({ userId: f.user.id, runId: f.action.runId, actionId: f.action.id, approved: false });
      else f.ledger.cancel(f.action.runId);
      const before = f.ledger.log.getPendingAction(f.action.id)?.status;
      assert.match(handle(f, event, r).toast.content, state === 'web' ? /已拒绝/ : /失效/);
      assert.equal(f.ledger.log.getPendingAction(f.action.id)?.status, before);
    } finally { f.db.close(); }
  }
});

it('preserves the Web tool-availability guard', async () => {
  const f = fixture();
  try {
    await f.worker.runOnce(new AbortController().signal);
    assert.equal(handle(f, callback(f), runtime(f, false)).toast.type, 'error');
    assert.equal(f.ledger.log.getPendingAction(f.action.id)?.status, 'pending');
  } finally { f.db.close(); }
});

it('does not offer approval for truncated parameters or a missing stop target, and redacts secrets', async () => {
  for (const scenario of ['long', 'stop', 'secret'] as const) {
    const f = fixture();
    try {
      const input = scenario === 'long' ? JSON.stringify({ content: '字'.repeat(6000) })
        : scenario === 'secret' ? '{"password":"secret-never-show"}' : '{"sessionId":"target"}';
      f.db.prepare('UPDATE copilot_pending_actions SET input_json=?,tool=? WHERE id=?').run(input, scenario === 'stop' ? 'stop_session' : 'update_project', f.action.id);
      await f.worker.runOnce(new AbortController().signal);
      const content = f.sent.content as string;
      assert.doesNotMatch(content, /secret-never-show/);
      if (scenario !== 'secret') assert.doesNotMatch(content, /批准本次/);
      assert.match(content, /拒绝/);
    } finally { f.db.close(); }
  }
});

it('upgrades a confirmed legacy text notice once, without replaying an unknown notice', async () => {
  for (const status of ['delivered', 'unknown'] as const) {
    const f = fixture();
    try {
      f.worker.records.enqueue(f.received.id, `approval:${f.action.id}`, JSON.stringify(encryptSecret('回 Web 操作', { key: f.key })));
      f.db.prepare('UPDATE channel_deliveries SET status=?').run(status);
      await f.worker.runOnce(new AbortController().signal);
      await f.worker.runOnce(new AbortController().signal);
      const count = (f.db.prepare('SELECT count(*) n FROM channel_deliveries').get() as {n:number}).n;
      assert.equal(count, status === 'delivered' ? 2 : 1);
      if (status === 'delivered') assert.equal(f.sent.msg_type, 'interactive');
      else assert.equal(f.sent, undefined);
    } finally { f.db.close(); }
  }
});

it('limits group/topic approval to the original operator and actual sent card', async () => {
  const f = fixture(true);
  try {
    await f.worker.runOnce(new AbortController().signal);
    assert.equal(f.sent.reply_in_thread, true);
    const event = callback(f);
    const other = structuredClone(event); other.operator.open_id = 'ou-group-member';
    assert.equal(handle(f, other).toast.type, 'error');
    const forwarded = structuredClone(event); forwarded.context.open_message_id = 'om-other-topic';
    assert.equal(handle(f, forwarded).toast.type, 'error');
    assert.match(handle(f, event).toast.content, /已批准/);
  } finally { f.db.close(); }
});

it('expires a correctly signed card without granting approval', async (t) => {
  const f = fixture();
  try {
    await f.worker.runOnce(new AbortController().signal);
    const event = callback(f);
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 25 * 60 * 60_000 });
    const response = handle(f, event);
    assert.match(response.toast.content, /已过期/);
    assert.doesNotMatch(JSON.stringify(response), /批准本次/);
    assert.equal(f.ledger.log.getPendingAction(f.action.id)?.status, 'pending');
  } finally { t.mock.timers.reset(); f.db.close(); }
});

import { createGatewayApp } from '../src/server.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { InMemoryApiKeyStore } from '../src/secrets/api-key-store.js';
import type { FeishuSdkEventHandlers } from '../src/services/integrations/feishu-sdk.js';

it('wires authenticated SDK card callbacks through the default Gateway composition and fences shutdown', async () => {
  const f = fixture(); let handlers: FeishuSdkEventHandlers | undefined;
  await f.worker.runOnce(new AbortController().signal);
  const event = callback(f, false);
  const app = createGatewayApp({ db: f.db, masterKey: f.key, jwtSecret: randomBytes(32).toString('hex'),
    sessionServerIpcPath: '/private/tmp/fb-approval-test.sock',
    sessionManager: new InMemorySessionManager({ async listSessions() { return []; }, async createSession() {}, async killSession() {}, async capturePane() { return ''; } } as never),
    apiKeyStore: new InMemoryApiKeyStore({ masterKey: f.key }),
    nativeFeishuIO: { sdkFactory: { createWebSocketClient: (_config, callbacks, incoming) => {
      handlers = incoming;
      return { async start() { callbacks.onReady?.(); }, close() {}, getConnectionStatus: () => ({ state: 'connected', reconnectAttempts: 0 }) };
    } }, validate: async () => {}, fetch: async () => Response.json({ code: 0, tenant_access_token: 'fixture', data: { items: [], has_more: false, reaction_id: 'reaction', message_id: 'om' } }) }
  });
  try {
    await app.recoveryReady;
    for (let n = 0; !handlers && n < 50; n++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(handlers?.onCardAction);
    const response = await handlers.onCardAction(event) as { toast: { content: string } };
    assert.match(response.toast.content, /已拒绝/);
    assert.equal(f.ledger.log.getPendingAction(f.action.id)?.status, 'rejected');
  } finally { await app.close(); }
  assert.equal(await handlers?.onCardAction?.(event), undefined);
});
