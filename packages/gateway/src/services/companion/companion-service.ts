import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../../crypto/secret-box.js';
import type { Database } from '../../db/types.js';
import {
  CompanionDeviceRepository,
  CompanionHostRepository,
  companionTransaction,
  type CompanionDeviceRecord,
  type CompanionHostRecord,
  type CompanionPairingRecord
} from '../../db/repositories/companion-repository.js';
import { CompanionCommandRepository } from '../../db/repositories/companion-command-repository.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { UserRepository } from '../../db/repositories/user-repository.js';
import { AuditLogRepository } from '../../db/repositories/audit-log-repository.js';
import { userIsInstanceAdmin } from '../../auth/middleware.js';
import {
  COMPANION_PROTOCOL_VERSION,
  companionDeviceUpdateSchema,
  companionHostConfigurationSchema,
  companionPairingClaimSchema,
  companionPairingConfirmationSchema,
  companionPairingCreateSchema,
  companionPairingQrSchema
} from './protocol.js';
import {
  assertCompanionPublicKey,
  companionHostId,
  deriveCompanionPairingSas,
  generateCompanionIdentity
} from './keys.js';

export class CompanionError extends Error {
  constructor(readonly code: string, readonly status = 403) {
    super(code);
  }
}

export class CompanionService {
  private readonly hostRecords: CompanionHostRepository;
  constructor(
    private readonly db: Database,
    private readonly masterKey: string,
    private readonly featureEnabled: boolean,
    private readonly now: () => number = Date.now
  ) {
    this.hostRecords = new CompanionHostRepository(db);
  }

  getHostStatus() {
    const host = this.hostRecords.host();
    return { featureEnabled: this.featureEnabled, host: host ? this.hostDto(host) : null };
  }

  configureHost(userId: string, raw: unknown) {
    const input = companionHostConfigurationSchema.parse(raw);
    if (input.enabled && !this.featureEnabled) throw new CompanionError('COMPANION_DISABLED');
    if (!userIsInstanceAdmin(this.db, userId)) throw new CompanionError('COMPANION_ADMIN_REQUIRED');
    const relayUrl = parseRelayUrl(input.relayUrl);
    return this.transaction(() => {
      const existing = this.hostRecords.host();
      if (existing && existing.revision !== input.expectedRevision) {
        throw new CompanionError('COMPANION_AUTHORITY_STALE', 409);
      }
      if (!existing && input.expectedRevision !== 1) throw new CompanionError('COMPANION_AUTHORITY_STALE', 409);
      if (existing && existing.relayUrl === relayUrl && existing.enabled === input.enabled) {
        return { host: this.hostDto(existing) };
      }
      const relayChanged = existing !== undefined && existing.relayUrl !== relayUrl;
      if (existing) {
        if (!this.hostRecords.updateHost(relayUrl, input.enabled, input.expectedRevision, this.now())) {
          throw new CompanionError('COMPANION_AUTHORITY_STALE', 409);
        }
        if (relayChanged) this.hostRecords.revokeAllAuthority(this.now());
      } else {
        const identity = generateCompanionIdentity();
        this.hostRecords.createHost({
          hostId: companionHostId(identity.signingPublicKey),
          relayUrl,
          signingPublicKey: identity.signingPublicKey,
          encryptionPublicKey: identity.encryptionPublicKey,
          signingPrivateKeyEncrypted: JSON.stringify(encryptSecret(identity.signingPrivateKey, { key: this.masterKey })),
          encryptionPrivateKeyEncrypted: JSON.stringify(encryptSecret(identity.encryptionPrivateKey, { key: this.masterKey })),
          enabled: input.enabled,
          revision: 1
        });
      }
      this.audit(userId, relayChanged ? 'companion.host.relay_change' : 'companion.host.configure', 'default');
      return { host: this.hostDto(this.hostRecords.host()!) };
    });
  }

  loadHostPrivateKeys() {
    const host = this.hostRecords.host();
    if (!host) throw new CompanionError('COMPANION_HOST_NOT_CONFIGURED', 409);
    return {
      hostId: host.hostId,
      revision: host.revision,
      signingPrivateKey: decryptSecret(JSON.parse(host.signingPrivateKeyEncrypted) as EncryptedSecret, { key: this.masterKey }),
      encryptionPrivateKey: decryptSecret(JSON.parse(host.encryptionPrivateKeyEncrypted) as EncryptedSecret, { key: this.masterKey })
    };
  }

  createPairing(userId: string, raw: unknown) {
    const input = companionPairingCreateSchema.parse(raw);
    return this.transaction(() => {
      this.actor(userId);
      const host = this.activeHost();
      this.validateProjects(userId, input.projectIds);
      const secret = randomBytes(32).toString('base64url');
      const pairing = this.records(userId).createPairing({
        hostId: host.hostId,
        hostRevision: host.revision,
        tokenHash: tokenHash(secret),
        projectIds: input.projectIds,
        capabilities: input.capabilities,
        expiresAt: this.now() + 600_000,
        now: this.now()
      });
      const qr = companionPairingQrSchema.parse({
        protocolVersion: COMPANION_PROTOCOL_VERSION,
        pairingId: pairing.id,
        secret,
        relayUrl: host.relayUrl,
        hostId: host.hostId,
        hostSigningPublicKey: host.signingPublicKey,
        hostEncryptionPublicKey: host.encryptionPublicKey
      });
      this.audit(userId, 'companion.pairing.create', pairing.id);
      return { pairing: this.pairingDto(pairing), qr };
    });
  }

  claimPairing(raw: unknown) {
    const input = companionPairingClaimSchema.parse(raw);
    assertCompanionPublicKey(input.signingPublicKey, 'ed25519');
    assertCompanionPublicKey(input.encryptionPublicKey, 'x25519');
    return this.transaction(() => {
      const userId = this.hostRecords.pairingOwner(input.pairingId);
      if (!userId) throw new CompanionError('COMPANION_PAIRING_REJECTED');
      const records = this.records(userId);
      const pairing = records.pairing(input.pairingId);
      if (!pairing) throw new CompanionError('COMPANION_PAIRING_REJECTED');
      if (pairing.status !== 'pending' || pairing.tokenHash !== tokenHash(input.secret)) {
        throw new CompanionError('COMPANION_PAIRING_REJECTED');
      }
      if (pairing.expiresAt <= this.now()) throw new CompanionError('COMPANION_PAIRING_EXPIRED', 409);
      const host = this.activeHost();
      this.actor(userId);
      if (host.hostId !== pairing.hostId || host.revision !== pairing.hostRevision) {
        throw new CompanionError('COMPANION_HOST_REVISION_CHANGED', 409);
      }
      const sas = deriveCompanionPairingSas({
        secret: input.secret,
        hostId: host.hostId,
        pairingId: pairing.id,
        hostSigningPublicKey: host.signingPublicKey,
        deviceSigningPublicKey: input.signingPublicKey,
        claimNonce: input.claimNonce
      });
      if (!records.claimPairing(pairing, {
        deviceName: input.deviceName,
        signingPublicKey: input.signingPublicKey,
        encryptionPublicKey: input.encryptionPublicKey,
        claimNonce: input.claimNonce,
        sas,
        now: this.now()
      })) throw new CompanionError('COMPANION_PAIRING_REJECTED');
      this.audit(userId, 'companion.pairing.claim', pairing.id);
      return { pairing: this.pairingDto(records.pairing(pairing.id)!), sas };
    });
  }

  confirmPairing(userId: string, pairingId: string, raw: unknown) {
    const input = companionPairingConfirmationSchema.parse(raw);
    return this.transaction(() => {
      this.actor(userId);
      const host = this.activeHost();
      const records = this.records(userId);
      const pairing = records.pairing(pairingId);
      if (!pairing) throw new CompanionError('COMPANION_RESOURCE_NOT_FOUND', 404);
      if (pairing.expiresAt <= this.now()) throw new CompanionError('COMPANION_PAIRING_EXPIRED', 409);
      if (pairing.status !== 'claimed' || !pairing.deviceSigningPublicKey || !pairing.sas) {
        throw new CompanionError('COMPANION_PAIRING_REJECTED');
      }
      if (pairing.revision !== input.revision) throw new CompanionError('COMPANION_AUTHORITY_STALE', 409);
      if (!safeEqual(pairing.sas, input.sas)) throw new CompanionError('COMPANION_PAIRING_MISMATCH');
      if (host.hostId !== pairing.hostId || host.revision !== pairing.hostRevision) {
        throw new CompanionError('COMPANION_HOST_REVISION_CHANGED', 409);
      }
      if (!records.confirmPairing(pairing.id, input.revision, this.now())) {
        throw new CompanionError('COMPANION_PAIRING_REJECTED');
      }
      const device = records.createDevice(
        records.pairing(pairing.id)!,
        createHash('sha256').update(pairing.deviceSigningPublicKey).digest('hex'),
        this.now()
      );
      records.linkPairingDevice(pairing.id, device.id);
      records.appendOutbox(device.id, 'device.confirmed', {
        pairingId: pairing.id,
        device: this.deviceDto(device)
      }, this.now());
      this.audit(userId, 'companion.device.confirm', device.id);
      return { device: this.deviceDto(device) };
    });
  }

  listPairings(userId: string) {
    this.actor(userId);
    return this.records(userId).listPairings().map(pairing => this.pairingDto(pairing));
  }

  cancelPairing(userId: string, pairingId: string) {
    return this.transaction(() => {
      this.actor(userId);
      const records = this.records(userId);
      if (!records.pairing(pairingId)) throw new CompanionError('COMPANION_RESOURCE_NOT_FOUND', 404);
      records.cancelPairing(pairingId);
      this.audit(userId, 'companion.pairing.cancel', pairingId);
    });
  }

  listDevices(userId: string) {
    this.actor(userId);
    return this.records(userId).listDevices().map(device => this.deviceDto(device));
  }

  updateDevice(userId: string, deviceId: string, raw: unknown) {
    const input = companionDeviceUpdateSchema.parse(raw);
    return this.transaction(() => {
      this.actor(userId);
      const records = this.records(userId);
      const device = records.device(deviceId);
      if (!device) throw new CompanionError('COMPANION_RESOURCE_NOT_FOUND', 404);
      if (device.status !== 'active') throw new CompanionError('COMPANION_DEVICE_REVOKED');
      if (device.authorityRevision !== input.expectedRevision) {
        throw new CompanionError('COMPANION_AUTHORITY_STALE', 409);
      }
      const projectIds = input.projectIds ?? device.projectIds;
      const capabilities = input.capabilities ?? device.capabilities;
      this.validateProjects(userId, projectIds);
      const scopeChanged = JSON.stringify(projectIds) !== JSON.stringify(device.projectIds)
        || JSON.stringify(capabilities) !== JSON.stringify(device.capabilities);
      if (!records.updateDevice(device, {
        name: input.name ?? device.name,
        projectIds,
        capabilities,
        scopeChanged,
        now: this.now()
      })) throw new CompanionError('COMPANION_AUTHORITY_STALE', 409);
      const updated = records.device(device.id)!;
      records.appendOutbox(device.id, 'device.updated', { device: this.deviceDto(updated) }, this.now());
      if (scopeChanged) records.appendOutbox(device.id, 'sync.reset', { authorityRevision: updated.authorityRevision }, this.now());
      this.audit(userId, 'companion.device.update', device.id);
      return { device: this.deviceDto(updated) };
    });
  }

  revokeDevice(userId: string, deviceId: string) {
    return this.transaction(() => {
      this.actor(userId);
      const records = this.records(userId);
      const device = records.device(deviceId);
      if (!device) throw new CompanionError('COMPANION_RESOURCE_NOT_FOUND', 404);
      if (device.status === 'active') {
        records.revokeDevice(device.id, this.now());
        records.appendOutbox(device.id, 'device.revoked', {
          device: this.deviceDto(records.device(device.id)!)
        }, this.now());
        this.audit(userId, 'companion.device.revoke', device.id);
      }
    });
  }

  getDeviceSnapshot(deviceId: string, authorityRevision: number) {
    z.number().int().positive().parse(authorityRevision);
    return this.transaction(() => {
      const { records, device, userId } = this.deviceAuthority(deviceId, authorityRevision);
      const projects = new ProjectRepository(this.db, userId).list()
        .filter(project => device.projectIds.includes(project.id))
        .map(project => ({
          id: project.id,
          name: project.name,
          status: project.status,
          updatedAt: project.updatedAt.getTime()
        }));
      const sessions = device.projectIds.flatMap(projectId => {
        const rows = this.db.prepare(`SELECT id,project_id AS projectId,name,ai_tool AS aiTool,status,
          last_active AS lastActive,updated_at AS updatedAt FROM sessions
          WHERE user_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 20`).all(userId, projectId) as SessionProjectionRow[];
        return rows;
      });
      const goals = device.capabilities.includes('goals.read') ? device.projectIds.flatMap(projectId => {
        const rows = this.db.prepare(`SELECT id,project_id AS projectId,title,status,blocked_reason AS blockedReason,
          pending_question AS pendingQuestion,updated_at AS updatedAt FROM copilot_goals
          WHERE user_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 20`).all(userId, projectId) as GoalProjectionRow[];
        return rows.map(row => {
          const counts = this.db.prepare(`SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status='passes' THEN 1 ELSE 0 END),0) AS passes
            FROM copilot_goal_tasks WHERE user_id=? AND goal_id=?`).get(userId, row.id) as { total: number; passes: number };
          return { ...row, taskTotal: counts.total, taskPasses: counts.passes };
        });
      }) : [];
      const attentionRows = this.db.prepare(`SELECT id,type,category,session_id AS sessionId,payload,
        created_at AS createdAt FROM notifications WHERE user_id=? AND is_read=0
        ORDER BY created_at DESC LIMIT 500`).all(userId) as NotificationProjectionRow[];
      const attention = attentionRows.flatMap(row => {
        const projectId = notificationProjectId(row.payload);
        if (!projectId || !device.projectIds.includes(projectId)) return [];
        return [{ id: row.id, type: row.type, category: row.category, sessionId: row.sessionId, projectId, createdAt: row.createdAt }];
      });
      const approvals = device.capabilities.includes('approvals.decide') ? device.projectIds.flatMap(projectId => {
        const rows = this.db.prepare(`SELECT a.id,a.run_id AS runId,a.tool,a.input_json AS inputJson,
          a.input_digest AS inputDigest,a.created_at AS createdAt FROM copilot_pending_actions a
          JOIN copilot_runs r ON r.user_id=a.user_id AND r.id=a.run_id
          WHERE a.user_id=? AND a.status='pending' AND json_extract(r.input_json,'$.projectId')=?
          ORDER BY a.created_at LIMIT 100`).all(userId, projectId) as ApprovalProjectionRow[];
        return rows.map(row => ({
          id: row.id,
          runId: row.runId,
          tool: row.tool,
          input: safeJsonObject(row.inputJson),
          inputDigest: row.inputDigest,
          decisionAllowed: Buffer.byteLength(row.inputJson, 'utf8') <= 32 * 1024,
          createdAt: row.createdAt
        }));
      }) : [];
      const commands = new CompanionCommandRepository(this.db, userId).list(device.id, 20).map(command => ({
        id: command.id,
        type: command.type,
        status: command.status,
        effectStatus: command.effectStatus,
        resultReference: command.resultReference,
        errorCode: command.errorCode,
        createdAt: command.createdAt,
        updatedAt: command.updatedAt
      }));
      return {
        device: this.deviceDto(device),
        projects,
        sessions,
        goals,
        attention,
        approvals,
        commands,
        latestSequence: records.latestOutboxSequence(device.id),
        generatedAt: this.now()
      };
    });
  }

  syncDeviceEvents(deviceId: string, authorityRevision: number, afterSequence: number) {
    z.number().int().positive().parse(authorityRevision);
    z.number().int().nonnegative().parse(afterSequence);
    return this.transaction(() => {
      const { records, device } = this.deviceAuthority(deviceId, authorityRevision);
      const latestSequence = records.latestOutboxSequence(device.id);
      const earliestSequence = records.earliestOutboxSequence(device.id);
      const reset = afterSequence > latestSequence
        || (earliestSequence > 0 && afterSequence < earliestSequence - 1);
      return {
        reset,
        events: reset ? [] : records.outboxAfter(device.id, afterSequence),
        latestSequence
      };
    });
  }

  listHostOutbox(afterSequence: number) {
    z.number().int().nonnegative().parse(afterSequence);
    const host = this.hostRecords.host();
    if (!host) throw new CompanionError('COMPANION_HOST_NOT_CONFIGURED', 409);
    return this.hostRecords.outboxAfter(host.hostId, afterSequence);
  }

  authorizeDevice(deviceId: string, expectedRevision: number) {
    const { device, userId } = this.deviceAuthority(deviceId, expectedRevision);
    return { device, userId };
  }

  private deviceAuthority(deviceId: string, expectedRevision: number) {
    const userId = this.hostRecords.deviceOwner(deviceId);
    if (!userId) throw new CompanionError('COMPANION_RESOURCE_NOT_FOUND', 404);
    this.actor(userId);
    const records = this.records(userId);
    const device = records.device(deviceId);
    if (!device) throw new CompanionError('COMPANION_RESOURCE_NOT_FOUND', 404);
    if (device.status !== 'active') throw new CompanionError('COMPANION_DEVICE_REVOKED');
    if (device.authorityRevision !== expectedRevision) throw new CompanionError('COMPANION_AUTHORITY_STALE', 409);
    if (!device.capabilities.includes('status.read')) throw new CompanionError('COMPANION_AUTHORITY_REJECTED');
    this.validateProjects(userId, device.projectIds);
    return { records, device, userId };
  }

  private records(userId: string): CompanionDeviceRepository {
    return new CompanionDeviceRepository(this.db, userId);
  }

  private transaction<T>(fn: () => T): T {
    return companionTransaction(this.db, fn);
  }

  private activeHost(): CompanionHostRecord {
    if (!this.featureEnabled) throw new CompanionError('COMPANION_DISABLED');
    const host = this.hostRecords.host();
    if (!host?.enabled) throw new CompanionError('COMPANION_DISABLED');
    return host;
  }

  private actor(userId: string): void {
    const user = new UserRepository(this.db).findById(userId);
    if (user?.status !== 'active') throw new CompanionError('COMPANION_AUTHORITY_REJECTED');
  }

  private validateProjects(userId: string, projectIds: string[]): void {
    const projects = new ProjectRepository(this.db, userId);
    for (const projectId of projectIds) {
      const shared = this.db.prepare('SELECT 1 FROM team_projects WHERE project_id=?').get(projectId);
      if (!projects.getById(projectId) || shared) throw new CompanionError('COMPANION_AUTHORITY_REJECTED');
    }
  }

  private hostDto(host: CompanionHostRecord) {
    return {
      hostId: host.hostId,
      relayUrl: host.relayUrl,
      signingPublicKey: host.signingPublicKey,
      encryptionPublicKey: host.encryptionPublicKey,
      enabled: host.enabled,
      revision: host.revision,
      createdAt: host.createdAt,
      updatedAt: host.updatedAt
    };
  }

  private pairingDto(pairing: CompanionPairingRecord) {
    return {
      id: pairing.id,
      hostId: pairing.hostId,
      hostRevision: pairing.hostRevision,
      status: pairing.status,
      revision: pairing.revision,
      projectIds: pairing.projectIds,
      capabilities: pairing.capabilities,
      deviceName: pairing.deviceName,
      deviceSigningPublicKey: pairing.deviceSigningPublicKey,
      deviceEncryptionPublicKey: pairing.deviceEncryptionPublicKey,
      sas: pairing.status === 'claimed' ? pairing.sas : null,
      expiresAt: pairing.expiresAt,
      createdAt: pairing.createdAt
    };
  }

  private deviceDto(device: CompanionDeviceRecord) {
    return {
      id: device.id,
      hostId: device.hostId,
      name: device.name,
      signingPublicKey: device.signingPublicKey,
      encryptionPublicKey: device.encryptionPublicKey,
      keyFingerprint: device.keyFingerprint,
      projectIds: device.projectIds,
      capabilities: device.capabilities,
      authorityRevision: device.authorityRevision,
      status: device.status,
      pairedAt: device.pairedAt,
      lastSeenAt: device.lastSeenAt,
      revokedAt: device.revokedAt,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt
    };
  }

  private audit(userId: string, action: string, resourceId: string): void {
    new AuditLogRepository(this.db, userId).create({
      action,
      resourceType: 'companion',
      resourceId,
      details: {}
    });
  }
}

interface SessionProjectionRow {
  id: string;
  projectId: string;
  name: string;
  aiTool: string;
  status: string;
  lastActive: number | null;
  updatedAt: number;
}
interface GoalProjectionRow {
  id: string;
  projectId: string;
  title: string;
  status: string;
  blockedReason: string | null;
  pendingQuestion: string | null;
  updatedAt: number;
}
interface NotificationProjectionRow {
  id: string;
  type: string;
  category: string;
  sessionId: string | null;
  payload: string | null;
  createdAt: number;
}
interface ApprovalProjectionRow {
  id: string;
  runId: string;
  tool: string;
  inputJson: string;
  inputDigest: string;
  createdAt: number;
}

function safeJsonObject(input: string): unknown {
  try { return JSON.parse(input); } catch { return null; }
}

function notificationProjectId(payload: string | null): string | undefined {
  if (!payload) return undefined;
  try {
    const value = JSON.parse(payload) as { project_id?: unknown; projectId?: unknown };
    const projectId = value.project_id ?? value.projectId;
    return typeof projectId === 'string' ? projectId : undefined;
  } catch {
    return undefined;
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseRelayUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'wss:' || !url.hostname || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid Relay URL');
    }
    return url.toString();
  } catch {
    throw new z.ZodError([{ code: 'custom', path: ['relayUrl'], message: 'A credential-free wss Relay URL is required' }]);
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
