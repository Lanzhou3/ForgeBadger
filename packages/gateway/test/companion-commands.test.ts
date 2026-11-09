import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';

import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CompanionCommandRepository } from '../src/db/repositories/companion-command-repository.js';
import { encryptSecret } from '../src/crypto/secret-box.js';
import { CompanionService } from '../src/services/companion/companion-service.js';
import { CompanionCommandService, companionPayloadDigest } from '../src/services/companion/command-service.js';
import { generateCompanionIdentity } from '../src/services/companion/keys.js';
import { CopilotGoalStore } from '../src/services/agent/goal-store.js';
import { CopilotConversationLog } from '../src/services/agent/conversation-log.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import type { InMemorySessionManager } from '../src/services/session-manager.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
const masterKey = randomBytes(32).toString('hex');

function fixture() {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder });
  const users = new UserRepository(db);
  const admin = users.create('command-admin@test.dev', 'fixture', { role: 'admin' });
  const owner = users.create('command-owner@test.dev', 'fixture');
  const other = users.create('command-other@test.dev', 'fixture');
  const companion = new CompanionService(db, masterKey, true);
  companion.configureHost(admin.id, { enabled: true, relayUrl: 'wss://relay.example.test', expectedRevision: 1 });
  const now = Date.now();
  db.prepare('INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('command-project', owner.id, 'Command project', '/private/tmp/command-project', '', 'active', 0, now, now);
  const issued = companion.createPairing(owner.id, {
    projectIds: ['command-project'],
    capabilities: ['status.read', 'goals.read', 'goals.create', 'goals.answer', 'goals.control', 'approvals.decide', 'runs.stop']
  });
  const identity = generateCompanionIdentity();
  const claimed = companion.claimPairing({
    pairingId: issued.qr.pairingId, secret: issued.qr.secret, deviceName: 'Command phone',
    signingPublicKey: identity.signingPublicKey, encryptionPublicKey: identity.encryptionPublicKey,
    claimNonce: randomBytes(32).toString('base64url')
  });
  const { device } = companion.confirmPairing(owner.id, issued.pairing.id, {
    revision: claimed.pairing.revision, sas: claimed.sas
  });
  const eventBus = new ForgeBadgerEventBus();
  const commands = new CompanionCommandService(db, masterKey, {
    db, masterKey, eventBus, sessionManager: {} as InMemorySessionManager
  });
  const conversation = new CopilotConversationLog(db, owner.id).createConversation('Command conversation');
  const goals = new CopilotGoalStore(db, owner.id);
  return { db, admin, owner, other, companion, commands, conversation, goals, device };
}

function command(f: ReturnType<typeof fixture>, type: string, payload: unknown, commandId = randomUUID()) {
  return {
    protocolVersion: 1,
    hostId: f.companion.getHostStatus().host!.hostId,
    deviceId: f.device.id,
    commandId,
    authorityRevision: 1,
    type,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 60_000,
    payloadDigest: companionPayloadDigest(payload),
    payload
  };
}

it('answers a Goal exactly once and rejects conflicting command-id reuse', async () => {
  const f = fixture();
  try {
    const goal = f.goals.createGoal({ conversationId: f.conversation.id, projectId: 'command-project', title: 'Answer goal', spec: 'Answer spec' });
    f.goals.setPendingQuestion(goal.id, 'Continue?');
    f.goals.setStatus(goal.id, 'blocked', 'awaiting_user');
    const id = randomUUID();
    const first = await f.commands.execute(command(f, 'goal.answer', { goalId: goal.id, answer: 'Ship it' }, id));
    const second = await f.commands.execute(command(f, 'goal.answer', { goalId: goal.id, answer: 'Ship it' }, id));
    assert.equal(first.status, 'succeeded');
    assert.equal(second.status, 'succeeded');
    assert.equal(second.updatedAt, first.updatedAt);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM copilot_goal_journal WHERE note=?').get('Owner answer: Ship it').n, 1);
    assert.equal(f.goals.getGoal(goal.id)?.status, 'active');
    await assert.rejects(() => f.commands.execute(command(f, 'goal.answer', { goalId: goal.id, answer: 'Different' }, id)), /COMPANION_COMMAND_CONFLICT/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM companion_commands').get().n, 1);
  } finally { f.db.close(); }
});

it('creates Goals without autonomous grants and applies lifecycle and run-stop commands', async () => {
  const f = fixture();
  try {
    const created = await f.commands.execute(command(f, 'goal.create', {
      projectId: 'command-project', title: 'Remote goal', spec: 'Implement one focused task'
    }));
    assert.equal(created.status, 'succeeded', created.errorCode ?? undefined);
    const goal = f.goals.getGoal(created.resultReference!);
    assert.equal(goal?.grants_json, '[]');
    assert.equal(goal?.project_id, 'command-project');
    assert.notEqual(goal?.conversation_id, f.conversation.id);

    const paused = await f.commands.execute(command(f, 'goal.pause', { goalId: goal!.id }));
    assert.equal(paused.status, 'succeeded');
    assert.equal(f.goals.getGoal(goal!.id)?.status, 'paused');
    await f.commands.execute(command(f, 'goal.resume', { goalId: goal!.id }));
    assert.equal(f.goals.getGoal(goal!.id)?.status, 'active');
    await f.commands.execute(command(f, 'goal.cancel', { goalId: goal!.id }));
    assert.equal(f.goals.getGoal(goal!.id)?.status, 'cancelled');

    const run = new CopilotConversationLog(f.db, f.owner.id).createRun(f.conversation.id, {});
    f.db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?').run(JSON.stringify({ projectId: 'command-project' }), run.id);
    const stopped = await f.commands.execute(command(f, 'run.stop', { runId: run.id }));
    assert.equal(stopped.status, 'succeeded');
    assert.equal(new CopilotConversationLog(f.db, f.owner.id).getRun(run.id)?.status, 'cancelled');
  } finally { f.db.close(); }
});

it('requires exact approval scope and input digest before recording a decision', async () => {
  const f = fixture();
  try {
    const log = new CopilotConversationLog(f.db, f.owner.id);
    const run = log.createRun(f.conversation.id, {});
    const approvalGoal = f.goals.createGoal({ conversationId: f.conversation.id, projectId: 'command-project', title: 'Approval goal', spec: 'Approval spec' });
    log.updateRun(run.id, { status: 'awaiting_approval' });
    f.db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?').run(JSON.stringify({
      userId: f.owner.id, conversationId: f.conversation.id, projectId: 'command-project', goalId: approvalGoal.id, source: 'user', userText: 'test'
    }), run.id);
    const inputJson = JSON.stringify({ path: 'note.txt', content: 'test' });
    const inputDigest = createHash('sha256').update(inputJson).digest('hex');
    const action = log.createPendingAction({ runId: run.id, tool: 'goal_file_write', inputJson, inputDigest });
    const stepId = randomUUID();
    f.db.prepare(`INSERT INTO copilot_run_steps(id,user_id,run_id,ordinal,kind,status,tool_call_id,tool_name,input_json,input_digest,effect)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(stepId, f.owner.id, run.id, 1, 'tool', 'awaiting_approval', 'call-1', 'goal_file_write', inputJson, inputDigest, 'write');
    f.db.prepare('UPDATE copilot_pending_actions SET step_id=?,tool_call_id=? WHERE id=?').run(stepId, 'call-1', action.id);
    const stale = await f.commands.execute(command(f, 'approval.decide', {
      runId: run.id, actionId: action.id, approved: true, inputDigest: randomBytes(32).toString('hex')
    }));
    assert.equal(stale.status, 'failed');
    assert.equal(stale.errorCode, 'COMPANION_APPROVAL_STALE');
    assert.equal(log.getPendingAction(action.id)?.status, 'pending');

    const decided = await f.commands.execute(command(f, 'approval.decide', {
      runId: run.id, actionId: action.id, approved: true, inputDigest
    }));
    assert.equal(decided.status, 'succeeded', decided.errorCode ?? undefined);
    assert.equal(log.getPendingAction(action.id)?.status, 'approved');

    const otherRun = log.createRun(f.conversation.id, {});
    otherRun && f.db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?').run(JSON.stringify({ projectId: 'other-project' }), otherRun.id);
    const otherAction = log.createPendingAction({ runId: otherRun.id, tool: 'goal_file_write', inputJson, inputDigest });
    const outOfScope = await f.commands.execute(command(f, 'approval.decide', {
      runId: otherRun.id, actionId: otherAction.id, approved: false, inputDigest
    }));
    assert.equal(outOfScope.status, 'failed');
    assert.equal(outOfScope.errorCode, 'COMPANION_AUTHORITY_REJECTED');
  } finally { f.db.close(); }
});


it('reconciles proven effects during recovery without replaying uncertain commands', () => {
  const f = fixture();
  try {
    const goal = f.goals.createGoal({ conversationId: f.conversation.id, projectId: 'command-project', title: 'Recover goal', spec: 'Recover spec' });
    const repository = new CompanionCommandRepository(f.db, f.owner.id);
    const now = Date.now();
    const paused = repository.create({
      id: randomUUID(), deviceId: f.device.id, type: 'goal.pause',
      payloadEncrypted: JSON.stringify(encryptSecret(JSON.stringify({ goalId: goal.id }), { key: masterKey })),
      payloadDigest: companionPayloadDigest({ goalId: goal.id }), authorityRevision: 1,
      resultReference: goal.id, now
    });
    f.goals.setStatus(goal.id, 'paused');

    const answerGoal = f.goals.createGoal({ conversationId: f.conversation.id, projectId: 'command-project', title: 'Uncertain goal', spec: 'Uncertain spec' });
    f.goals.setPendingQuestion(answerGoal.id, 'Continue?');
    f.goals.setStatus(answerGoal.id, 'blocked', 'awaiting_user');
    const uncertain = repository.create({
      id: randomUUID(), deviceId: f.device.id, type: 'goal.answer',
      payloadEncrypted: JSON.stringify(encryptSecret(JSON.stringify({ goalId: answerGoal.id, answer: 'Do not replay' }), { key: masterKey })),
      payloadDigest: companionPayloadDigest({ goalId: answerGoal.id, answer: 'Do not replay' }), authorityRevision: 1,
      resultReference: answerGoal.id, now
    });

    f.commands.recoverCommands();
    assert.equal(repository.get(f.device.id, paused.id)?.status, 'succeeded');
    assert.equal(repository.get(f.device.id, uncertain.id)?.status, 'unknown');
    assert.equal(f.goals.getGoal(answerGoal.id)?.status, 'blocked');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM copilot_goal_journal WHERE note=?').get('Owner answer: Do not replay').n, 0);
  } finally { f.db.close(); }
});
