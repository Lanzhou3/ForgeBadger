import { createPublicKey, verify } from 'node:crypto';

export function canonicalCompanionJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function verifyCompanionSignature(value: unknown, publicKey: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, Buffer.from(canonicalCompanionJson(value)), key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)]));
  }
  return value;
}
