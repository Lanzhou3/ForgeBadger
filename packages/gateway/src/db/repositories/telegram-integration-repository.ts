import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";

export interface TelegramIntegrationConfig {
  enabled: boolean;
  emergencyDisabled: boolean;
  allowedChatIds: string[];
}

export interface UpdateTelegramIntegrationConfigInput {
  enabled?: boolean | undefined;
  emergencyDisabled?: boolean | undefined;
  allowedChatIds?: string[] | undefined;
}

interface TelegramConfigRow {
  id: string;
  user_id: string;
  enabled: number;
  emergency_disabled: number;
  allowed_chat_ids: string;
  created_at: number;
  updated_at: number;
}

const defaultConfig: TelegramIntegrationConfig = {
  enabled: false,
  emergencyDisabled: false,
  allowedChatIds: []
};

const maxAllowedChatIds = 50;

export class TelegramIntegrationRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string
  ) {}

  getConfig(): TelegramIntegrationConfig {
    const row = this.db.prepare(`
      SELECT * FROM integration_telegram_configs
      WHERE user_id = ?
    `).get(this.userId) as TelegramConfigRow | undefined;
    return row ? toConfig(row) : { ...defaultConfig };
  }

  upsertConfig(input: UpdateTelegramIntegrationConfigInput): TelegramIntegrationConfig {
    const existing = this.getConfig();
    const next: TelegramIntegrationConfig = {
      enabled: input.enabled ?? existing.enabled,
      emergencyDisabled: input.emergencyDisabled ?? existing.emergencyDisabled,
      allowedChatIds: input.allowedChatIds === undefined
        ? existing.allowedChatIds
        : normalizeAllowedChatIds(input.allowedChatIds)
    };
    const now = Date.now();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO integration_telegram_configs (
        id, user_id, enabled, emergency_disabled, allowed_chat_ids, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        enabled = excluded.enabled,
        emergency_disabled = excluded.emergency_disabled,
        allowed_chat_ids = excluded.allowed_chat_ids,
        updated_at = excluded.updated_at
    `).run(
      id,
      this.userId,
      next.enabled ? 1 : 0,
      next.emergencyDisabled ? 1 : 0,
      JSON.stringify(next.allowedChatIds),
      now,
      now
    );

    return this.getConfig();
  }

  canExecuteActions(): boolean {
    const config = this.getConfig();
    return config.enabled && !config.emergencyDisabled;
  }
}

function toConfig(row: TelegramConfigRow): TelegramIntegrationConfig {
  return {
    enabled: row.enabled === 1,
    emergencyDisabled: row.emergency_disabled === 1,
    allowedChatIds: parseAllowedChatIds(row.allowed_chat_ids)
  };
}

function normalizeAllowedChatIds(values: string[]): string[] {
  if (values.length > maxAllowedChatIds) {
    throw new Error(`Telegram allowed chat ids cannot exceed ${maxAllowedChatIds}`);
  }
  const ids = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const unique = Array.from(new Set(ids));
  if (unique.length > maxAllowedChatIds) {
    throw new Error(`Telegram allowed chat ids cannot exceed ${maxAllowedChatIds}`);
  }
  if (unique.some((value) => value.length > 128)) {
    throw new Error("Telegram allowed chat ids must be 128 characters or fewer");
  }
  return unique;
}

function parseAllowedChatIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? normalizeAllowedChatIds(parsed.filter((item): item is string => typeof item === "string"))
      : [];
  } catch {
    return [];
  }
}
