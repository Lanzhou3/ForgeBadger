import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
  sign,
  verify,
  type KeyObject
} from 'node:crypto';

export interface CompanionSealedMessage {
  senderEncryptionPublicKey: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

export function canonicalCompanionJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function signCompanionPayload(payload: unknown, signingPrivateKey: string): string {
  return sign(null, Buffer.from(canonicalCompanionJson(payload)), privateKey(signingPrivateKey)).toString('base64url');
}

export function verifyCompanionPayload(payload: unknown, signingPublicKey: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(signingPublicKey, 'base64url'), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(canonicalCompanionJson(payload)), key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

export function sealCompanionMessage(input: {
  payload: unknown;
  signingPrivateKey: string;
  encryptionPrivateKey: string;
  recipientEncryptionPublicKey: string;
  context: string;
}): CompanionSealedMessage {
  const encryptionKey = privateKey(input.encryptionPrivateKey);
  const signingKey = privateKey(input.signingPrivateKey);
  const signingPublicKey = publicDer(createPublicKey(signingKey));
  const signature = signCompanionPayload(input.payload, input.signingPrivateKey);
  const plaintext = canonicalCompanionJson({ payload: input.payload, signingPublicKey, signature });
  const nonce = randomBytes(12);
  const key = sharedKey(encryptionKey, input.recipientEncryptionPublicKey, input.context);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(input.context));
  return {
    senderEncryptionPublicKey: publicDer(createPublicKey(encryptionKey)),
    nonce: nonce.toString('base64url'),
    ciphertext: Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url')
  };
}

export function openCompanionMessage<T = unknown>(input: {
  sealed: CompanionSealedMessage;
  encryptionPrivateKey: string;
  context: string;
  expectedSigningPublicKey?: string | undefined;
}): { payload: T; signingPublicKey: string } {
  try {
    const key = sharedKey(privateKey(input.encryptionPrivateKey), input.sealed.senderEncryptionPublicKey, input.context);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(input.sealed.nonce, 'base64url'));
    decipher.setAAD(Buffer.from(input.context));
    decipher.setAuthTag(Buffer.from(input.sealed.authTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(input.sealed.ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8');
    const message = JSON.parse(plaintext) as { payload: T; signingPublicKey: string; signature: string };
    if (!verifyCompanionPayload(message.payload, message.signingPublicKey, message.signature)) {
      throw new Error('signature mismatch');
    }
    if (input.expectedSigningPublicKey && message.signingPublicKey !== input.expectedSigningPublicKey) {
      throw new Error('device mismatch');
    }
    return { payload: message.payload, signingPublicKey: message.signingPublicKey };
  } catch {
    throw new Error('COMPANION_MESSAGE_AUTH_FAILED');
  }
}

function sharedKey(privateKeyObject: KeyObject, recipientPublic: string, context: string): Buffer {
  const shared = diffieHellman({
    privateKey: privateKeyObject,
    publicKey: createPublicKey({ key: Buffer.from(recipientPublic, 'base64url'), format: 'der', type: 'spki' })
  });
  return Buffer.from(hkdfSync('sha256', shared, 'forgebadger-companion-v1', context, 32));
}

function privateKey(encoded: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(encoded, 'base64url'), format: 'der', type: 'pkcs8' });
}

function publicDer(key: KeyObject): string {
  return key.export({ format: 'der', type: 'spki' }).toString('base64url');
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
