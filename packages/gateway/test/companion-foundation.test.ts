import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { it } from 'node:test';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';

import { UserRepository } from '../src/db/repositories/user-repository.js';
import { decryptSecret, type EncryptedSecret } from '../src/crypto/secret-box.js';
import { CompanionService } from '../src/services/companion/companion-service.js';
import { deriveCompanionPairingSas, generateCompanionIdentity } from '../src/services/companion/keys.js';
import { companionCommandEnvelopeSchema } from '../src/services/companion/protocol.js';

const migrationsFolder = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
const masterKey = randomBytes(32).toString('hex');

function fixture(enabled = true) {
  const db = new Sqlite(':memory:');
  migrate(drizzle(db), { migrationsFolder });
  const users = new UserRepository(db);
  const admin = users.create('companion-admin@test.dev', 'fixture', { role: 'admin' });
  const owner = users.create('companion-owner@test.dev', 'fixture');
  const other = users.create('companion-other@test.dev', 'fixture');
  const now = Date.now();
  const insertProject = (id: string, userId: string) => db.prepare(
    'INSERT INTO projects(id,user_id,name,path,ai_tool,status,is_imported,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, userId, id, `/private/tmp/${id}`, '', 'active', 0, now, now);
  insertProject('personal-project', owner.id);
  insertProject('foreign-project', other.id);
  insertProject('shared-project', owner.id);
  db.prepare('INSERT INTO teams(id,user_id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('shared-team', owner.id, owner.id, 'Shared', now, now);
  db.prepare('INSERT INTO team_projects(user_id,team_id,project_user_id,project_id,logical_owner_id) VALUES (?,?,?,?,?)')
    .run(owner.id, 'shared-team', owner.id, 'shared-project', owner.id);
  const service = new CompanionService(db, masterKey, enabled);
  return { db, admin, owner, other, service };
}

function enableHost(f: ReturnType<typeof fixture>) {
  return f.service.configureHost(f.admin.id, {
    enabled: true,
    relayUrl: 'wss://relay.example.test/companion',
    expectedRevision: 1
  });
}

function claimFor(f: ReturnType<typeof fixture>, qr: ReturnType<CompanionService['createPairing']>['qr']) {
  const identity = generateCompanionIdentity();
  return {
    input: {
      pairingId: qr.pairingId,
      secret: qr.secret,
      deviceName: 'Owner iPhone',
      signingPublicKey: identity.signingPublicKey,
      encryptionPublicKey: identity.encryptionPublicKey,
      claimNonce: randomBytes(32).toString('base64url')
    },
    identity
  };
}

it('rejects unknown command methods and extra protocol fields', () => {
  const command = {
    protocolVersion: 1,
    hostId: randomBytes(32).toString('hex'),
    deviceId: randomUUID(),
    commandId: randomUUID(),
    authorityRevision: 1,
    type: 'goal.answer',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    payloadDigest: randomBytes(32).toString('hex')
  };
  assert.equal(companionCommandEnvelopeSchema.parse(command).type, 'goal.answer');
  assert.throws(() => companionCommandEnvelopeSchema.parse({ ...command, type: 'shell.run' }));
  assert.throws(() => companionCommandEnvelopeSchema.parse({ ...command, arbitraryHttpPath: '/api/v1/projects' }));
});

it('persists host private keys encrypted and exposes only stable public metadata', () => {
  const f = fixture(false);
  try {
    assert.throws(() => enableHost(f), /COMPANION_DISABLED/);
    const enabled = new CompanionService(f.db, masterKey, true);
    assert.throws(() => enabled.configureHost(f.owner.id, {
      enabled: true, relayUrl: 'wss://relay.example.test', expectedRevision: 1
    }), /COMPANION_ADMIN_REQUIRED/);
    assert.throws(() => enabled.configureHost(f.admin.id, {
      enabled: true, relayUrl: 'ws://relay.example.test', expectedRevision: 1
    }));

    const configured = enabled.configureHost(f.admin.id, {
      enabled: true, relayUrl: 'wss://relay.example.test', expectedRevision: 1
    });
    assert.equal(configured.host.enabled, true);
    assert.match(configured.host.hostId, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(configured).includes('privateKey'), false);
    const again = enabled.getHostStatus();
    assert.equal(again.host?.hostId, configured.host.hostId);
    assert.equal(again.host?.signingPublicKey, configured.host.signingPublicKey);

    const row = f.db.prepare('SELECT * FROM companion_host').get() as Record<string, unknown>;
    const privateKeys = enabled.loadHostPrivateKeys();
    const signingPlaintext = decryptSecret(JSON.parse(row.signing_private_key_encrypted as string) as EncryptedSecret, { key: masterKey });
    const encryptionPlaintext = decryptSecret(JSON.parse(row.encryption_private_key_encrypted as string) as EncryptedSecret, { key: masterKey });
    assert.equal(signingPlaintext, privateKeys.signingPrivateKey);
    assert.equal(encryptionPlaintext, privateKeys.encryptionPrivateKey);
    assert.notEqual(row.signing_private_key_encrypted, privateKeys.signingPrivateKey);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.db.close(); }
});

it('requires an internal claim and exact SAS confirmation without persisting the pairing secret', () => {
  const f = fixture();
  try {
    enableHost(f);
    const issued = f.service.createPairing(f.owner.id, {
      projectIds: ['personal-project'],
      capabilities: ['status.read', 'goals.read', 'goals.answer']
    });
    assert.equal(issued.pairing.status, 'pending');
    assert.equal(issued.qr.secret.length, 43);
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM companion_pairings').all()).includes(issued.qr.secret), false);
    assert.equal(JSON.stringify(f.service.listPairings(f.owner.id)).includes(issued.qr.secret), false);
    assert.throws(() => f.service.confirmPairing(f.owner.id, issued.pairing.id, {
      revision: issued.pairing.revision, sas: '000000'
    }), /COMPANION_PAIRING_REJECTED/);

    const claim = claimFor(f, issued.qr);
    const claimed = f.service.claimPairing(claim.input);
    const expectedSas = deriveCompanionPairingSas({
      secret: issued.qr.secret,
      hostId: issued.qr.hostId,
      pairingId: issued.qr.pairingId,
      hostSigningPublicKey: issued.qr.hostSigningPublicKey,
      deviceSigningPublicKey: claim.identity.signingPublicKey,
      claimNonce: claim.input.claimNonce
    });
    assert.equal(claimed.sas, expectedSas);
    assert.match(claimed.sas, /^\d{6}$/);
    assert.throws(() => f.service.claimPairing(claim.input), /COMPANION_PAIRING_REJECTED/);
    assert.throws(() => f.service.confirmPairing(f.other.id, issued.pairing.id, {
      revision: claimed.pairing.revision, sas: claimed.sas
    }), /COMPANION_RESOURCE_NOT_FOUND/);
    assert.throws(() => f.service.confirmPairing(f.owner.id, issued.pairing.id, {
      revision: claimed.pairing.revision, sas: (Number(claimed.sas) + 1).toString().padStart(6, '0')
    }), /COMPANION_PAIRING_MISMATCH/);

    const { device } = f.service.confirmPairing(f.owner.id, issued.pairing.id, {
      revision: claimed.pairing.revision, sas: claimed.sas
    });
    assert.equal(device.status, 'active');
    assert.deepEqual(device.projectIds, ['personal-project']);
    assert.deepEqual(device.capabilities, ['status.read', 'goals.read', 'goals.answer']);
    assert.equal(JSON.stringify(device).includes('privateKey'), false);
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM audit_logs').all()).includes(issued.qr.secret), false);
  } finally { f.db.close(); }
});

it('enforces personal projects, tenant isolation, scope revisions and revocation', () => {
  const f = fixture();
  try {
    enableHost(f);
    for (const projectId of ['foreign-project', 'shared-project', 'missing-project']) {
      assert.throws(() => f.service.createPairing(f.owner.id, {
        projectIds: [projectId], capabilities: ['status.read']
      }), /COMPANION_AUTHORITY_REJECTED/);
    }
    const issued = f.service.createPairing(f.owner.id, {
      projectIds: ['personal-project'], capabilities: ['status.read', 'goals.read']
    });
    const claim = claimFor(f, issued.qr);
    const claimed = f.service.claimPairing(claim.input);
    const { device } = f.service.confirmPairing(f.owner.id, issued.pairing.id, {
      revision: claimed.pairing.revision, sas: claimed.sas
    });
    assert.deepEqual(f.service.listDevices(f.other.id), []);
    assert.throws(() => f.service.revokeDevice(f.other.id, device.id), /COMPANION_RESOURCE_NOT_FOUND/);

    const renamed = f.service.updateDevice(f.owner.id, device.id, {
      expectedRevision: device.authorityRevision, name: 'Renamed phone'
    });
    assert.equal(renamed.device.authorityRevision, device.authorityRevision);
    const rescoped = f.service.updateDevice(f.owner.id, device.id, {
      expectedRevision: device.authorityRevision, capabilities: ['status.read']
    });
    assert.equal(rescoped.device.authorityRevision, device.authorityRevision + 1);
    assert.throws(() => f.service.updateDevice(f.owner.id, device.id, {
      expectedRevision: device.authorityRevision, name: 'Stale update'
    }), /COMPANION_AUTHORITY_STALE/);
    f.service.revokeDevice(f.owner.id, device.id);
    assert.equal(f.service.listDevices(f.owner.id)[0]?.status, 'revoked');
    assert.throws(() => f.service.updateDevice(f.owner.id, device.id, {
      expectedRevision: rescoped.device.authorityRevision, name: 'Revoked update'
    }), /COMPANION_DEVICE_REVOKED/);
  } finally { f.db.close(); }
});

it('expires and supersedes pairings and revokes all authority on Relay changes', () => {
  const f = fixture();
  try {
    enableHost(f);
    const first = f.service.createPairing(f.owner.id, {
      projectIds: ['personal-project'], capabilities: ['status.read']
    });
    const second = f.service.createPairing(f.owner.id, {
      projectIds: ['personal-project'], capabilities: ['status.read']
    });
    assert.equal(f.service.listPairings(f.owner.id).find(item => item.id === first.pairing.id)?.status, 'cancelled');
    assert.throws(() => f.service.claimPairing(claimFor(f, first.qr).input), /COMPANION_PAIRING_REJECTED/);

    const claim = claimFor(f, second.qr);
    const claimed = f.service.claimPairing(claim.input);
    const { device } = f.service.confirmPairing(f.owner.id, second.pairing.id, {
      revision: claimed.pairing.revision, sas: claimed.sas
    });
    f.service.configureHost(f.admin.id, {
      enabled: true, relayUrl: 'wss://other-relay.example.test', expectedRevision: 1
    });
    assert.equal(f.service.listDevices(f.owner.id).find(item => item.id === device.id)?.status, 'revoked');

    const expired = f.service.createPairing(f.owner.id, {
      projectIds: ['personal-project'], capabilities: ['status.read']
    });
    f.db.prepare('UPDATE companion_pairings SET expires_at=0 WHERE id=?').run(expired.pairing.id);
    assert.throws(() => f.service.claimPairing(claimFor(f, expired.qr).input), /COMPANION_PAIRING_EXPIRED/);
  } finally { f.db.close(); }
});
