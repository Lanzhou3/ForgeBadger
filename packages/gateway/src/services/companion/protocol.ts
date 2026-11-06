import { z } from 'zod';

export const COMPANION_PROTOCOL_VERSION = 1;
export const companionCapabilities = [
  'status.read',
  'goals.read',
  'goals.create',
  'goals.answer',
  'goals.control',
  'approvals.decide',
  'runs.stop'
] as const;
export const companionCommandTypes = [
  'goal.create',
  'goal.answer',
  'goal.pause',
  'goal.resume',
  'goal.cancel',
  'approval.decide',
  'run.stop'
] as const;

const id = z.string().uuid();
const hostId = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive();
const timestamp = z.number().int().nonnegative();
const base64url = (max: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).max(max);
const publicKey = base64url(128);
const projectIds = z.array(id.or(z.string().trim().min(1).max(128))).min(1).max(100)
  .refine(values => new Set(values).size === values.length);
const capabilities = z.array(z.enum(companionCapabilities)).min(1).max(companionCapabilities.length)
  .refine(values => new Set(values).size === values.length);

export const companionHostConfigurationSchema = z.object({
  enabled: z.boolean(),
  relayUrl: z.string().max(2048),
  expectedRevision: revision
}).strict();

export const companionPairingCreateSchema = z.object({
  projectIds,
  capabilities
}).strict();

export const companionPairingClaimSchema = z.object({
  pairingId: id,
  secret: base64url(43).length(43),
  deviceName: z.string().trim().min(1).max(80),
  signingPublicKey: publicKey,
  encryptionPublicKey: publicKey,
  claimNonce: base64url(43).length(43)
}).strict();

export const companionPairingConfirmationSchema = z.object({
  revision,
  sas: z.string().regex(/^\d{6}$/)
}).strict();

export const companionDeviceUpdateSchema = z.object({
  expectedRevision: revision,
  name: z.string().trim().min(1).max(80).optional(),
  projectIds: projectIds.optional(),
  capabilities: capabilities.optional()
}).strict().refine(value => value.name !== undefined || value.projectIds !== undefined || value.capabilities !== undefined);

export const companionPairingQrSchema = z.object({
  protocolVersion: z.literal(COMPANION_PROTOCOL_VERSION),
  pairingId: id,
  secret: base64url(43).length(43),
  relayUrl: z.string().url().startsWith('wss://'),
  hostId,
  hostSigningPublicKey: publicKey,
  hostEncryptionPublicKey: publicKey
}).strict();

export const companionCommandEnvelopeSchema = z.object({
  protocolVersion: z.literal(COMPANION_PROTOCOL_VERSION),
  hostId,
  deviceId: id,
  commandId: id,
  authorityRevision: revision,
  type: z.enum(companionCommandTypes),
  createdAt: timestamp,
  expiresAt: timestamp,
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict().refine(value => value.expiresAt > value.createdAt);

export const companionCommandReceiptSchema = z.object({
  protocolVersion: z.literal(COMPANION_PROTOCOL_VERSION),
  hostId,
  deviceId: id,
  commandId: id,
  status: z.enum(['accepted', 'running', 'succeeded', 'rejected', 'failed', 'unknown']),
  effectStatus: z.enum(['none', 'confirmed', 'unknown']),
  authorityRevision: revision,
  resultReference: z.string().max(256).nullable(),
  errorCode: z.string().regex(/^[A-Z0-9_]+$/).max(80).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp
}).strict();
