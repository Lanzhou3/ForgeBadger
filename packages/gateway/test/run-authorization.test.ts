import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { ChannelIdentityService } from '../src/services/channels/channel-identity-service.js';
import { NativeChannelInbox } from '../src/services/channels/native-channel-inbox.js';
import { assertChannelRunScope } from '../src/services/channels/channel-run-scope.js';
import { ChannelIdentityError } from '../src/services/channels/channel-identity-service.js';
import { CopilotRunLedger, type TurnInput } from '../src/services/agent/run-ledger.js';
import { loadRunFacts, ParentChainDepthError, PARENT_CHAIN_MAX_DEPTH, hasUserMessageAuthorization, runAncestry } from '../src/services/agent/run-authorization.js';
import { computeToolSurface, CHANNEL_TOOLS } from '../src/services/agent/tool-surface.js';
import type { AgentToolRegistry } from '../src/services/agent/tool-registry.js';

function dbFixture() {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('run-auth@test.dev', 'hash');
  return { db, user };
}

/** Channel-owned conversation fixture so assertChannelRunScope has live authority. */
function channelFixture() {
  const root = mkdtempSync(join(tmpdir(), 'fb-run-auth-'));
  const { db, user } = dbFixture();
  const key = randomBytes(32).toString('hex');
  const projects = new ProjectRepository(db, user.id);
  const a = projects.create({ name: 'Allowed A', path: join(root, 'a'), aiTool: 'claude' });
  const account = new TelegramChannelRepository(db, user.id, key).upsertAccount({ botToken: 'fixture', enabled: true });
  new TelegramIntegrationRepository(db, user.id).upsertConfig({ enabled: true, emergencyDisabled: false, allowedChatIds: ['123', '-1001'] });
  const service = new ChannelIdentityService(db, user.id);
  const peer = { channel: 'telegram' as const, accountId: account.id, accountRevision: account.configRevision, externalUserId: '123', chatId: '123', chatType: 'p2p' as const };
  const issued = service.createPairing({ channel: peer.channel, accountId: account.id });
  const claimed = service.claimPairing(issued.token, peer);
  const identity = service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: peer.externalUserId, chatId: peer.chatId });
  service.createRoute({ identityId: identity.id, projectId: a.id });
  const group = { ...peer, chatId: '-1001', chatType: 'group' as const, mentionedBot: true as const };
  const inbox = new NativeChannelInbox(db, user.id, key);
  inbox.receive(group, { eventId: '1', messageId: '1', text: 'scope-marker' });
  const adopted = inbox.adoptNext();
  assert.equal(adopted.status, 'adopted');
  const ledger = new CopilotRunLedger(db, user.id);
  const runId = adopted.runId;
  const scope = (JSON.parse(ledger.get(runId)!.input_json) as TurnInput).channelScope!;
  /** Insert a synthetic child run bound to the same snapshot and parent chain. */
  const chainRun = (parentRunId: string, index: number) => {
    const conversationId = ledger.log.createConversation().id;
    const id = ledger.admit({ userId: user.id, conversationId, userText: `chain ${index}` }, 4);
    const input = { userId: user.id, conversationId, userText: `chain ${index}`, channelScope: scope, parentRunId, projectId: a.id };
    db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?').run(JSON.stringify(input), id);
    return { id, input: input as TurnInput };
  };
  const cleanup = () => { db.close(); rmSync(root, { recursive: true, force: true }); };
  return { db, user, a, ledger, runId, scope, chainRun, cleanup };
}

it('parent chain walk is iterative and depth-capped at 8', () => {
  const { db, user } = dbFixture();
  try {
    const ledger = new CopilotRunLedger(db, user.id);
    const ids: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const conversationId = ledger.log.createConversation().id;
      const id = ledger.admit({ userId: user.id, conversationId, userText: `level ${index}` }, 2);
      // Wire the parent after admission: admission itself validates the chain.
      if (index) db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?')
        .run(JSON.stringify({ userId: user.id, conversationId, userText: `level ${index}`, parentRunId: ids[index - 1]! }), id);
      ids.push(id);
    }
    const deepest = JSON.parse(ledger.get(ids[9]!)!.input_json) as TurnInput;
    const eightDeep = JSON.parse(ledger.get(ids[7]!)!.input_json) as TurnInput;
    assert.equal(PARENT_CHAIN_MAX_DEPTH, 8);
    assert.equal([...runAncestry(db, user.id, eightDeep)].length, 8);
    assert.throws(() => [...runAncestry(db, user.id, deepest)], ParentChainDepthError);
    // loadRunFacts truncates past the cap instead of throwing.
    const facts = loadRunFacts(db, user.id, ids[9]!);
    assert.equal(facts?.parentChain.length, PARENT_CHAIN_MAX_DEPTH - 1);
    assert.equal(facts?.input.userText, 'level 9');
  } finally { db.close(); }
});

it('channel scope accepts an 8-level chain and rejects a 9-level chain', () => {
  const f = channelFixture();
  try {
    let top = f.chainRun(f.runId, 1);
    for (let index = 2; index <= 7; index += 1) top = f.chainRun(top.id, index);
    // 7 synthetic levels + the admitted origin = 8 levels: accepted.
    assert.ok(assertChannelRunScope(f.db, f.user.id, top.input));
    const ninth = f.chainRun(top.id, 8);
    // 8 synthetic levels + origin = a 9th entry: fails closed.
    assert.throws(() => assertChannelRunScope(f.db, f.user.id, ninth.input), ChannelIdentityError);
  } finally { f.cleanup(); }
});

it('user message authorization matches run id, edit message id, and active conversation', () => {
  const { db, user } = dbFixture();
  try {
    const ledger = new CopilotRunLedger(db, user.id);
    const conversation = ledger.log.createConversation();
    const run = ledger.admit({ userId: user.id, conversationId: conversation.id, userText: 'authorized goal' }, 2);
    assert.equal(hasUserMessageAuthorization(db, user.id, conversation.id, 'authorized goal', run), true);
    assert.equal(hasUserMessageAuthorization(db, user.id, conversation.id, 'forged goal', run), false);
    const other = ledger.log.createConversation();
    assert.equal(hasUserMessageAuthorization(db, user.id, other.id, 'authorized goal', run), false);
    // The edited-message path: authorization can attach to the replaced message id.
    const editConversation = ledger.log.createConversation();
    const original = ledger.log.appendMessage(editConversation.id, { role: 'user', kind: 'text', content: 'edited goal' });
    assert.equal(hasUserMessageAuthorization(db, user.id, editConversation.id, 'edited goal', 'missing-run', original.id), true);
    assert.equal(hasUserMessageAuthorization(db, user.id, editConversation.id, 'edited goal', 'missing-run', 'unknown-message'), false);
    // Hidden conversations no longer authorize new work.
    db.prepare("UPDATE copilot_conversations SET status='hidden' WHERE id=?").run(conversation.id);
    assert.equal(hasUserMessageAuthorization(db, user.id, conversation.id, 'authorized goal', run), false);
  } finally { db.close(); }
});

function surfaceRegistry(): AgentToolRegistry {
  const risks: Record<string, string> = {
    load_skill: 'read', takeover_session: 'operate', get_usage_summary: 'read', get_project: 'read',
    write_memory: 'operate', mcp_query: 'read', update_project: 'operate', list_projects: 'read',
  };
  const tools = new Map(Object.entries(risks).map(([name, risk]) => [name, { risk } as never]));
  return {
    tools,
    toModelSchemas: () => Object.keys(risks).map(name => ({ name, description: name, inputSchema: {} })),
  } as unknown as AgentToolRegistry;
}

it('computeToolSurface names the excluding layer for every plane', () => {
  const registry = surfaceRegistry();
  const layersOf = (input: Parameters<typeof computeToolSurface>[0], toolName: string) =>
    computeToolSurface(input, { registry, hasSessionManager: false }).exclusions.filter(exclusion => exclusion.toolName === toolName).map(exclusion => exclusion.layer);
  assert.deepEqual(layersOf({}, 'load_skill'), ['retired']);
  assert.deepEqual(layersOf({ source: 'scheduled' }, 'takeover_session'), ['scheduled-readonly', 'session-runtime']);
  assert.deepEqual(layersOf({ source: 'scheduled' }, 'update_project'), ['scheduled-readonly']);
  assert.deepEqual(layersOf({ channelScope: { version: 1 } as never }, 'get_usage_summary'), ['channel-catalog']);
  assert.deepEqual(layersOf({ executionMode: 'research' }, 'write_memory'), ['restricted-mode']);
  assert.deepEqual(layersOf({}, 'takeover_session'), ['session-runtime']);
  assert.deepEqual(layersOf({ source: 'scheduled' }, 'mcp_query'), ['scheduled-readonly', 'mcp-source']);
  assert.deepEqual(layersOf({}, 'get_usage_summary'), []);
  assert.deepEqual(layersOf({}, 'get_project'), []);
  // Owner-disabled is a verdict of its own; channel tools stay visible under a channel scope.
  const disabled = computeToolSurface({}, { registry, hasSessionManager: false, isToolDisabled: name => name === 'get_usage_summary' });
  assert.ok(disabled.excluded('get_usage_summary', 'owner-disabled'));
  assert.equal(disabled.exclusion('get_usage_summary')!.layer, 'owner-disabled');
  const channel = computeToolSurface({ channelScope: { version: 1 } as never }, { registry, hasSessionManager: false });
  assert.ok(channel.visible.some(tool => tool.name === 'list_projects'));
  assert.ok(CHANNEL_TOOLS.has('list_projects'));
  assert.equal(channel.exclusion('get_usage_summary')!.layer, 'channel-catalog');
});
