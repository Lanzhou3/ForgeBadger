import { createHash, createHmac, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';

export interface CompanionIdentity {
  signingPublicKey: string;
  encryptionPublicKey: string;
  signingPrivateKey: string;
  encryptionPrivateKey: string;
}

export function generateCompanionIdentity(): CompanionIdentity {
  const signing = generateKeyPairSync('ed25519');
  const encryption = generateKeyPairSync('x25519');
  return {
    signingPublicKey: exportKey(signing.publicKey, 'spki'),
    encryptionPublicKey: exportKey(encryption.publicKey, 'spki'),
    signingPrivateKey: exportKey(signing.privateKey, 'pkcs8'),
    encryptionPrivateKey: exportKey(encryption.privateKey, 'pkcs8')
  };
}

export function companionHostId(signingPublicKey: string): string {
  assertCompanionPublicKey(signingPublicKey, 'ed25519');
  return createHash('sha256').update(Buffer.from(signingPublicKey, 'base64url')).digest('hex');
}

export function assertCompanionPublicKey(encoded: string, expected: 'ed25519' | 'x25519'): void {
  try {
    const key = createPublicKey({ key: Buffer.from(encoded, 'base64url'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== expected || exportKey(key, 'spki') !== encoded) throw new Error('key mismatch');
  } catch {
    throw new Error('COMPANION_DEVICE_KEY_INVALID');
  }
}

export function deriveCompanionPairingSas(input: {
  secret: string;
  hostId: string;
  pairingId: string;
  hostSigningPublicKey: string;
  deviceSigningPublicKey: string;
  claimNonce: string;
}): string {
  const digest = createHmac('sha256', Buffer.from(input.secret, 'base64url'))
    .update('forgebadger-companion-pairing-v1\0')
    .update(input.hostId).update('\0')
    .update(input.pairingId).update('\0')
    .update(input.hostSigningPublicKey).update('\0')
    .update(input.deviceSigningPublicKey).update('\0')
    .update(input.claimNonce)
    .digest();
  return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
}

function exportKey(key: KeyObject, type: 'spki' | 'pkcs8'): string {
  return key.export({ format: 'der', type }).toString('base64url');
}
