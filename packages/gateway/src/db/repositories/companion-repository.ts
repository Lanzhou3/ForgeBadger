import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Database } from '../types.js';
import { companionDevices } from '../schema.js';

export interface CompanionHostRecord {
  id: string;
  hostId: string;
  relayUrl: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  signingPrivateKeyEncrypted: string;
  encryptionPrivateKeyEncrypted: string;
  enabled: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface CompanionPairingRecord {
  id: string;
  userId: string;
  hostId: string;
  hostRevision: number;
  tokenHash: string;
  status: string;
  revision: number;
  projectIds: string[];
  capabilities: string[];
  deviceName: string | null;
  deviceSigningPublicKey: string | null;
  deviceEncryptionPublicKey: string | null;
  claimNonce: string | null;
  sas: string | null;
  deviceId: string | null;
  expiresAt: number;
  createdAt: number;
}

export interface CompanionOutboxRecord {
  id: string;
  userId: string;
  deviceId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface CompanionDeviceRecord {
  id: string;
  userId: string;
  hostId: string;
  name: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  keyFingerprint: string;
  projectIds: string[];
  capabilities: string[];
  authorityRevision: number;
  status: string;
  pairedAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const hostColumns = `id,host_id AS hostId,relay_url AS relayUrl,signing_public_key AS signingPublicKey,
  encryption_public_key AS encryptionPublicKey,signing_private_key_encrypted AS signingPrivateKeyEncrypted,
  encryption_private_key_encrypted AS encryptionPrivateKeyEncrypted,enabled,revision,created_at AS createdAt,updated_at AS updatedAt`;
const pairingColumns = `id,user_id AS userId,host_id AS hostId,host_revision AS hostRevision,token_hash AS tokenHash,
  status,revision,project_ids_json AS projectIdsJson,capabilities_json AS capabilitiesJson,device_name AS deviceName,
  device_signing_public_key AS deviceSigningPublicKey,device_encryption_public_key AS deviceEncryptionPublicKey,
  claim_nonce AS claimNonce,sas,device_id AS deviceId,expires_at AS expiresAt,created_at AS createdAt`;
const outboxColumns = `id,user_id AS userId,device_id AS deviceId,sequence,event_type AS type,
  payload_json AS payloadJson,created_at AS createdAt`;
const deviceColumns = `id,user_id AS userId,host_id AS hostId,name,signing_public_key AS signingPublicKey,
  encryption_public_key AS encryptionPublicKey,key_fingerprint AS keyFingerprint,project_ids_json AS projectIdsJson,
  capabilities_json AS capabilitiesJson,authority_revision AS authorityRevision,status,paired_at AS pairedAt,
  last_seen_at AS lastSeenAt,revoked_at AS revokedAt,created_at AS createdAt,updated_at AS updatedAt`;

export function companionTransaction<T>(db: Database, fn: () => T): T {
  return db.transaction(fn).immediate();
}

export class CompanionHostRepository {
  constructor(private readonly db: Database) {}

  host(): CompanionHostRecord | undefined {
    const row = this.db.prepare(`SELECT ${hostColumns} FROM companion_host WHERE id='default'`).get() as
      (Omit<CompanionHostRecord, 'enabled'> & { enabled: number }) | undefined;
    return row ? { ...row, enabled: row.enabled === 1 } : undefined;
  }

  createHost(input: Omit<CompanionHostRecord, 'id' | 'createdAt' | 'updatedAt'>): CompanionHostRecord {
    const now = Date.now();
    this.db.prepare(`INSERT INTO companion_host(id,host_id,relay_url,signing_public_key,encryption_public_key,
      signing_private_key_encrypted,encryption_private_key_encrypted,enabled,revision,created_at,updated_at)
      VALUES ('default',?,?,?,?,?,?,?,?,?,?)`).run(
      input.hostId, input.relayUrl, input.signingPublicKey, input.encryptionPublicKey,
      input.signingPrivateKeyEncrypted, input.encryptionPrivateKeyEncrypted,
      input.enabled ? 1 : 0, input.revision, now, now
    );
    return this.host()!;
  }

  updateHost(relayUrl: string, enabled: boolean, expectedRevision: number, now: number): boolean {
    return this.db.prepare(`UPDATE companion_host SET relay_url=?,enabled=?,revision=revision+1,updated_at=?
      WHERE id='default' AND revision=?`).run(relayUrl, enabled ? 1 : 0, now, expectedRevision).changes === 1;
  }

  pairingOwner(pairingId: string): string | undefined {
    return (this.db.prepare('SELECT user_id AS userId FROM companion_pairings WHERE id=?')
      .get(pairingId) as { userId: string } | undefined)?.userId;
  }

  deviceOwner(deviceId: string): string | undefined {
    return (this.db.prepare('SELECT user_id AS userId FROM companion_devices WHERE id=?')
      .get(deviceId) as { userId: string } | undefined)?.userId;
  }

  outboxAfter(hostId: string, afterSequence: number): CompanionOutboxRecord[] {
    const rows = this.db.prepare(`SELECT o.id,o.user_id AS userId,o.device_id AS deviceId,o.sequence,
      o.event_type AS type,o.payload_json AS payloadJson,o.created_at AS createdAt
      FROM companion_outbox o JOIN companion_devices d ON d.user_id=o.user_id AND d.id=o.device_id
      WHERE d.host_id=? AND o.sequence>? ORDER BY o.created_at,o.rowid LIMIT 1000`).all(hostId, afterSequence) as OutboxRow[];
    return rows.map(outboxRecord);
  }

  revokeAllAuthority(now: number): void {
    this.db.prepare(`UPDATE companion_pairings SET status='cancelled',revision=revision+1
      WHERE status IN ('pending','claimed')`).run();
    const devices = this.db.prepare(`SELECT id,user_id AS userId FROM companion_devices WHERE status='active'`)
      .all() as Array<{ id: string; userId: string }>;
    for (const device of devices) {
      new CompanionDeviceRepository(this.db, device.userId).appendOutbox(device.id, 'device.revoked', {
        reason: 'host.relay_changed'
      }, now);
    }
    this.db.prepare(`UPDATE companion_devices SET status='revoked',authority_revision=authority_revision+1,
      revoked_at=?,updated_at=? WHERE status='active'`).run(now, now);
  }
}

export class CompanionDeviceRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  listPairings(): CompanionPairingRecord[] {
    const rows = this.db.prepare(`SELECT ${pairingColumns} FROM companion_pairings
      WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(this.userId) as PairingRow[];
    return rows.map(pairingRecord);
  }

  pairing(id: string): CompanionPairingRecord | undefined {
    const row = this.db.prepare(`SELECT ${pairingColumns} FROM companion_pairings WHERE user_id=? AND id=?`)
      .get(this.userId, id) as PairingRow | undefined;
    return row ? pairingRecord(row) : undefined;
  }

  createPairing(input: {
    hostId: string;
    hostRevision: number;
    tokenHash: string;
    projectIds: string[];
    capabilities: string[];
    expiresAt: number;
    now: number;
  }): CompanionPairingRecord {
    this.db.prepare(`UPDATE companion_pairings SET status='cancelled',revision=revision+1
      WHERE user_id=? AND status IN ('pending','claimed')`).run(this.userId);
    const id = randomUUID();
    this.db.prepare(`INSERT INTO companion_pairings(id,user_id,host_id,host_revision,token_hash,
      project_ids_json,capabilities_json,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, this.userId, input.hostId, input.hostRevision, input.tokenHash,
      JSON.stringify(input.projectIds), JSON.stringify(input.capabilities), input.expiresAt, input.now
    );
    return this.pairing(id)!;
  }

  claimPairing(pairing: CompanionPairingRecord, input: {
    deviceName: string;
    signingPublicKey: string;
    encryptionPublicKey: string;
    claimNonce: string;
    sas: string;
    now: number;
  }): boolean {
    return this.db.prepare(`UPDATE companion_pairings SET status='claimed',revision=revision+1,
      device_name=?,device_signing_public_key=?,device_encryption_public_key=?,claim_nonce=?,sas=?
      WHERE user_id=? AND id=? AND status='pending' AND revision=? AND host_revision=? AND expires_at>?`).run(
      input.deviceName, input.signingPublicKey, input.encryptionPublicKey, input.claimNonce, input.sas,
      this.userId, pairing.id, pairing.revision, pairing.hostRevision, input.now
    ).changes === 1;
  }

  confirmPairing(id: string, revision: number, now: number): boolean {
    return this.db.prepare(`UPDATE companion_pairings SET status='confirmed',revision=revision+1
      WHERE user_id=? AND id=? AND status='claimed' AND revision=? AND expires_at>?`)
      .run(this.userId, id, revision, now).changes === 1;
  }

  cancelPairing(id: string): void {
    this.db.prepare(`UPDATE companion_pairings SET status='cancelled',revision=revision+1
      WHERE user_id=? AND id=? AND status IN ('pending','claimed')`).run(this.userId, id);
  }

  listDevices(): CompanionDeviceRecord[] {
    const rows = this.db.prepare(`SELECT ${deviceColumns} FROM companion_devices
      WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(this.userId) as DeviceRow[];
    return rows.map(deviceRecord);
  }

  device(id: string): CompanionDeviceRecord | undefined {
    const row = this.db.prepare(`SELECT ${deviceColumns} FROM companion_devices WHERE user_id=? AND id=?`)
      .get(this.userId, id) as DeviceRow | undefined;
    return row ? deviceRecord(row) : undefined;
  }

  createDevice(pairing: CompanionPairingRecord, keyFingerprint: string, now: number): CompanionDeviceRecord {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO companion_devices(id,user_id,host_id,name,signing_public_key,encryption_public_key,
      key_fingerprint,project_ids_json,capabilities_json,paired_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, this.userId, pairing.hostId, pairing.deviceName, pairing.deviceSigningPublicKey,
      pairing.deviceEncryptionPublicKey, keyFingerprint, JSON.stringify(pairing.projectIds),
      JSON.stringify(pairing.capabilities), now, now, now
    );
    return this.device(id)!;
  }

  updateDevice(device: CompanionDeviceRecord, input: {
    name: string;
    projectIds: string[];
    capabilities: string[];
    scopeChanged: boolean;
    now: number;
  }): boolean {
    const changed = drizzle(this.db).update(companionDevices).set({
      name: input.name,
      projectIdsJson: JSON.stringify(input.projectIds),
      capabilitiesJson: JSON.stringify(input.capabilities),
      ...(input.scopeChanged ? { authorityRevision: device.authorityRevision + 1 } : {}),
      updatedAt: input.now
    }).where(and(
      eq(companionDevices.userId, this.userId),
      eq(companionDevices.id, device.id),
      eq(companionDevices.status, 'active'),
      eq(companionDevices.authorityRevision, device.authorityRevision)
    )).run();
    return changed.changes === 1;
  }

  revokeDevice(id: string, now: number): void {
    this.db.prepare(`UPDATE companion_devices SET status='revoked',authority_revision=authority_revision+1,
      revoked_at=?,updated_at=? WHERE user_id=? AND id=? AND status='active'`).run(now, now, this.userId, id);
  }

  linkPairingDevice(pairingId: string, deviceId: string): void {
    this.db.prepare('UPDATE companion_pairings SET device_id=? WHERE user_id=? AND id=?')
      .run(deviceId, this.userId, pairingId);
  }

  appendOutbox(deviceId: string, type: string, payload: Record<string, unknown>, now: number): CompanionOutboxRecord {
    const sequence = this.latestOutboxSequence(deviceId) + 1;
    const id = randomUUID();
    this.db.prepare(`INSERT INTO companion_outbox(id,user_id,device_id,sequence,event_type,payload_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(id, this.userId, deviceId, sequence, type, JSON.stringify(payload), now);
    this.db.prepare(`DELETE FROM companion_outbox WHERE user_id=? AND device_id=? AND sequence<=?`)
      .run(this.userId, deviceId, sequence - 1000);
    return this.outboxAfter(deviceId, sequence - 1)[0]!;
  }

  outboxAfter(deviceId: string, afterSequence: number): CompanionOutboxRecord[] {
    const rows = this.db.prepare(`SELECT ${outboxColumns} FROM companion_outbox
      WHERE user_id=? AND device_id=? AND sequence>? ORDER BY sequence LIMIT 1000`)
      .all(this.userId, deviceId, afterSequence) as OutboxRow[];
    return rows.map(outboxRecord);
  }

  earliestOutboxSequence(deviceId: string): number {
    return (this.db.prepare(`SELECT COALESCE(MIN(sequence),0) AS sequence FROM companion_outbox
      WHERE user_id=? AND device_id=?`).get(this.userId, deviceId) as { sequence: number }).sequence;
  }

  latestOutboxSequence(deviceId: string): number {
    return (this.db.prepare(`SELECT COALESCE(MAX(sequence),0) AS sequence FROM companion_outbox
      WHERE user_id=? AND device_id=?`).get(this.userId, deviceId) as { sequence: number }).sequence;
  }
}

interface PairingRow extends Omit<CompanionPairingRecord, 'projectIds' | 'capabilities'> {
  projectIdsJson: string;
  capabilitiesJson: string;
}
interface DeviceRow extends Omit<CompanionDeviceRecord, 'projectIds' | 'capabilities'> {
  projectIdsJson: string;
  capabilitiesJson: string;
}
interface OutboxRow extends Omit<CompanionOutboxRecord, 'payload'> {
  payloadJson: string;
}
function pairingRecord(row: PairingRow): CompanionPairingRecord {
  return { ...row, projectIds: JSON.parse(row.projectIdsJson), capabilities: JSON.parse(row.capabilitiesJson) };
}
function deviceRecord(row: DeviceRow): CompanionDeviceRecord {
  return { ...row, projectIds: JSON.parse(row.projectIdsJson), capabilities: JSON.parse(row.capabilitiesJson) };
}
function outboxRecord(row: OutboxRow): CompanionOutboxRecord {
  return { ...row, payload: JSON.parse(row.payloadJson) };
}
