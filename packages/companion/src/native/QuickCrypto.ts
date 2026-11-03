import QuickCrypto, { Buffer, install } from 'react-native-quick-crypto';
import type { CompanionCrypto, CompanionCacheEnvelope } from '../client/crypto';
import type { CompanionIdentity, CompanionSealedMessage } from '../client/protocol';

install();

export class NativeCompanionCrypto implements CompanionCrypto {
  generateIdentity(): CompanionIdentity {
    const signing = QuickCrypto.generateKeyPairSync('ed25519');
    const encryption = QuickCrypto.generateKeyPairSync('x25519');
    return {
      signingPublicKey: exportKey(signing.publicKey, 'spki'),
      encryptionPublicKey: exportKey(encryption.publicKey, 'spki'),
      signingPrivateKey: exportKey(signing.privateKey, 'pkcs8'),
      encryptionPrivateKey: exportKey(encryption.privateKey, 'pkcs8')
    };
  }

  randomUUID(): string { return QuickCrypto.randomUUID(); }
  randomBytes(length: number): string { return QuickCrypto.randomBytes(length).toString('base64url'); }
  digestPayload(payload: unknown): string {
    return QuickCrypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
  }

  derivePairingSas(input: {
    secret: string;
    hostId: string;
    pairingId: string;
    hostSigningPublicKey: string;
    deviceSigningPublicKey: string;
    claimNonce: string;
  }): string {
    const digest = QuickCrypto.createHmac('sha256', Buffer.from(input.secret, 'base64url'))
      .update('forgebadger-companion-pairing-v1\0')
      .update(input.hostId).update('\0')
      .update(input.pairingId).update('\0')
      .update(input.hostSigningPublicKey).update('\0')
      .update(input.deviceSigningPublicKey).update('\0')
      .update(input.claimNonce)
      .digest();
    return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
  }

  signPayload(payload: unknown, signingPrivateKey: string): string {
    return QuickCrypto.sign(null, Buffer.from(canonicalJson(payload)), privateKey(signingPrivateKey)).toString('base64url');
  }

  sealMessage(input: {
    payload: unknown;
    signingPrivateKey: string;
    encryptionPrivateKey: string;
    recipientEncryptionPublicKey: string;
    context: string;
  }): CompanionSealedMessage {
    const encryptionKey = privateKey(input.encryptionPrivateKey);
    const signingPublicKey = publicDer(QuickCrypto.createPublicKey(privateKey(input.signingPrivateKey)));
    const plaintext = canonicalJson({
      payload: input.payload,
      signingPublicKey,
      signature: this.signPayload(input.payload, input.signingPrivateKey)
    });
    const nonce = QuickCrypto.randomBytes(12);
    const key = sharedKey(encryptionKey, input.recipientEncryptionPublicKey, input.context);
    const cipher = QuickCrypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(input.context));
    return {
      senderEncryptionPublicKey: publicDer(QuickCrypto.createPublicKey(encryptionKey)),
      nonce: nonce.toString('base64url'),
      ciphertext: Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url')
    };
  }

  openMessage<T>(input: {
    sealed: CompanionSealedMessage;
    encryptionPrivateKey: string;
    context: string;
    expectedSigningPublicKey?: string | undefined;
  }): { payload: T; signingPublicKey: string } {
    try {
      const key = sharedKey(privateKey(input.encryptionPrivateKey), input.sealed.senderEncryptionPublicKey, input.context);
      const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(input.sealed.nonce, 'base64url'));
      decipher.setAAD(Buffer.from(input.context));
      decipher.setAuthTag(Buffer.from(input.sealed.authTag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(input.sealed.ciphertext, 'base64url')),
        decipher.final()
      ]).toString('utf8');
      const message = JSON.parse(plaintext) as { payload: T; signingPublicKey: string; signature: string };
      if (!this.verifyPayload(message.payload, message.signingPublicKey, message.signature)) throw new Error('signature');
      if (input.expectedSigningPublicKey && input.expectedSigningPublicKey !== message.signingPublicKey) {
        throw new Error('device');
      }
      return { payload: message.payload, signingPublicKey: message.signingPublicKey };
    } catch {
      throw new Error('COMPANION_MESSAGE_AUTH_FAILED');
    }
  }

  sealCache(plaintext: string, key: string, context: string): CompanionCacheEnvelope {
    const nonce = QuickCrypto.randomBytes(12);
    const cipher = QuickCrypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), nonce);
    cipher.setAAD(Buffer.from(context));
    return {
      nonce: nonce.toString('base64url'),
      ciphertext: Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url')
    };
  }

  openCache(envelope: CompanionCacheEnvelope, key: string, context: string): string {
    const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), Buffer.from(envelope.nonce, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }

  private verifyPayload(payload: unknown, signingPublicKey: string, signature: string): boolean {
    try {
      const key = QuickCrypto.createPublicKey({ key: Buffer.from(signingPublicKey, 'base64url'), format: 'der', type: 'spki' });
      return QuickCrypto.verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }
}

function sharedKey(privateKeyObject: ReturnType<typeof privateKey>, recipientPublic: string, context: string): Buffer {
  const shared = QuickCrypto.diffieHellman({
    privateKey: privateKeyObject,
    publicKey: QuickCrypto.createPublicKey({ key: Buffer.from(recipientPublic, 'base64url'), format: 'der', type: 'spki' })
  });
  if (!shared) throw new Error('COMPANION_KEY_AGREEMENT_FAILED');
  return QuickCrypto.hkdfSync('sha256', shared, 'forgebadger-companion-v1', context, 32);
}

function privateKey(encoded: string) {
  return QuickCrypto.createPrivateKey({ key: Buffer.from(encoded, 'base64url'), format: 'der', type: 'pkcs8' });
}

function publicDer(key: ReturnType<typeof QuickCrypto.createPublicKey>): string {
  return key.export({ format: 'der', type: 'spki' }).toString('base64url');
}

function exportKey(key: { export(options: { format: 'der'; type: 'spki' | 'pkcs8' }): Buffer }, type: 'spki' | 'pkcs8'): string {
  return key.export({ format: 'der', type }).toString('base64url');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
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
