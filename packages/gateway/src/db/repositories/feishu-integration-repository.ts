import { randomUUID } from "node:crypto";

import type { Database } from "../types.js";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../crypto/secret-box.js";

export type FeishuIdentityMode = "user" | "bot" | "unknown";
export type FeishuWebhookRateScope = "integration" | "chat" | "user";

export interface FeishuIntegrationConfig {
  enabled: boolean;
  emergencyDisabled: boolean;
  identityMode: FeishuIdentityMode;
  allowedChatIds: string[];
  commandPrefix: string;
  publicWebhookId: string | null;
  publicWebhookEnabled: boolean;
  webhookConfiguredAt: number | null;
}

export interface UpdateFeishuIntegrationConfigInput {
  enabled?: boolean | undefined;
  emergencyDisabled?: boolean | undefined;
  identityMode?: FeishuIdentityMode | undefined;
  allowedChatIds?: string[] | undefined;
  commandPrefix?: string | undefined;
}

export interface ConfigureFeishuPublicWebhookInput {
  publicWebhookId?: string | undefined;
  publicWebhookEnabled?: boolean | undefined;
  verificationToken: string;
  eventEncryptKey: string;
}

export interface FeishuPublicWebhookConfig {
  userId: string;
  enabled: boolean;
  emergencyDisabled: boolean;
  identityMode: FeishuIdentityMode;
  allowedChatIds: string[];
  commandPrefix: string;
  publicWebhookId: string;
  publicWebhookEnabled: boolean;
  verificationToken: string;
  eventEncryptKey: string;
  webhookConfiguredAt: number | null;
}

export interface ConsumeFeishuWebhookReplayInput {
  userId: string;
  publicWebhookId: string;
  replayKey: string;
  ttlMs: number;
}

export interface ConsumeFeishuWebhookRateInput {
  userId: string;
  publicWebhookId: string;
  scope: FeishuWebhookRateScope;
  scopeId: string;
  max: number;
  windowMs: number;
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
  public_webhook_id: string | null;
  public_webhook_enabled: number;
  verification_token_encrypted: string | null;
  event_encrypt_key_encrypted: string | null;
  webhook_configured_at: number | null;
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
  commandPrefix: "/openforge",
  publicWebhookId: null,
  publicWebhookEnabled: false,
  webhookConfiguredAt: null
};

const maxAllowedChatIds = 50;
const maxUserMappings = 100;

export class FeishuIntegrationRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly masterKey?: string
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
        : normalizeCommandPrefix(input.commandPrefix),
      publicWebhookId: existing.publicWebhookId,
      publicWebhookEnabled: existing.publicWebhookEnabled,
      webhookConfiguredAt: existing.webhookConfiguredAt
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

  configurePublicWebhook(input: ConfigureFeishuPublicWebhookInput): FeishuIntegrationConfig {
    const publicWebhookId = normalizePublicWebhookId(input.publicWebhookId ?? randomUUID());
    const verificationToken = normalizeWebhookSecret(input.verificationToken, "verification token");
    const eventEncryptKey = normalizeWebhookSecret(input.eventEncryptKey, "event encrypt key");
    const now = Date.now();
    const existing = this.getConfig();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO integration_feishu_configs (
        id, user_id, enabled, emergency_disabled, identity_mode, allowed_chat_ids,
        command_prefix, public_webhook_id, public_webhook_enabled,
        verification_token_encrypted, event_encrypt_key_encrypted, webhook_configured_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        public_webhook_id = excluded.public_webhook_id,
        public_webhook_enabled = excluded.public_webhook_enabled,
        verification_token_encrypted = excluded.verification_token_encrypted,
        event_encrypt_key_encrypted = excluded.event_encrypt_key_encrypted,
        webhook_configured_at = excluded.webhook_configured_at,
        updated_at = excluded.updated_at
    `).run(
      id,
      this.userId,
      boolToInt(existing.enabled),
      boolToInt(existing.emergencyDisabled),
      existing.identityMode,
      JSON.stringify(existing.allowedChatIds),
      existing.commandPrefix,
      publicWebhookId,
      boolToInt(input.publicWebhookEnabled ?? false),
      this.encryptWebhookSecret(verificationToken),
      this.encryptWebhookSecret(eventEncryptKey),
      now,
      now,
      now
    );

    return this.getConfig();
  }

  findPublicWebhookConfig(publicWebhookId: string): FeishuPublicWebhookConfig | undefined {
    const normalized = normalizePublicWebhookId(publicWebhookId);
    const row = this.db.prepare(`
      SELECT * FROM integration_feishu_configs
      WHERE public_webhook_id = ?
    `).get(normalized) as FeishuConfigRow | undefined;
    if (!row || !row.public_webhook_id) return undefined;
    const config = toConfig(row);
    return {
      userId: row.user_id,
      enabled: config.enabled,
      emergencyDisabled: config.emergencyDisabled,
      identityMode: config.identityMode,
      allowedChatIds: config.allowedChatIds,
      commandPrefix: config.commandPrefix,
      publicWebhookId: row.public_webhook_id,
      publicWebhookEnabled: row.public_webhook_enabled === 1,
      verificationToken: this.decryptWebhookSecret(row.verification_token_encrypted),
      eventEncryptKey: this.decryptWebhookSecret(row.event_encrypt_key_encrypted),
      webhookConfiguredAt: row.webhook_configured_at
    };
  }

  consumePublicWebhookReplayKey(input: ConsumeFeishuWebhookReplayInput): boolean {
    const now = Date.now();
    const expiresAt = now + Math.max(1, input.ttlMs);
    const consume = this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM integration_feishu_webhook_replay_entries
        WHERE expires_at <= ?
      `).run(now);
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO integration_feishu_webhook_replay_entries (
          id, user_id, public_webhook_id, replay_key, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        input.userId,
        normalizePublicWebhookId(input.publicWebhookId),
        normalizeReplayKey(input.replayKey),
        expiresAt,
        now
      );
      return result.changes === 1;
    });
    return consume();
  }

  consumePublicWebhookRateWindow(input: ConsumeFeishuWebhookRateInput): boolean {
    const now = Date.now();
    const windowMs = Math.max(1, input.windowMs);
    const max = Math.max(1, input.max);
    const publicWebhookId = normalizePublicWebhookId(input.publicWebhookId);
    const scopeId = normalizeRateScopeId(input.scopeId);
    const consume = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT window_started_at, count
        FROM integration_feishu_webhook_rate_windows
        WHERE user_id = ? AND public_webhook_id = ? AND scope = ? AND scope_id = ?
      `).get(input.userId, publicWebhookId, input.scope, scopeId) as {
        window_started_at: number;
        count: number;
      } | undefined;
      if (!existing || now - existing.window_started_at >= windowMs) {
        this.db.prepare(`
          INSERT INTO integration_feishu_webhook_rate_windows (
            id, user_id, public_webhook_id, scope, scope_id, window_started_at, count, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(user_id, public_webhook_id, scope, scope_id) DO UPDATE SET
            window_started_at = excluded.window_started_at,
            count = 1,
            updated_at = excluded.updated_at
        `).run(randomUUID(), input.userId, publicWebhookId, input.scope, scopeId, now, now);
        return true;
      }
      if (existing.count >= max) return false;
      this.db.prepare(`
        UPDATE integration_feishu_webhook_rate_windows
        SET count = count + 1, updated_at = ?
        WHERE user_id = ? AND public_webhook_id = ? AND scope = ? AND scope_id = ?
      `).run(now, input.userId, publicWebhookId, input.scope, scopeId);
      return true;
    });
    return consume();
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

  private encryptWebhookSecret(value: string): string {
    if (!this.masterKey) {
      throw new Error("Master key is required for Feishu public webhook secrets");
    }
    return JSON.stringify(encryptSecret(value, { key: this.masterKey }));
  }

  private decryptWebhookSecret(value: string | null): string {
    if (!value) {
      throw new Error("Feishu public webhook is missing encrypted verification settings");
    }
    if (!this.masterKey) {
      throw new Error("Master key is required for Feishu public webhook verification");
    }
    return decryptSecret(parseEncryptedSecret(value), { key: this.masterKey });
  }
}

function toConfig(row: FeishuConfigRow): FeishuIntegrationConfig {
  return {
    enabled: row.enabled === 1,
    emergencyDisabled: row.emergency_disabled === 1,
    identityMode: normalizeIdentityMode(row.identity_mode),
    allowedChatIds: parseAllowedChatIds(row.allowed_chat_ids),
    commandPrefix: normalizeCommandPrefix(row.command_prefix),
    publicWebhookId: row.public_webhook_id,
    publicWebhookEnabled: row.public_webhook_enabled === 1,
    webhookConfiguredAt: row.webhook_configured_at
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

function normalizePublicWebhookId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    throw new Error("Feishu public webhook id must be 1-128 URL-safe characters");
  }
  return trimmed;
}

function normalizeWebhookSecret(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) {
    throw new Error(`Feishu public webhook ${label} must be 1-512 characters`);
  }
  return trimmed;
}

function normalizeReplayKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) {
    throw new Error("Feishu public webhook replay key must be 1-512 characters");
  }
  return trimmed;
}

function normalizeRateScopeId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) {
    throw new Error("Feishu public webhook rate scope id must be 1-256 characters");
  }
  return trimmed;
}

function parseEncryptedSecret(value: string): EncryptedSecret {
  try {
    const parsed = JSON.parse(value) as EncryptedSecret;
    if (
      parsed.algorithm === "aes-256-gcm" &&
      typeof parsed.iv === "string" &&
      typeof parsed.ciphertext === "string" &&
      typeof parsed.authTag === "string"
    ) {
      return parsed;
    }
  } catch {
    // Fall through to the generic error below.
  }
  throw new Error("Invalid encrypted Feishu public webhook secret");
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}
