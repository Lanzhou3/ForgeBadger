import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FeishuIntegrationRepository, type FeishuIdentityMode } from "../packages/gateway/src/db/repositories/feishu-integration-repository.js";
import { UserRepository } from "../packages/gateway/src/db/repositories/user-repository.js";

const gatewayRequire = createRequire(new URL("../packages/gateway/package.json", import.meta.url));
const Database = gatewayRequire("better-sqlite3");
const { drizzle } = gatewayRequire("drizzle-orm/better-sqlite3");
const { migrate } = gatewayRequire("drizzle-orm/better-sqlite3/migrator");

type PrepareConfig =
  | {
      ok: true;
      dbPath: string;
      masterKey: string;
      openforgeUserId?: string;
      openforgeUserEmail?: string;
      publicWebhookId: string;
      publicWebhookEnabled: boolean;
      integrationEnabled: boolean;
      emergencyDisabled: boolean;
      identityMode: FeishuIdentityMode;
      allowedChatIds: string[];
      userMappings: FeishuMappingInput[];
      verificationToken: string;
      eventEncryptKey: string;
    }
  | {
      ok: false;
      reason: string;
    };

interface FeishuMappingInput {
  feishuUserId: string;
  openforgeUserId?: string;
  displayName?: string | null;
}

export interface PrepareFeishuPublicWebhookResult {
  ok: true;
  userId: string;
  userEmail: string;
  publicWebhookId: string;
  callbackPath: string;
  publicWebhookEnabled: boolean;
  integrationEnabled: boolean;
  emergencyDisabled: boolean;
  identityMode: FeishuIdentityMode;
  allowedChatIdCount: number;
  mappingCount: number;
  webhookConfiguredAt: number | null;
}

export function resolvePrepareFeishuPublicWebhookConfig(
  env: Record<string, string | undefined>
): PrepareConfig {
  const dbPath = nonEmpty(env.OPENFORGE_DB_PATH);
  if (!dbPath) return missing("OPENFORGE_DB_PATH");
  const masterKey = nonEmpty(env.OPENFORGE_MASTER_KEY);
  if (!masterKey) return missing("OPENFORGE_MASTER_KEY");
  const publicWebhookId = nonEmpty(env.OPENFORGE_FEISHU_PUBLIC_WEBHOOK_ID);
  if (!publicWebhookId) return missing("OPENFORGE_FEISHU_PUBLIC_WEBHOOK_ID");
  const verificationToken = nonEmpty(env.OPENFORGE_FEISHU_WEBHOOK_VERIFICATION_TOKEN);
  if (!verificationToken) return missing("OPENFORGE_FEISHU_WEBHOOK_VERIFICATION_TOKEN");
  const eventEncryptKey = nonEmpty(env.OPENFORGE_FEISHU_WEBHOOK_EVENT_ENCRYPT_KEY);
  if (!eventEncryptKey) return missing("OPENFORGE_FEISHU_WEBHOOK_EVENT_ENCRYPT_KEY");

  const openforgeUserId = nonEmpty(env.OPENFORGE_FEISHU_OPENFORGE_USER_ID);
  const openforgeUserEmail = nonEmpty(env.OPENFORGE_FEISHU_OPENFORGE_USER_EMAIL);
  if (!openforgeUserId && !openforgeUserEmail) {
    return { ok: false, reason: "OPENFORGE_FEISHU_OPENFORGE_USER_ID or OPENFORGE_FEISHU_OPENFORGE_USER_EMAIL is required" };
  }

  const identityMode = parseIdentityMode(env.OPENFORGE_FEISHU_IDENTITY_MODE);
  if (!identityMode) {
    return { ok: false, reason: "OPENFORGE_FEISHU_IDENTITY_MODE must be user or bot when provided" };
  }

  const mappings = parseUserMappings(env.OPENFORGE_FEISHU_USER_MAPPINGS_JSON);
  if (!mappings.ok) return mappings;

  return {
    ok: true,
    dbPath,
    masterKey,
    ...(openforgeUserId ? { openforgeUserId } : {}),
    ...(openforgeUserEmail ? { openforgeUserEmail } : {}),
    publicWebhookId,
    publicWebhookEnabled: parseBoolean(env.OPENFORGE_FEISHU_PUBLIC_WEBHOOK_ENABLED, true),
    integrationEnabled: parseBoolean(env.OPENFORGE_FEISHU_INTEGRATION_ENABLED, true),
    emergencyDisabled: parseBoolean(env.OPENFORGE_FEISHU_EMERGENCY_DISABLED, false),
    identityMode,
    allowedChatIds: parseCsv(env.OPENFORGE_FEISHU_ALLOWED_CHAT_IDS),
    userMappings: mappings.value,
    verificationToken,
    eventEncryptKey
  };
}

export function prepareFeishuPublicWebhook(
  config: Extract<PrepareConfig, { ok: true }>
): PrepareFeishuPublicWebhookResult {
  const db = openDatabase(config.dbPath);
  try {
    const users = new UserRepository(db);
    const user = config.openforgeUserId
      ? users.findById(config.openforgeUserId)
      : users.findByEmail(config.openforgeUserEmail ?? "");
    if (!user) {
      throw new Error("OpenForge user for Feishu public webhook setup was not found");
    }

    const repo = new FeishuIntegrationRepository(db, user.id, config.masterKey);
    repo.upsertConfig({
      enabled: config.integrationEnabled,
      emergencyDisabled: config.emergencyDisabled,
      identityMode: config.identityMode,
      allowedChatIds: config.allowedChatIds
    });
    const normalizedMappings = config.userMappings.map((mapping) => ({
      feishuUserId: mapping.feishuUserId,
      openforgeUserId: mapping.openforgeUserId ?? user.id,
      displayName: mapping.displayName ?? null
    }));
    if (normalizedMappings.length > 0) {
      repo.replaceUserMappings(normalizedMappings);
    }
    const publicConfig = repo.configurePublicWebhook({
      publicWebhookId: config.publicWebhookId,
      publicWebhookEnabled: config.publicWebhookEnabled,
      verificationToken: config.verificationToken,
      eventEncryptKey: config.eventEncryptKey
    });

    return {
      ok: true,
      userId: user.id,
      userEmail: user.email,
      publicWebhookId: publicConfig.publicWebhookId ?? config.publicWebhookId,
      callbackPath: `/api/v1/integrations/feishu/webhook/${publicConfig.publicWebhookId ?? config.publicWebhookId}`,
      publicWebhookEnabled: publicConfig.publicWebhookEnabled,
      integrationEnabled: publicConfig.enabled,
      emergencyDisabled: publicConfig.emergencyDisabled,
      identityMode: publicConfig.identityMode,
      allowedChatIdCount: publicConfig.allowedChatIds.length,
      mappingCount: repo.listUserMappings().length,
      webhookConfiguredAt: publicConfig.webhookConfiguredAt
    };
  } finally {
    db.close();
  }
}

function openDatabase(dbPath: string) {
  const resolvedPath = resolveDbPath(dbPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  const migrationsFolder = path.join(workspaceRoot(), "packages/gateway/src/db/migrations");
  migrate(drizzle(db), { migrationsFolder });
  return db;
}

function resolveDbPath(dbPath: string): string {
  return dbPath.startsWith("~/") ? path.join(homedir(), dbPath.slice(2)) : dbPath;
}

function workspaceRoot(): string {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function missing(name: string): PrepareConfig {
  return { ok: false, reason: `${name} is required` };
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ["1", "true", "yes", "on", "enabled"].includes(normalized);
}

function parseIdentityMode(value: string | undefined): FeishuIdentityMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "bot";
  if (normalized === "bot" || normalized === "user") return normalized;
  return undefined;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseUserMappings(value: string | undefined): { ok: true; value: FeishuMappingInput[] } | PrepareConfig {
  const trimmed = value?.trim();
  if (!trimmed) return { ok: true, value: [] };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, reason: "OPENFORGE_FEISHU_USER_MAPPINGS_JSON must be an array" };
    }
    const mappings: FeishuMappingInput[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { ok: false, reason: "OPENFORGE_FEISHU_USER_MAPPINGS_JSON contains an invalid mapping" };
      }
      const record = item as Record<string, unknown>;
      if (typeof record.feishuUserId !== "string" || record.feishuUserId.trim().length === 0) {
        return { ok: false, reason: "Each Feishu user mapping requires feishuUserId" };
      }
      mappings.push({
        feishuUserId: record.feishuUserId.trim(),
        ...(typeof record.openforgeUserId === "string" && record.openforgeUserId.trim()
          ? { openforgeUserId: record.openforgeUserId.trim() }
          : {}),
        ...(typeof record.displayName === "string" && record.displayName.trim()
          ? { displayName: record.displayName.trim() }
          : {})
      });
    }
    return { ok: true, value: mappings };
  } catch {
    return { ok: false, reason: "OPENFORGE_FEISHU_USER_MAPPINGS_JSON must be valid JSON" };
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return import.meta.url === entry;
}

function main(): void {
  const config = resolvePrepareFeishuPublicWebhookConfig(process.env);
  if (!config.ok) {
    console.error(JSON.stringify({ ok: false, reason: config.reason }, null, 2));
    process.exitCode = 1;
    return;
  }
  try {
    const result = prepareFeishuPublicWebhook(config);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: error instanceof Error ? error.message : "Failed to prepare Feishu public webhook"
    }, null, 2));
    process.exitCode = 1;
  }
}

if (isMainModule()) {
  main();
}
