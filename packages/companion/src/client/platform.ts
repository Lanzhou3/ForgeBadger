import type { CompanionCrypto } from './crypto';
import type { CompanionCache, CompanionIdentity, CompanionRegistration } from './protocol';

export interface CompanionSocket {
  send(value: unknown): void;
  close(): void;
  onMessage(listener: (value: unknown) => void): void;
  onClose(listener: () => void): void;
  onError(listener: () => void): void;
}

export interface CompanionStoredSession {
  identity: CompanionIdentity;
  registration?: CompanionRegistration | undefined;
}

export interface CompanionPlatform {
  readonly crypto: CompanionCrypto;
  loadSession(): Promise<CompanionStoredSession | null>;
  saveSession(session: CompanionStoredSession): Promise<void>;
  loadCache(): Promise<CompanionCache | null>;
  saveCache(cache: CompanionCache): Promise<void>;
  clearLocalData(): Promise<void>;
  connect(url: string): Promise<CompanionSocket>;
}
