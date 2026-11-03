import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';

import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CompanionService } from '../src/services/companion/companion-service.js';
import { generateCompanionIdentity } from '../src/services/companion/keys.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

function fixture() {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder });
  const users = new UserRepository(db);
  const admin = users.create('readonly-admin@test.dev', 'fixture', { role: 'admin' });
  const owner = users.create('readonly-owner@test.dev', 'fixture');
  const other = users.create('readonly-other@test.dev', 'fixture');
  const service = new CompanionService(db, randomBytes(32).toString('hex'), true);
  service.configureHost(admin.id, { enabled: true, relayUrl: 'wss://relay.example.test', expectedRevision: 1 });
  const now = Date.now();
  db.prepare('INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('readonly-project', owner.id, 'Readonly project', '/private/tmp/readonly-project', '', 'active', 0, now, now);
  db.prepare('INSERT INTO sessions(id,user_id,project_id,name,ai_tool,status,working_dir,attach_token) VALUES (?,?,?,?,?,?,?,?)')
    .run('readonly-session', owner.id, 'readonly-project', 'CLI session', 'kimi', 'running', '/private/tmp/readonly-project', 'secret-attach-token');
  db.prepare('INSERT INTO copilot_conversations(id,user_id,created_at,updated_at) VALUES (?,?,?,?)')
    .run('readonly-conversation', owner.id, now, now);
  db.prepare(`INSERT INTO copilot_goals(id,user_id,conversation_id,project_id,title,spec,status,pending_question,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('readonly-goal', owner.id, 'readonly-conversation', 'readonly-project',
    'Goal title', 'private goal specification', 'blocked', 'Need owner answer', now, now);
  db.prepare('INSERT INTO copilot_goal_tasks(id,user_id,goal_id,seq,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('readonly-task', owner.id, 'readonly-goal', 1, 'Task', 'passes', now, now);
  db.prepare(`INSERT INTO notifications(id,user_id,type,category,title_key,message,href,payload,is_read,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('readonly-notification', owner.id, 'session_notification', 'attention',
    'attention', 'private terminal details', '/private/path', JSON.stringify({ project_id: 'readonly-project' }), 0, now, now);
  const issued = service.createPairing(owner.id, {
    projectIds: ['readonly-project'],
    capabilities: ['status.read', 'goals.read']
  });
  const identity = generateCompanionIdentity();
  const claimed = service.claimPairing({
    pairingId: issued.qr.pairingId,
    secret: issued.qr.secret,
    deviceName: 'Readonly phone',
    signingPublicKey: identity.signingPublicKey,
    encryptionPublicKey: identity.encryptionPublicKey,
    claimNonce: randomBytes(32).toString('base64url')
  });
  const { device } = service.confirmPairing(owner.id, issued.pairing.id, {
    revision: claimed.pairing.revision,
    sas: claimed.sas
  });
  return { db, admin, owner, other, service, device };
}

it('projects a scoped snapshot without credentials, terminal details, or goal specifications', () => {
  const f = fixture();
  try {
    const snapshot = f.service.getDeviceSnapshot(f.device.id, 1);
    assert.equal(snapshot.projects[0]?.id, 'readonly-project');
    assert.equal(snapshot.sessions[0]?.id, 'readonly-session');
    assert.equal(snapshot.goals[0]?.pendingQuestion, 'Need owner answer');
    assert.equal(snapshot.goals[0]?.taskPasses, 1);
    assert.equal(snapshot.attention[0]?.id, 'readonly-notification');
    const serialized = JSON.stringify(snapshot);
    assert.equal(serialized.includes('secret-attach-token'), false);
    assert.equal(serialized.includes('private terminal details'), false);
    assert.equal(serialized.includes('private goal specification'), false);
    assert.equal(serialized.includes('/private/path'), false);
    assert.equal(f.service.listDevices(f.other.id).length, 0);
    assert.throws(() => f.service.getDeviceSnapshot(f.device.id, 2), /COMPANION_AUTHORITY_STALE/);
  } finally { f.db.close(); }
});

it('synchronizes durable device events and requires reset after gaps or revocation', () => {
  const f = fixture();
  try {
    const initial = f.service.syncDeviceEvents(f.device.id, 1, 0);
    assert.equal(initial.reset, false);
    assert.equal(initial.events[0]?.type, 'device.confirmed');
    assert.equal(initial.events[0]?.payload.pairingId.length > 0, true);

    const updated = f.service.updateDevice(f.owner.id, f.device.id, {
      expectedRevision: 1,
      capabilities: ['status.read']
    });
    assert.equal(updated.device.authorityRevision, 2);
    assert.throws(() => f.service.syncDeviceEvents(f.device.id, 1, 1), /COMPANION_AUTHORITY_STALE/);
    const afterUpdate = f.service.syncDeviceEvents(f.device.id, 2, 1);
    assert.deepEqual(afterUpdate.events.map(event => event.type), ['device.updated', 'sync.reset']);
    assert.equal(f.service.syncDeviceEvents(f.device.id, 2, 99).reset, true);

    f.service.revokeDevice(f.owner.id, f.device.id);
    assert.throws(() => f.service.getDeviceSnapshot(f.device.id, 3), /COMPANION_DEVICE_REVOKED/);
    const hostEvents = f.service.listHostOutbox(0);
    assert.deepEqual(hostEvents.map(event => event.type), ['device.confirmed', 'device.updated', 'sync.reset', 'device.revoked']);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.db.close(); }
});
