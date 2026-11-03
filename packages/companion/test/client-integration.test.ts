import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { CompanionClient, type CompanionClientState } from '../src/client/CompanionClient.js';
import { InMemoryPlatform } from './helpers/node-platform.js';
import { UserRepository } from '../../gateway/src/db/repositories/user-repository.js';
import { CompanionService } from '../../gateway/src/services/companion/companion-service.js';
import { CompanionHostRuntime } from '../../gateway/src/services/companion/host-runtime.js';
import { CopilotGoalStore } from '../../gateway/src/services/agent/goal-store.js';
import { CopilotConversationLog } from '../../gateway/src/services/agent/conversation-log.js';
import { ForgeBadgerEventBus } from '../../gateway/src/services/event-bus.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(testDirectory, '../../gateway/src/db/migrations');
const relayEntry = path.resolve(testDirectory, '../../relay/src/index.ts');

async function startRelay() {
  const child = spawn(process.execPath, ['--import', 'tsx', relayEntry], {
    env: { ...process.env, FORGEBADGER_RELAY_HOST: '127.0.0.1', FORGEBADGER_RELAY_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Relay startup timed out')), 5000);
    child.stdout.on('data', data => {
      const match = /\[relay\] listening (\{.*\})/.exec(data.toString());
      if (match) {
        clearTimeout(timer);
        resolve(JSON.parse(match[1]!).port);
      }
    });
    child.once('error', reject);
  });
  return { child, port };
}

async function stopRelay(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
}

async function waitFor(check: () => boolean, message: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

it('restores an encrypted read-only client through pairing, scope reset, reconnect, and revocation', { timeout: 25000 }, async () => {
  const relay = await startRelay();
  const db = new Sqlite(':memory:');
  let runtime: CompanionHostRuntime | undefined;
  let client: CompanionClient | undefined;
  try {
    migrate(drizzle(db), { migrationsFolder });
    const users = new UserRepository(db);
    const admin = users.create('client-admin@test.dev', 'fixture', { role: 'admin' });
    const owner = users.create('client-owner@test.dev', 'fixture');
    db.prepare('INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('client-project', owner.id, 'Client project', '/private/tmp/client-project', '', 'active', 0, Date.now(), Date.now());
    const masterKey = randomBytes(32).toString('hex');
    const service = new CompanionService(db, masterKey, true);
    service.configureHost(admin.id, {
      enabled: true, relayUrl: `wss://127.0.0.1:${relay.port}/companion/v1`, expectedRevision: 1
    });
    runtime = new CompanionHostRuntime(db, masterKey, true, {
      pollIntervalMs: 20,
      heartbeatIntervalMs: 100,
      allowPrivateNetworks: true,
      relayUrlTransform: url => url.replace('wss:', 'ws:')
    }, { db, masterKey, eventBus: new ForgeBadgerEventBus() });
    await runtime.start();
    const issued = service.createPairing(owner.id, {
      projectIds: ['client-project'],
      capabilities: ['status.read', 'goals.read', 'goals.answer', 'goals.control', 'approvals.decide']
    });
    const conversation = new CopilotConversationLog(db, owner.id).createConversation('Client conversation');
    const goals = new CopilotGoalStore(db, owner.id);
    const goal = goals.createGoal({ conversationId: conversation.id, projectId: 'client-project', title: 'Client goal', spec: 'Client spec' });
    goals.setPendingQuestion(goal.id, 'Proceed?');
    goals.setStatus(goal.id, 'blocked', 'awaiting_user');
    const platform = new InMemoryPlatform();
    client = new CompanionClient(platform);
    const states: CompanionClientState[] = [];
    client.subscribe(state => states.push(state));
    await client.pair(JSON.stringify(issued.qr), 'Client phone');
    await waitFor(() => client!.getState().status === 'awaiting_owner', 'SAS was not returned');
    const claimed = service.listPairings(owner.id)[0]!;
    assert.equal(client.getState().sas, claimed.sas);
    const { device } = service.confirmPairing(owner.id, issued.pairing.id, {
      revision: claimed.revision, sas: claimed.sas!
    });
    await waitFor(() => client!.getState().snapshot?.projects[0]?.id === 'client-project', 'Snapshot was not received');
    assert.equal(client.getState().snapshot?.device.id, device.id);
    assert.equal(client.getState().status, 'online');

    const answerReceipt = await client.executeCommand('goal.answer', { goalId: goal.id, answer: 'Proceed' });
    assert.equal(answerReceipt.status, 'succeeded');
    assert.equal(goals.getGoal(goal.id)?.status, 'active');

    const run = new CopilotConversationLog(db, owner.id).createRun(conversation.id, {});
    new CopilotConversationLog(db, owner.id).updateRun(run.id, { status: 'awaiting_approval' });
    db.prepare('UPDATE copilot_runs SET input_json=? WHERE id=?').run(JSON.stringify({
      userId: owner.id, conversationId: conversation.id, projectId: 'client-project', goalId: goal.id, source: 'user', userText: 'approve'
    }), run.id);
    const inputJson = JSON.stringify({ path: 'note.txt', content: 'approved' });
    const inputDigest = createHash('sha256').update(inputJson).digest('hex');
    const action = new CopilotConversationLog(db, owner.id).createPendingAction({ runId: run.id, tool: 'goal_file_write', inputJson, inputDigest });
    const stepId = randomUUID();
    db.prepare(`INSERT INTO copilot_run_steps(id,user_id,run_id,ordinal,kind,status,tool_call_id,tool_name,input_json,input_digest,effect)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(stepId, owner.id, run.id, 1, 'tool', 'awaiting_approval', 'call-1', 'goal_file_write', inputJson, inputDigest, 'write');
    db.prepare('UPDATE copilot_pending_actions SET step_id=?,tool_call_id=? WHERE id=?').run(stepId, 'call-1', action.id);
    const approvalReceipt = await client.executeCommand('approval.decide', {
      runId: run.id, actionId: action.id, approved: true, inputDigest
    });
    assert.equal(approvalReceipt.status, 'succeeded');
    assert.equal(new CopilotConversationLog(db, owner.id).getPendingAction(action.id)?.status, 'approved');

    service.updateDevice(owner.id, device.id, {
      expectedRevision: 1,
      capabilities: ['status.read']
    });
    await waitFor(() => client!.getState().snapshot?.device.authorityRevision === 2, 'Scope reset was not applied');

    client.close();
    client = new CompanionClient(platform);
    await client.restore();
    await waitFor(() => client!.getState().status === 'online', 'Client did not restore and reconnect');
    assert.equal(client.getState().snapshot?.device.authorityRevision, 2);
    assert.equal(platform.encryptedCache?.includes('Client project'), false);

    service.revokeDevice(owner.id, device.id);
    await waitFor(() => client!.getState().status === 'revoked', 'Revocation did not reach the client');
    client.close();
    client = undefined;
  } finally {
    client?.close();
    await runtime?.stop();
    await stopRelay(relay.child);
    db.close();
  }
});
