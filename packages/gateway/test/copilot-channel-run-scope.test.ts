import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { ProjectManagerRepository } from '../src/db/repositories/project-manager-repository.js';
import { TelegramChannelRepository } from '../src/db/repositories/telegram-channel-repository.js';
import { TelegramIntegrationRepository } from '../src/db/repositories/telegram-integration-repository.js';
import { ChannelIdentityService } from '../src/services/channels/channel-identity-service.js';
import { NativeChannelInbox } from '../src/services/channels/native-channel-inbox.js';
import { channelToolAllowed } from '../src/services/channels/channel-run-scope.js';
import { CopilotRunLedger, type TurnInput } from '../src/services/agent/run-ledger.js';
import { CopilotFollowups } from '../src/services/agent/followups.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import type { AgentLlmClient } from '../src/services/agent/orchestrator-types.js';
import { createAgentToolRegistry, executeAgentTool, type AgentToolContext } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { AgentMemoryRepository } from '../src/services/agent/memory.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { agentActions, agentActionInput } from '../src/services/platform-commands/agent-actions.js';
import { CopilotToolArtifactRepository } from '../src/db/repositories/copilot-tool-artifact-repository.js';
import { recoverLegacyChannelRuns } from '../src/services/channels/channel-run-authority.js';
import { NativeChannelDelivery } from '../src/services/channels/native-channel-delivery.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fb-channel-scope-'));
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const user = new UserRepository(db).create('scope@test.dev', 'fixture');
  const key = randomBytes(32).toString('hex');
  const projects = new ProjectRepository(db, user.id);
  const a = projects.create({ name: 'Allowed A', path: join(root, 'a'), aiTool: 'claude' });
  const b = projects.create({ name: 'Private B', path: join(root, 'b'), aiTool: 'claude', description: 'private-b-marker' });
  const account = new TelegramChannelRepository(db, user.id, key).upsertAccount({ botToken: 'fixture', enabled: true });
  new TelegramIntegrationRepository(db, user.id).upsertConfig({ enabled: true, emergencyDisabled: false, allowedChatIds: ['123', '-1001'] });
  const service = new ChannelIdentityService(db, user.id);
  const peer = { channel: 'telegram' as const, accountId: account.id, accountRevision: account.configRevision, externalUserId: '123', chatId: '123', chatType: 'p2p' as const };
  const issued = service.createPairing({ channel: peer.channel, accountId: account.id });
  const claimed = service.claimPairing(issued.token, peer);
  const identity = service.confirmPairing(claimed.id, { revision: claimed.revision, externalUserId: peer.externalUserId, chatId: peer.chatId });
  const route = service.createRoute({ identityId: identity.id, projectId: a.id });
  const group = { ...peer, chatId: '-1001', chatType: 'group' as const, mentionedBot: true as const };
  const inbox = new NativeChannelInbox(db, user.id, key);
  inbox.receive(group, { eventId: '1', messageId: '1', text: 'scope-marker' });
  const adopted = inbox.adoptNext();
  assert.equal(adopted.status, 'adopted');
  if (adopted.status !== 'adopted') throw new Error('fixture admission failed');
  const ledger = new CopilotRunLedger(db, user.id);
  const runId = adopted.runId;
  const turn = () => JSON.parse(ledger.get(runId)!.input_json) as TurnInput;
  const context = (): AgentToolContext => ({ db, userId: user.id, masterKey: key, source: 'user', runId, conversationId: turn().conversationId, checkExecutionAuthority: () => true });
  const registry = createAgentToolRegistry(createPlatformTools());
  const call = (name: string, input: unknown) => executeAgentTool(registry.tools.get(name)!, input, context());
  const cleanup = () => { db.close(); rmSync(root, { recursive: true, force: true }); };
  return { db, user, key, a, b, root, projects, service, identity, route, group, inbox, ledger, runId, turn, context, registry, call, cleanup };
}

function rejectLegacyMessage(f:ReturnType<typeof fixture>) {
  const input=f.turn();delete input.channelScope;
  f.db.prepare("UPDATE copilot_runs SET status='completed',input_json=? WHERE id=?").run(JSON.stringify(input),f.runId);
  return f.inbox.receive(f.group,{eventId:'legacy-next',messageId:'legacy-next',text:'new request'});
}
it('settles legacy scope admission rejection and delivers a safe notice without blocking other conversations',async()=>{
  const f=fixture();
  try {
    const message=rejectLegacyMessage(f);
    assert.deepEqual(f.inbox.adoptNext(),{status:'rejected'});
    assert.equal(f.inbox.messages.get(message.id)!.status,'rejected');
    assert.equal(f.inbox.messages.get(message.id)!.run_id,null);
    assert.deepEqual(f.inbox.adoptNext(),{status:'idle'});
    // A private chat is a different channel conversation under the same route.
    const {mentionedBot,...peer}=f.group;
    f.inbox.receive({...peer,chatId:'123',chatType:'p2p'},{eventId:'valid-next',messageId:'valid-next',text:'allowed request'});
    assert.equal(f.inbox.adoptNext().status,'adopted');
    const sent:string[]=[];
    const delivery=new NativeChannelDelivery(f.db,f.user.id,f.key,async input=>{input.authorize();sent.push(input.text);return {status:'delivered',messageId:'reply'};});
    await delivery.runOnce(new AbortController().signal);
    assert.equal(sent.length,1);assert.match(sent[0]!,/\/new/);assert.ok(!sent[0]!.includes('scope-marker'));
  } finally {f.cleanup();}
});
for(const revoke of ['route','conversation'] as const)it(`cancels a rejected admission notice after ${revoke} authority changes`,async()=>{
  const f=fixture();
  try {
    const message=rejectLegacyMessage(f);assert.equal(f.inbox.adoptNext().status,'rejected');
    if(revoke==='route')f.service.revokeRoute(f.route.id);
    else f.inbox.receive(f.group,{eventId:'new-command',messageId:'new-command',text:'/stop'});
    if(revoke==='conversation') {
      // Settle the rejection and /stop receipts so /new can replace the conversation.
      new NativeChannelDelivery(f.db,f.user.id,f.key,async()=>({status:'delivered'})).project();
      f.db.prepare("UPDATE channel_deliveries SET status='delivered'").run();
      f.inbox.receive(f.group,{eventId:'new-conversation',messageId:'new-conversation',text:'/new'});
      f.db.prepare("UPDATE channel_deliveries SET status='pending' WHERE inbox_id=?").run(message.id);
    }
    let sent=0;
    const delivery=new NativeChannelDelivery(f.db,f.user.id,f.key,async()=>{sent++;return {status:'delivered'};});
    await delivery.runOnce(new AbortController().signal);
    assert.equal(sent,0);
    const receipt=delivery.records.listMetadata().find(row=>row.inboxId===message.id)!;
    assert.equal(receipt.status,'cancelled');
  } finally {f.cleanup();}
});

it('native inbox persists scope and actual tool reads/writes cannot leave the admitted project', async () => {
  const f = fixture();
  try {
    assert.equal((await f.call('get_project', { projectId: f.b.id })).ok, false);
    assert.equal((await f.call('write_memory', { scope: 'project', projectId: f.b.id, kind: 'fact', text: 'scope-marker' })).ok, false);
    assert.equal((await f.call('get_project', { projectId: f.a.id })).ok, true);
    const listed = (await f.call('list_projects', {})).output as { projects: { id: string }[]; count: number };
    assert.deepEqual(listed.projects.map(project => project.id), [f.a.id]);
    assert.equal(listed.count, 1);
    const input = f.turn();
    assert.deepEqual(input.channelScope?.projectIds, [f.a.id]);
    assert.equal(input.channelScope?.routeId, f.route.id);
    assert.equal(input.projectId, f.a.id);
  } finally { f.cleanup(); }
});

it('real orchestrator excludes global recall, unknown tools and other-project results from channel provider context', async () => {
  const f = fixture(); let calls = 0; const contexts: string[] = [];
  try {
    const memory = new AgentMemoryRepository(f.db, f.user.id);
    memory.create({ scope: 'global', kind: 'fact', text: 'scope-marker GLOBAL-SECRET' });
    memory.create({ scope: 'project', projectId: f.b.id, kind: 'fact', text: 'scope-marker B-SECRET' });
    memory.create({ scope: 'project', projectId: f.a.id, kind: 'fact', text: 'scope-marker A-ALLOWED' });
    const llm: AgentLlmClient = {
      async stream(request) {
        contexts.push(JSON.stringify(request.messages));
        assert.equal(request.tools.some(tool => tool.name === 'get_usage_summary' || tool.name.startsWith('terminal_')), false);
        if (calls++ === 0) request.onEvent({ type: 'tool_call', toolCall: { id: 'cross-project', name: 'get_project', arguments: JSON.stringify({ projectId: f.b.id }) } });
        else request.onEvent({ type: 'text_delta', text: 'scope done' });
        return { message: calls === 1 ? '' : 'scope done' };
      }, async summarize() { return ''; }, async generateTitle() { return ''; }
    };
    await createCopilotOrchestrator({ db: f.db, masterKey: f.key, toolRegistry: f.registry, llm, eventBus: new ForgeBadgerEventBus() }).executeRun(f.user.id, f.runId);
    assert.ok(contexts.join('').includes('A-ALLOWED'));
    assert.equal(contexts.join('').includes('GLOBAL-SECRET'), false);
    assert.equal(contexts.join('').includes('B-SECRET'), false);
    assert.equal(contexts.join('').includes('private-b-marker'), false);
    assert.equal(f.ledger.get(f.runId)?.status, 'completed');
  } finally { f.cleanup(); }
});

it('channel operations require all requested resources in scope, not just one included project', () => {
  const f = fixture(); try {
    assert.throws(() => f.service.admit(f.route.id, f.group, { capability: 'read', projectIds: [f.a.id, f.b.id] }), /CHANNEL_AUTHORITY_REJECTED/);
  } finally { f.cleanup(); }
});

it('derived research and queued followups inherit the original snapshot, and legacy channel runs fail closed', () => {
  const f = fixture(); try {
    const origin = f.turn();
    const childConversation = f.ledger.log.createConversation();
    const child = f.ledger.admit({ userId: f.user.id, conversationId: childConversation.id, userText: 'research', executionMode: 'research', parentRunId: f.runId, projectId: f.a.id }, 6);
    assert.deepEqual((JSON.parse(f.ledger.get(child)!.input_json) as TurnInput).channelScope, origin.channelScope);
    assert.throws(() => f.ledger.admit({ userId: f.user.id, conversationId: f.ledger.log.createConversation().id, userText: 'research B', executionMode: 'research', parentRunId: f.runId, projectId: f.b.id }, 6));
    const queued = new CopilotFollowups(f.db, f.user.id).enqueue({ userId: f.user.id, conversationId: origin.conversationId, userText: 'next', clientRequestId: 'followup' });
    assert.deepEqual((JSON.parse(queued.input_json) as TurnInput).channelScope, origin.channelScope);
    const legacy = { ...origin }; delete legacy.channelScope;
    assert.throws(() => f.ledger.validateScope(legacy), /CHANNEL_AUTHORITY_REJECTED/);
    f.db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?').run(JSON.stringify(legacy), f.runId);
    assert.throws(() => f.ledger.validateScope(JSON.parse(f.ledger.get(child)!.input_json) as TurnInput), /CHANNEL_AUTHORITY_REJECTED/);
  } finally { f.cleanup(); }
});

it('scope revocation and canonical root drift reject already admitted reads and queued followups', async () => {
  const f = fixture(); try {
    f.db.prepare('UPDATE projects SET path=? WHERE id=?').run(join(f.root, 'changed'), f.a.id);
    assert.equal((await f.call('get_project', { projectId: f.a.id })).ok, false);
    f.db.prepare('UPDATE projects SET path=? WHERE id=?').run(f.a.path, f.a.id);
    f.service.revokeRoute(f.route.id);
    assert.equal((await f.call('get_project', { projectId: f.a.id })).ok, false);
    assert.throws(() => f.ledger.validateScope(f.turn()), /CHANNEL_AUTHORITY_REJECTED/);
  } finally { f.cleanup(); }
});

it('session and packet hints resolve actual resources; lists omit another project and an escaped working root', async () => {
  const f = fixture(); try {
    const sessions = new SessionRepository(f.db, f.user.id);
    const a = sessions.create({ projectId: f.a.id, name: 'a', aiTool: 'claude', workingDir: f.a.path });
    const b = sessions.create({ projectId: f.b.id, name: 'b', aiTool: 'claude', workingDir: f.b.path });
    const escaped = sessions.create({ projectId: f.a.id, name: 'escaped', aiTool: 'claude', workingDir: f.b.path });
    assert.equal((await f.call('get_session', { sessionId: b.id })).ok, false);
    assert.equal((await f.call('get_session', { sessionId: escaped.id })).ok, false);
    assert.equal((await f.call('get_session', { sessionId: a.id })).ok, true);
    const listed = (await f.call('list_sessions', {})).output as { sessions: { id: string }[] };
    assert.deepEqual(listed.sessions.map(session => session.id), [a.id]);
    assert.equal((await f.call('list_sessions', { projectId: f.b.id })).ok, false);
    const pm = new ProjectManagerRepository(f.db, f.user.id);
    const bItem = pm.createWorkItem(f.b.id, { title: 'b task', acceptanceCriteria: ['private'] });
    assert.equal((await f.call('pm_get_work_item', { projectId: f.a.id, workItemId: bItem.id })).ok, false);
    const linked = pm.createWorkItem(f.a.id, { title: 'bad link', acceptanceCriteria: ['private root'], details: { taskPacket: { sessionId: escaped.id } } });
    assert.equal((await f.call('pm_get_task_packet', { projectId: f.a.id, workItemId: linked.id })).ok, false);
    const packets = (await f.call('pm_list_task_packets', { projectId: f.a.id })).output as { taskPackets: unknown[] };
    assert.deepEqual(packets.taskPackets, []);
    const overview = (await f.call('pm_overview', {})).output as { projects: { id: string }[] };
    assert.deepEqual(overview.projects.map(project => project.id), [f.a.id]);
  } finally { f.cleanup(); }
});

it('owner web follow-ups in a channel-owned conversation inherit channel scope by design', () => {
  const f = fixture(); try {
    const queued = new CopilotFollowups(f.db, f.user.id).enqueue({ userId: f.user.id, conversationId: f.turn().conversationId,
      userText: 'owner follow-up', clientRequestId: 'owner-followup', source: 'user' });
    const input = JSON.parse(queued.input_json) as TurnInput;
    assert.equal(input.source, 'user');
    assert.deepEqual(input.channelScope, f.turn().channelScope);
    assert.equal(input.projectId, f.a.id);
    // Restrictions follow the run, not the origin: output may be relayed to
    // the channel, so non-channel tools and unscoped projects stay closed.
    assert.equal(channelToolAllowed(input, 'terminal_run'), false);
    assert.equal(channelToolAllowed(input, 'get_usage_summary'), false);
    assert.equal(channelToolAllowed(input, 'list_projects'), true);
  } finally { f.cleanup(); }
});

it('global memory, unreviewed extensions and raw Shell stay closed while bound project/session memory succeeds', async () => {
  const f = fixture(); try {
    assert.equal((await f.call('list_memory', {})).ok, false);
    assert.equal((await f.call('search_memory', { query: 'scope-marker', scope: 'project', projectId: f.b.id })).ok, false);
    assert.equal((await f.call('write_memory', { scope: 'global', kind: 'fact', text: 'private' })).ok, false);
    assert.equal((await f.call('terminal_run', { projectId: f.a.id, command: 'pwd' })).ok, false);
    let externalCalls = 0;
    const extension = { ...f.registry.tools.get('get_project')!, name: 'extension_reader', async execute() { externalCalls++; return { secret: 'private' }; } };
    assert.equal((await executeAgentTool(extension, { projectId: f.a.id }, f.context())).ok, false);
    assert.equal(externalCalls, 0);
    for (const scope of ['project', 'session'] as const) {
      const input = { scope, ...(scope === 'project' ? { projectId: f.a.id } : {}), kind: 'fact', text: `scope-marker ${scope}` };
      const step = f.ledger.addStep(f.runId, { kind: 'tool', toolName: 'write_memory', toolCallId: scope, inputJson: JSON.stringify(input), effect: 'write' });
      const context = { ...f.context(), stepId: step.id };
      const actions = agentActions(context);
      const intent = actions.preview({ commandId: 'memory.write', input: agentActionInput('write_memory', input, context), idempotencyKey: step.id });
      const result = await executeAgentTool(f.registry.tools.get('write_memory')!, input, { ...context, platformIntentId: intent.id });
      assert.equal(result.ok, true, result.error);
    }
    assert.equal((await f.call('list_memory', { scope: 'project', projectId: f.a.id })).ok, true);
    assert.equal((await f.call('list_memory', { scope: 'session' })).ok, true);
  } finally { f.cleanup(); }
});

it('approval revalidation and direct PlatformActions cannot execute outside snapshot or after root drift', async () => {
  const f = fixture(); try {
    const input = { projectId: f.a.id, name: 'updated a' };
    const step = f.ledger.addStep(f.runId, { kind: 'tool', toolName: 'update_project', toolCallId: 'update', inputJson: JSON.stringify(input), effect: 'write' });
    const actions = agentActions({ ...f.context(), stepId: step.id });
    assert.throws(() => actions.preview({ commandId: 'project.metadata.update', input: { ...input, projectId: f.b.id }, idempotencyKey: step.id }));
    const intent = actions.preview({ commandId: 'project.metadata.update', input, idempotencyKey: step.id });
    const claim = f.ledger.claim(f.runId, 'scope-approval', 30000)!;
    f.ledger.waitApproval(claim, step);
    const pending = f.ledger.log.listPendingActions(f.runId)[0]!;
    f.db.prepare('UPDATE projects SET path=? WHERE id=?').run(join(f.root, 'drift'), f.a.id);
    const orchestrator = createCopilotOrchestrator({ db: f.db, masterKey: f.key, toolRegistry: f.registry, eventBus: new ForgeBadgerEventBus(), llm: {
      async stream() { throw new Error('must not call provider'); }, async summarize() { return ''; }, async generateTitle() { return ''; }
    } });
    await assert.rejects(orchestrator.resumeAfterApproval({ userId: f.user.id, runId: f.runId, actionId: pending.id, approved: true }), /CHANNEL_AUTHORITY_REJECTED/);
    assert.equal(f.ledger.log.getPendingAction(pending.id)?.status, 'pending');
    await assert.rejects(actions.execute(intent.id), /CHANNEL_AUTHORITY_REJECTED/);
    assert.equal(f.projects.getById(f.a.id)?.name, f.a.name);
  } finally { f.cleanup(); }
});

it('scope roots detect symlink retargeting and async revocation before a read result is disclosed', async () => {
  const f = fixture(); try {
    mkdirSync(join(f.root, 'target-a')); mkdirSync(join(f.root, 'target-b'));
    const link = join(f.root, 'scope-link'); symlinkSync(join(f.root, 'target-a'), link);
    const original = f.turn();
    // A newly admitted separate owner channel route would capture realpath. For
    // this bound run, turning its previously non-existing root into an escaping
    // symlink must invalidate the original snapshot immediately.
    symlinkSync(link, f.a.path);
    assert.equal((await f.call('get_project', { projectId: f.a.id })).ok, false);
    rmSync(f.a.path); assert.doesNotThrow(() => f.ledger.validateScope(original));
    let release!: () => void; let entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { entered = resolve; });
    const reader = { ...f.registry.tools.get('get_project')!, async execute() { entered(); await waiting; return { marker: 'do not disclose' }; } };
    const result = executeAgentTool(reader, { projectId: f.a.id }, f.context());
    await began; f.service.revokeIdentity(f.identity.id); release();
    assert.equal((await result).ok, false);
  } finally { f.cleanup(); }
});

it('artifact readback revalidates its original actual resource and rejects legacy source snapshots', async () => {
  const f = fixture(); try {
    const claim = f.ledger.claim(f.runId, 'artifact-owner', 30000)!;
    const inputJson = JSON.stringify({ projectId: f.a.id });
    const step = f.ledger.addStep(f.runId, { kind: 'tool', toolName: 'get_project', toolCallId: 'artifact', inputJson });
    f.ledger.startStep(claim, step);
    f.ledger.receipt(claim, step, JSON.stringify({ truncated: true, preview: 'small' }), false, preview => {
      const artifact = new CopilotToolArtifactRepository(f.db, f.user.id, f.key).store({ conversationId: f.turn().conversationId, runId: f.runId, stepId: step.id, toolName: 'get_project', inputJson }, JSON.stringify({ evidence: 'full a evidence' }));
      return JSON.stringify({ ...JSON.parse(preview), artifact });
    });
    const messageId = f.ledger.log.listRunMessages(f.runId).at(-1)!.id;
    const context = { ...f.context(), availableToolNames: ['get_project', 'read_tool_result'] };
    const tool = f.registry.tools.get('read_tool_result')!;
    const success = await executeAgentTool(tool, { messageId }, context);
    assert.equal(success.ok, true, success.error);
    assert.match(JSON.stringify(success.output), /full a evidence/);
    const legacy = { ...f.turn() }; delete legacy.channelScope;
    f.db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?').run(JSON.stringify(legacy), f.runId);
    assert.equal((await executeAgentTool(tool, { messageId }, context)).ok, false);
  } finally { f.cleanup(); }
});

it('startup fences old channel runs and descendants without resetting an unknown write or replaying it', () => {
  const f = fixture(); try {
    const childId = f.ledger.admit({ userId: f.user.id, conversationId: f.ledger.log.createConversation().id, userText: 'research',
      executionMode: 'research', parentRunId: f.runId, projectId: f.a.id }, 6);
    const claim = f.ledger.claim(f.runId, 'old-owner', 30000)!;
    const write = f.ledger.addStep(f.runId, { kind: 'tool', toolName: 'update_project', toolCallId: 'unknown-write', inputJson: JSON.stringify({ projectId: f.a.id, name: 'late' }), effect: 'write' });
    f.ledger.startStep(claim, write);
    const legacy = { ...f.turn() }; delete legacy.channelScope;
    f.db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?').run(JSON.stringify(legacy), f.runId);
    recoverLegacyChannelRuns(f.db, f.user.id);
    assert.equal(f.ledger.get(f.runId)?.status, 'cancelled');
    assert.equal(f.ledger.get(childId)?.status, 'cancelled');
    assert.equal(f.ledger.steps(f.runId).find(step => step.id === write.id)?.status, 'indeterminate');
    assert.equal(f.ledger.finish(claim, 'completed'), false);
    assert.equal(f.ledger.claim(f.runId, 'retry', 30000), undefined);
    assert.equal(f.projects.getById(f.a.id)?.name, f.a.name);
  } finally { f.cleanup(); }
});
