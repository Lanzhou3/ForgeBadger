import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { ChannelIdentityService } from '../src/services/channels/channel-identity-service.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { checkAgentScope } from '../src/services/platform-commands/agent-scope.js';
import { prepareChannelAdmission } from '../src/services/channels/channel-run-scope.js';
import { renderRunEnding, CLOSING_STOP_REASONS } from '../src/services/agent/run-ending.js';
import type { AgentToolContext } from '../src/services/agent/tool-registry.js';

function fixture() {
  const db = new Database(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('ending@test.local', 'fixture');
  const project = new ProjectRepository(db, user.id).create({ name: 'fixture', path: '/tmp/ending-fixture', aiTool: 'pi' });
  return { db, user, project };
}

function scopeContext(db: Database, userId: string, conversationId: string, runId: string, channelScope?: unknown): AgentToolContext {
  return { db, userId, conversationId, masterKey: 'a'.repeat(64), source: 'user', runId, stepId: 's1',
    ...(channelScope === undefined ? {} : { channelScope }) } as AgentToolContext;
}

function channelIdentity(db: Database, user: { id: string }, conversationId: string, projectId: string) {
  const key = randomBytes(32).toString('hex');
  const account = new TelegramChannelRepository(db, user.id, key).upsertAccount({ botToken: 'fixture', enabled: true });
  new TelegramIntegrationRepository(db, user.id).upsertConfig({ enabled: true, emergencyDisabled: false, allowedChatIds: ['42'] });
  const service = new ChannelIdentityService(db, user.id);
  const peer = { channel: 'telegram' as const, accountId: account.id, accountRevision: account.configRevision, externalUserId: '42', chatId: '42', chatType: 'p2p' as const };
  const issued = service.createPairing({ channel: 'telegram', accountId: account.id });
  const claimed = service.claimPairing(issued.token, peer);
  const identity = service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: peer.externalUserId, chatId: peer.chatId });
  service.createRoute({ identityId: identity.id, conversationId, projectId });
  db.prepare('UPDATE copilot_conversations SET channel_owned=1 WHERE id=?').run(conversationId);
  return key;
}

it('projects the stall reasons with histogram and goal, nothing else', () => {
  const { db, user, project } = fixture();
  try {
    const ledger = new CopilotRunLedger(db, user.id);
    const conversationId = ledger.log.createConversation().id;
    const runId = ledger.admit({ userId: user.id, conversationId, userText: '新建一个pi会话', projectId: project.id }, 16);
    ledger.append(runId, { role: 'assistant', kind: 'tool_call', content: 'discover_tools' });
    for (const query of ['create new session pi', 'session', 'create']) {
      const step = ledger.addStep(runId, { kind: 'tool', toolCallId: query, toolName: 'discover_tools', inputJson: JSON.stringify({ query }) });
      db.prepare("UPDATE copilot_run_steps SET status='completed' WHERE id=?").run(step.id);
    }
    for (const reason of ['cancelled_by_owner', 'goal_paused', 'COPILOT_CONTEXT_RECOVERY_INTERRUPTED', 'COPILOT_TOOL_REPEAT_STALL', null]) {
      assert.equal(renderRunEnding(db, user.id, runId, reason), undefined, `reason ${String(reason)} must not synthesize text`);
    }
    assert.deepEqual([...CLOSING_STOP_REASONS].sort(), ['COPILOT_NO_PROGRESS', 'step_budget_exhausted']);
    const ending = renderRunEnding(db, user.id, runId, 'step_budget_exhausted')!;
    assert.match(ending, /步数预算用尽/);
    assert.match(ending, /discover_tools×3/);
    assert.match(ending, /新建一个pi会话/);
    const noProgress = renderRunEnding(db, user.id, runId, 'COPILOT_NO_PROGRESS')!;
    assert.match(noProgress, /重复观察相同结果/);
  } finally { db.close(); }
});

it('web project-bound conversations keep full owner authority (no scope snapshot)', () => {
  const { db, user, project } = fixture();
  try {
    const ledger = new CopilotRunLedger(db, user.id);
    const conversationId = ledger.log.createConversation().id;
    ledger.log.setConversationProject(conversationId, project.id);
    const admitted = prepareChannelAdmission(db, user.id, { userId: user.id, conversationId, userText: '新建一个pi会话' });
    assert.equal(admitted.channelScope, undefined, 'a project-bound owner conversation must not synthesize channel authority');
    const runId = ledger.admit(admitted, 16);
    const context = scopeContext(db, user.id, conversationId, runId);
    // The exact rejections the 2026-11-11 run suffered: a playbook load by ID
    // and a global memory search from a project conversation.
    checkAgentScope(context, 'load_playbook', { id: '00000000-0000-0000-0000-000000000000' });
    checkAgentScope(context, 'search_memory', { query: 'pi session 新建会话' });
    checkAgentScope(context, 'read_skill_resource', { skillId: '00000000-0000-0000-0000-000000000000', revisionId: '11111111-1111-1111-1111-111111111111', relativePath: 'SKILL.md' });
  } finally { db.close(); }
});

it('channel-owned conversations still scope memory and keep playbook loading', () => {
  const { db, user, project } = fixture();
  try {
    const ledger = new CopilotRunLedger(db, user.id);
    const conversationId = ledger.log.createConversation().id;
    ledger.log.setConversationProject(conversationId, project.id);
    channelIdentity(db, user, conversationId, project.id);
    const admitted = prepareChannelAdmission(db, user.id, { userId: user.id, conversationId, userText: 'Inspect' });
    assert.ok(admitted.channelScope, 'a channel-owned conversation must compose a scope snapshot');
    const runId = ledger.admit(admitted, 16);
    const context = scopeContext(db, user.id, conversationId, runId, admitted.channelScope);
    checkAgentScope(context, 'search_memory', { query: 'anything', scope: 'project', projectId: project.id });
    assert.throws(() => checkAgentScope(context, 'search_memory', { query: 'anything', scope: 'project' }), /CHANNEL_AUTHORITY/);
    // A no-resource-ID playbook load stays usable inside a channel run.
    checkAgentScope(context, 'load_playbook', { id: '00000000-0000-0000-0000-000000000000' });
  } finally { db.close(); }
});
