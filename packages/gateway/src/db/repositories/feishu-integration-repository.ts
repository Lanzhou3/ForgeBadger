import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";

export type FeishuIdentityMode = "user" | "bot" | "unknown";

export interface FeishuIntegrationConfig {
  enabled: boolean;
  emergencyDisabled: boolean;
  identityMode: FeishuIdentityMode;
  allowedChatIds: string[];
  commandPrefix: string;
}

export interface UpdateFeishuIntegrationConfigInput {
  enabled?: boolean | undefined;
  emergencyDisabled?: boolean | undefined;
  identityMode?: FeishuIdentityMode | undefined;
  allowedChatIds?: string[] | undefined;
  commandPrefix?: string | undefined;
}

export interface FeishuUserMapping {
  id: string;
  userId: string;
  feishuUserId: string;
  openforgeUserId: string;
  displayName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReplaceFeishuUserMappingInput {
  feishuUserId: string;
  openforgeUserId: string;
  displayName?: string | null | undefined;
}

interface FeishuConfigRow {
  id: string;
  user_id: string;
  enabled: number;
  emergency_disabled: number;
  identity_mode: string;
  allowed_chat_ids: string;
  command_prefix: string;
  created_at: number;
  updated_at: number;
}

interface FeishuUserMappingRow {
  id: string;
  user_id: string;
  feishu_user_id: string;
  openforge_user_id: string;
  display_name: string | null;
  created_at: number;
  updated_at: number;
}

const defaultConfig: FeishuIntegrationConfig = {
  enabled: false,
  emergencyDisabled: false,
  identityMode: "unknown",
  allowedChatIds: [],
  commandPrefix: "/openforge"
};

const maxAllowedChatIds = 50;
const maxUserMappings = 100;

export class FeishuIntegrationRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string
  ) {}

  getConfig(): FeishuIntegrationConfig {
    const row = this.db.prepare(`
      SELECT * FROM integration_feishu_configs
      WHERE user_id = ?
    `).get(this.userId) as FeishuConfigRow | undefined;
    return row ? toConfig(row) : { ...defaultConfig };
  }

  upsertConfig(input: UpdateFeishuIntegrationConfigInput): FeishuIntegrationConfig {
    const existing = this.getConfig();
    const next: FeishuIntegrationConfig = {
      enabled: input.enabled ?? existing.enabled,
      emergencyDisabled: input.emergencyDisabled ?? existing.emergencyDisabled,
      identityMode: normalizeIdentityMode(input.identityMode ?? existing.identityMode),
      allowedChatIds: input.allowedChatIds === undefined
        ? existing.allowedChatIds
        : normalizeAllowedChatIds(input.allowedChatIds),
      commandPrefix: input.commandPrefix === undefined
        ? existing.commandPrefix
        : normalizeCommandPrefix(input.commandPrefix)
    };
    const now = Date.now();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO integration_feishu_configs (
        id, user_id, enabled, emergency_disabled, identity_mode, allowed_chat_ids,
        command_prefix, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        enabled = excluded.enabled,
        emergency_disabled = excluded.emergency_disabled,
        identity_mode = excluded.identity_mode,
        allowed_chat_ids = excluded.allowed_chat_ids,
        command_prefix = excluded.command_prefix,
        updated_at = excluded.updated_at
    `).run(
      id,
      this.userId,
      boolToInt(next.enabled),
      boolToInt(next.emergencyDisabled),
      next.identityMode,
      JSON.stringify(next.allowedChatIds),
      next.commandPrefix,
      now,
      now
    );

    return this.getConfig();
  }

  canExecuteActions(): boolean {
    const config = this.getConfig();
    return config.enabled && !config.emergencyDisabled;
  }

  listUserMappings(): FeishuUserMapping[] {
    const rows = this.db.prepare(`
      SELECT * FROM integration_feishu_user_mappings
      WHERE user_id = ?
      ORDER BY feishu_user_id COLLATE NOCASE ASC
    `).all(this.userId) as FeishuUserMappingRow[];
    return rows.map(toUserMapping);
  }

  replaceUserMappings(input: ReplaceFeishuUserMappingInput[]): FeishuUserMapping[] {
    const mappings = normalizeUserMappings(input);
    const now = Date.now();
    const replace = this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM integration_feishu_user_mappings
        WHERE user_id = ?
      `).run(this.userId);

      const insert = this.db.prepare(`
        INSERT INTO integration_feishu_user_mappings (
          id, user_id, feishu_user_id, openforge_user_id, display_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const mapping of mappings) {
        insert.run(
          randomUUID(),
          this.userId,
          mapping.feishuUserId,
          mapping.openforgeUserId,
          mapping.displayName ?? null,
          now,
          now
        );
      }
    });

    replace();
    return this.listUserMappings();
  }
}

function toConfig(row: FeishuConfigRow): FeishuIntegrationConfig {
  return {
    enabled: row.enabled === 1,
    emergencyDisabled: row.emergency_disabled === 1,
    identityMode: normalizeIdentityMode(row.identity_mode),
    allowedChatIds: parseAllowedChatIds(row.allowed_chat_ids),
    commandPrefix: normalizeCommandPrefix(row.command_prefix)
  };
}

function toUserMapping(row: FeishuUserMappingRow): FeishuUserMapping {
  return {
    id: row.id,
    userId: row.user_id,
    feishuUserId: row.feishu_user_id,
    openforgeUserId: row.openforge_user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeIdentityMode(value: string): FeishuIdentityMode {
  if (value === "user" || value === "bot") return value;
  return "unknown";
}

function normalizeAllowedChatIds(values: string[]): string[] {
  if (values.length > maxAllowedChatIds) {
    throw new Error(`Feishu allowed chat ids cannot exceed ${maxAllowedChatIds}`);
  }
  const ids = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const unique = Array.from(new Set(ids));
  if (unique.length > maxAllowedChatIds) {
    throw new Error(`Feishu allowed chat ids cannot exceed ${maxAllowedChatIds}`);
  }
  if (unique.some((value) => value.length > 128)) {
    throw new Error("Feishu allowed chat ids must be 128 characters or fewer");
  }
  return unique;
}

function normalizeUserMappings(input: ReplaceFeishuUserMappingInput[]): ReplaceFeishuUserMappingInput[] {
  if (input.length > maxUserMappings) {
    throw new Error(`Feishu user mappings cannot exceed ${maxUserMappings}`);
  }
  const byFeishuUserId = new Map<string, ReplaceFeishuUserMappingInput>();
  for (const mapping of input) {
    const feishuUserId = mapping.feishuUserId.trim();
    const openforgeUserId = mapping.openforgeUserId.trim();
    if (!feishuUserId || !openforgeUserId) {
      throw new Error("Feishu user mappings require Feishu and OpenForge user ids");
    }
    if (feishuUserId.length > 128 || openforgeUserId.length > 128) {
      throw new Error("Feishu user mapping ids must be 128 characters or fewer");
    }
    byFeishuUserId.set(feishuUserId, {
      feishuUserId,
      openforgeUserId,
      displayName: emptyToNull(mapping.displayName)
    });
  }
  return Array.from(byFeishuUserId.values());
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

function normalizeCommandPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.length < 2 || trimmed.length > 32 || /\s/.test(trimmed)) {
    throw new Error("Feishu command prefix must start with / and be 2-32 characters without spaces");
  }
  return trimmed;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}
