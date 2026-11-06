import { z } from 'zod';

const id = z.string().uuid();
const key = z.string().regex(/^[A-Za-z0-9_-]+$/).max(128);
const timestamp = z.number().int().nonnegative();
const capabilities = z.array(z.enum([
  'status.read', 'goals.read', 'goals.create', 'goals.answer',
  'goals.control', 'approvals.decide', 'runs.stop'
])).max(7);

export const companionQrSchema = z.object({
  protocolVersion: z.literal(1),
  pairingId: id,
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  relayUrl: z.string().url().startsWith('wss://'),
  hostId: z.string().regex(/^[a-f0-9]{64}$/),
  hostSigningPublicKey: key,
  hostEncryptionPublicKey: key
}).strict();

export const companionDeviceSchema = z.object({
  id,
  hostId: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().max(80),
  signingPublicKey: key,
  encryptionPublicKey: key,
  keyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  projectIds: z.array(z.string().max(128)).min(1).max(100),
  capabilities,
  authorityRevision: z.number().int().positive(),
  status: z.enum(['active', 'revoked']),
  pairedAt: timestamp,
  lastSeenAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp
}).strict();

export const companionSnapshotSchema = z.object({
  device: companionDeviceSchema,
  projects: z.array(z.object({
    id: z.string().max(128), name: z.string().max(200), status: z.string().max(40), updatedAt: timestamp
  }).strict()).max(100),
  sessions: z.array(z.object({
    id: z.string().max(128), projectId: z.string().max(128), name: z.string().max(200),
    aiTool: z.string().max(40), status: z.string().max(40),
    lastActive: timestamp.nullable(), updatedAt: timestamp
  }).strict()).max(2000),
  goals: z.array(z.object({
    id: z.string().max(128), projectId: z.string().max(128), title: z.string().max(200),
    status: z.string().max(40), blockedReason: z.string().max(200).nullable(),
    pendingQuestion: z.string().max(4000).nullable(), updatedAt: timestamp,
    taskTotal: z.number().int().nonnegative(), taskPasses: z.number().int().nonnegative()
  }).strict()).max(2000),
  attention: z.array(z.object({
    id: z.string().max(128), type: z.string().max(80), category: z.string().max(80),
    sessionId: z.string().max(128).nullable(), projectId: z.string().max(128), createdAt: timestamp
  }).strict()).max(500),
  approvals: z.array(z.object({
    id, runId: id, tool: z.string().max(80), input: z.unknown(),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    decisionAllowed: z.boolean(), createdAt: timestamp
  }).strict()).max(100),
  commands: z.array(z.object({
    id, type: z.string().max(80),
    status: z.enum(['accepted', 'running', 'succeeded', 'rejected', 'failed', 'unknown']),
    effectStatus: z.enum(['none', 'confirmed', 'unknown']),
    resultReference: z.string().max(256).nullable(),
    errorCode: z.string().max(80).nullable(),
    createdAt: timestamp, updatedAt: timestamp
  }).strict()).max(20),
  latestSequence: z.number().int().nonnegative(),
  generatedAt: timestamp
}).strict();

export const companionEventSchema = z.object({
  id: z.string().max(128),
  userId: z.string().max(128),
  deviceId: id,
  sequence: z.number().int().positive(),
  type: z.string().max(80),
  payload: z.record(z.unknown()),
  createdAt: timestamp
}).strict();

export const companionSyncSchema = z.object({
  reset: z.boolean(),
  events: z.array(companionEventSchema).max(1000),
  latestSequence: z.number().int().nonnegative()
}).strict();

export const companionSealedSchema = z.object({
  senderEncryptionPublicKey: key,
  nonce: z.string().max(64),
  ciphertext: z.string().max(50_000),
  authTag: z.string().max(64)
}).strict();

export const companionCommandReceiptSchema = z.object({
  protocolVersion: z.literal(1),
  status: z.enum(['accepted', 'running', 'succeeded', 'rejected', 'failed', 'unknown']),
  effectStatus: z.enum(['none', 'confirmed', 'unknown']),
  authorityRevision: z.number().int().positive(),
  resultReference: z.string().max(256).nullable(),
  errorCode: z.string().max(80).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp
}).strict();

export type CompanionCommandReceipt = z.infer<typeof companionCommandReceiptSchema>;
export type CompanionQr = z.infer<typeof companionQrSchema>;
export type CompanionDevice = z.infer<typeof companionDeviceSchema>;
export type CompanionSnapshot = z.infer<typeof companionSnapshotSchema>;
export type CompanionEvent = z.infer<typeof companionEventSchema>;
export type CompanionSync = z.infer<typeof companionSyncSchema>;
export type CompanionSealedMessage = z.infer<typeof companionSealedSchema>;

export interface CompanionIdentity {
  signingPublicKey: string;
  encryptionPublicKey: string;
  signingPrivateKey: string;
  encryptionPrivateKey: string;
}

export interface CompanionRegistration {
  device: CompanionDevice;
  hostSigningPublicKey: string;
  hostEncryptionPublicKey: string;
  relayUrl: string;
}

export interface CompanionCache {
  snapshot: CompanionSnapshot;
  cursor: number;
  savedAt: number;
}

export function parseCompanionQr(raw: string): CompanionQr {
  return companionQrSchema.parse(JSON.parse(raw));
}

export function isSnapshotStale(generatedAt: number, now: number): boolean {
  return now - generatedAt > 120_000;
}
