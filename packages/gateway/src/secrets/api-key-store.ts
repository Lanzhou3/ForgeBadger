import { randomUUID } from "node:crypto";

import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret
} from "../crypto/secret-box.js";

export interface ApiKeyRecord {
  id: string;
  userId: string;
  provider: string;
  name: string;
  encryptedKey: EncryptedSecret;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  userId: string;
  provider: string;
  name: string;
  createdAt: string;
}

export interface CreateApiKeyInput {
  userId: string;
  provider: string;
  name: string;
  plaintextKey: string;
}

export class InMemoryApiKeyStore {
  private readonly records = new Map<string, ApiKeyRecord>();

  constructor(private readonly options: { masterKey: string }) {}

  async create(input: CreateApiKeyInput): Promise<ApiKeySummary> {
    const now = new Date().toISOString();
    const record: ApiKeyRecord = {
      id: randomUUID(),
      userId: input.userId,
      provider: input.provider,
      name: input.name,
      encryptedKey: encryptSecret(input.plaintextKey, { key: this.options.masterKey }),
      createdAt: now
    };
    this.records.set(record.id, record);
    return summarize(record);
  }

  async listForUser(userId: string): Promise<ApiKeySummary[]> {
    return [...this.records.values()]
      .filter((record) => record.userId === userId)
      .map((record) => summarize(record));
  }

  async decryptForLaunch(input: { userId: string; id: string }): Promise<string> {
    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId) {
      throw new Error("API key not found");
    }

    return decryptSecret(record.encryptedKey, { key: this.options.masterKey });
  }
}

function summarize(record: ApiKeyRecord): ApiKeySummary {
  return {
    id: record.id,
    userId: record.userId,
    provider: record.provider,
    name: record.name,
    createdAt: record.createdAt
  };
}
