import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { CompanionCrypto, CompanionCacheEnvelope } from '../../src/client/crypto.js';
import type { CompanionSocket, CompanionPlatform, CompanionStoredSession } from '../../src/client/platform.js';
import type { CompanionCache, CompanionIdentity } from '../../src/client/protocol.js';
import { deriveCompanionPairingSas, generateCompanionIdentity } from '../../../gateway/src/services/companion/keys.js';
import { companionPayloadDigest } from '../../../gateway/src/services/companion/command-service.js';
import {
  openCompanionMessage,
  sealCompanionMessage,
  signCompanionPayload
} from '../../../gateway/src/services/companion/transport-crypto.js';

export class NodeCompanionCrypto implements CompanionCrypto {
  generateIdentity(): CompanionIdentity { return generateCompanionIdentity(); }
  randomUUID(): string { return randomUUID(); }
  randomBytes(length: number): string { return randomBytes(length).toString('base64url'); }
  digestPayload(payload: unknown): string { return companionPayloadDigest(payload); }
  derivePairingSas(input: Parameters<typeof deriveCompanionPairingSas>[0]): string {
    return deriveCompanionPairingSas(input);
  }
  signPayload(payload: unknown, signingPrivateKey: string): string {
    return signCompanionPayload(payload, signingPrivateKey);
  }
  sealMessage(input: Parameters<typeof sealCompanionMessage>[0]) {
    return sealCompanionMessage(input);
  }
  openMessage<T>(input: Parameters<typeof openCompanionMessage>[0] & { expectedSigningPublicKey?: string | undefined }) {
    return openCompanionMessage<T>(input);
  }
  sealCache(plaintext: string, key: string, context: string): CompanionCacheEnvelope {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), nonce);
    cipher.setAAD(Buffer.from(context));
    return {
      nonce: nonce.toString('base64url'),
      ciphertext: Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url')
    };
  }
  openCache(envelope: CompanionCacheEnvelope, key: string, context: string): string {
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), Buffer.from(envelope.nonce, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }
}

export class InMemoryPlatform implements CompanionPlatform {
  readonly crypto = new NodeCompanionCrypto();
  private session: CompanionStoredSession | null = null;
  private cache: CompanionCache | null = null;
  encryptedCache: string | null = null;
  private readonly cacheKey = randomBytes(32).toString('base64url');

  async loadSession(): Promise<CompanionStoredSession | null> { return this.session; }
  async saveSession(session: CompanionStoredSession): Promise<void> { this.session = session; }
  async loadCache(): Promise<CompanionCache | null> { return this.cache; }
  async saveCache(cache: CompanionCache): Promise<void> {
    this.cache = cache;
    this.encryptedCache = this.crypto.sealCache(JSON.stringify(cache), this.cacheKey, 'companion-cache-v1').ciphertext;
  }
  async clearLocalData(): Promise<void> {
    this.session = null;
    this.cache = null;
    this.encryptedCache = null;
  }
  async connect(url: string): Promise<CompanionSocket> {
    const ws = new WebSocket(url.replace('wss:', 'ws:'));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return {
      send: value => ws.send(JSON.stringify(value)),
      close: () => ws.close(),
      onMessage: listener => ws.on('message', data => listener(JSON.parse(data.toString()))),
      onClose: listener => ws.on('close', listener),
      onError: listener => ws.on('error', listener)
    };
  }
}
