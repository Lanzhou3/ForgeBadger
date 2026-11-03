import type { CompanionIdentity, CompanionSealedMessage } from './protocol';

export interface CompanionCacheEnvelope {
  nonce: string;
  ciphertext: string;
  authTag: string;
}

export interface CompanionCrypto {
  generateIdentity(): CompanionIdentity;
  randomUUID(): string;
  randomBytes(length: number): string;
  digestPayload(payload: unknown): string;
  derivePairingSas(input: {
    secret: string;
    hostId: string;
    pairingId: string;
    hostSigningPublicKey: string;
    deviceSigningPublicKey: string;
    claimNonce: string;
  }): string;
  signPayload(payload: unknown, signingPrivateKey: string): string;
  sealMessage(input: {
    payload: unknown;
    signingPrivateKey: string;
    encryptionPrivateKey: string;
    recipientEncryptionPublicKey: string;
    context: string;
  }): CompanionSealedMessage;
  openMessage<T>(input: {
    sealed: CompanionSealedMessage;
    encryptionPrivateKey: string;
    context: string;
    expectedSigningPublicKey?: string | undefined;
  }): { payload: T; signingPublicKey: string };
  sealCache(plaintext: string, key: string, context: string): CompanionCacheEnvelope;
  openCache(envelope: CompanionCacheEnvelope, key: string, context: string): string;
}
