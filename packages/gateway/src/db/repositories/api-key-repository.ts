import { and, eq } from "drizzle-orm";

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";

import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";
import { apiKeys } from "../schema.js";

export interface CreateApiKeyInput {
  provider: string;
  plaintextKey: string;
  label?: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  provider: string;
  keyEncrypted: string;
  label: string | null;
  status: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ApiKeyRepository {
  private drizzle;

  constructor(
    db: Database,
    private userId: string,
    private masterKey: string
  ) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateApiKeyInput): ApiKey {
    const encrypted = encryptSecret(input.plaintextKey, { key: this.masterKey });
    const result = this.drizzle
      .insert(apiKeys)
      .values({
        userId: this.userId,
        provider: input.provider,
        keyEncrypted: JSON.stringify(encrypted),
        label: input.label ?? null
      })
      .returning()
      .get();
    return result as ApiKey;
  }

  list(): Array<Omit<ApiKey, "keyEncrypted">> {
    const rows = this.drizzle
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        provider: apiKeys.provider,
        label: apiKeys.label,
        status: apiKeys.status,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
        updatedAt: apiKeys.updatedAt
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, this.userId))
      .all();
    return rows as Array<Omit<ApiKey, "keyEncrypted">>;
  }

  getById(id: string): ApiKey | undefined {
    return this.drizzle
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, this.userId)))
      .get() as ApiKey | undefined;
  }

  decryptForLaunch(id: string): string {
    const record = this.getById(id);
    if (!record) {
      throw new Error("API key not found");
    }
    return decryptSecret(JSON.parse(record.keyEncrypted) as EncryptedSecret, {
      key: this.masterKey
    });
  }

  rotate(id: string, plaintextKey: string): ApiKey | undefined {
    const encrypted = encryptSecret(plaintextKey, { key: this.masterKey });
    return this.drizzle
      .update(apiKeys)
      .set({ keyEncrypted: JSON.stringify(encrypted) })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, this.userId)))
      .returning()
      .get() as ApiKey | undefined;
  }

  delete(id: string): boolean {
    const result = this.drizzle
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, this.userId)))
      .run();
    return result.changes > 0;
  }
}
