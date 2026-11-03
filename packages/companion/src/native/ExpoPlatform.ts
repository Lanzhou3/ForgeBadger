import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { z } from 'zod';
import type { CompanionSocket, CompanionPlatform, CompanionStoredSession } from '../client/platform';
import { companionDeviceSchema, companionSnapshotSchema, type CompanionCache } from '../client/protocol';
import { NativeCompanionCrypto } from './QuickCrypto';

const SESSION_KEY = 'forgebadger.companion.session.v1';
const CACHE_KEY = 'forgebadger.companion.cache-key.v1';
const CACHE_CONTEXT = 'forgebadger-companion-cache-v1';

export class ExpoPlatform implements CompanionPlatform {
  readonly crypto = new NativeCompanionCrypto();
  private readonly cacheFile = new File(Paths.document, 'companion-cache-v1.json');

  async loadSession(): Promise<CompanionStoredSession | null> {
    const stored = await SecureStore.getItemAsync(SESSION_KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as CompanionStoredSession;
    if (value.registration) companionDeviceSchema.parse(value.registration.device);
    return value;
  }

  async saveSession(session: CompanionStoredSession): Promise<void> {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK
    });
  }

  async loadCache(): Promise<CompanionCache | null> {
    if (!this.cacheFile.exists) return null;
    const envelope = JSON.parse(await this.cacheFile.text());
    const key = await this.getCacheKey();
    const cache = JSON.parse(this.crypto.openCache(envelope, key, CACHE_CONTEXT)) as CompanionCache;
    companionSnapshotSchema.parse(cache.snapshot);
    z.number().int().nonnegative().parse(cache.cursor);
    z.number().int().nonnegative().parse(cache.savedAt);
    return cache;
  }

  async saveCache(cache: CompanionCache): Promise<void> {
    const plaintext = JSON.stringify(cache);
    if (new TextEncoder().encode(plaintext).length > 256 * 1024) throw new Error('COMPANION_CACHE_TOO_LARGE');
    const key = await this.getCacheKey();
    const envelope = this.crypto.sealCache(plaintext, key, CACHE_CONTEXT);
    if (!this.cacheFile.exists) this.cacheFile.create();
    await this.cacheFile.write(JSON.stringify(envelope));
  }

  async clearLocalData(): Promise<void> {
    if (this.cacheFile.exists) this.cacheFile.delete();
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(CACHE_KEY);
  }

  async connect(url: string): Promise<CompanionSocket> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('COMPANION_RELAY_UNAVAILABLE'));
    });
    return {
      send: value => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
      },
      close: () => ws.close(),
      onMessage: listener => {
        ws.onmessage = event => listener(JSON.parse(event.data));
      },
      onClose: listener => {
        ws.onclose = listener;
      },
      onError: listener => {
        ws.onerror = listener;
      }
    };
  }

  private async getCacheKey(): Promise<string> {
    const existing = await SecureStore.getItemAsync(CACHE_KEY);
    if (existing) return existing;
    const created = this.crypto.randomBytes(32);
    await SecureStore.setItemAsync(CACHE_KEY, created, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK
    });
    return created;
  }
}
