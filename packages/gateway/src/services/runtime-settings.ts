import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import {
  cliAutonomyAdaptersSchema,
  registrationModeSchema,
  sessionPrefixSchema,
  type GatewayEnv
} from "../config/env.js";
import { runtimeSettings } from "../db/schema.js";
import type { Database } from "../db/types.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import { z } from "zod";

export type RuntimeSettingKey =
  | "registration"
  | "mcp_enabled"
  | "session_prefix"
  | "cli_autonomy_adapters"
  | "pm_auto_dispatch";

export const RUNTIME_SETTING_KEYS: readonly RuntimeSettingKey[] = [
  "registration",
  "mcp_enabled",
  "session_prefix",
  "cli_autonomy_adapters",
  "pm_auto_dispatch"
];

/** Per-key metadata surfaced to the settings page. */
export const RUNTIME_SETTING_META: Readonly<Record<RuntimeSettingKey, { hot: boolean }>> = {
  // mcp_enabled gates route mounting at startup; every other key is applied
  // to the live process as soon as the write succeeds.
  registration: { hot: true },
  mcp_enabled: { hot: false },
  session_prefix: { hot: true },
  cli_autonomy_adapters: { hot: true },
  pm_auto_dispatch: { hot: true }
};

export interface RuntimeSettingsEffective {
  registration: "open" | "off" | "invite";
  mcpEnabled: boolean;
  sessionPrefix: string;
  cliAutonomyAdapters: readonly string[];
  pmAutoDispatch: boolean;
  /** true when FORGEBADGER_RUNTIME_SETTINGS_READONLY forbids API writes. */
  readonly: boolean;
}

export interface RuntimeSettingView {
  key: RuntimeSettingKey;
  value: unknown;
  source: "env" | "settings";
  hot: boolean;
}

export interface RuntimeSettingsStore {
  /** Effective values (DB override on top of env defaults). */
  effective(): RuntimeSettingsEffective;
  /** Per-key views for the settings page (value + provenance + hot/restart). */
  views(): RuntimeSettingView[];
  /**
   * Validate and persist a partial update, apply hot changes through the
   * injected applier, record an audit entry, and return the refreshed views.
   * Throws a RuntimeSettingsError on invalid input or readonly mode.
   */
  update(
    userId: string,
    patch: Partial<Record<RuntimeSettingKey, unknown>>,
    ipAddress?: string
  ): RuntimeSettingView[];
}

export class RuntimeSettingsError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "RuntimeSettingsError";
  }
}

const booleanInput = z.union([z.boolean(), z.enum(["true", "false"])]);
const toBoolean = (value: boolean | "true" | "false"): boolean => value === true || value === "true";

const patchSchema = z
  .object({
    registration: registrationModeSchema.optional(),
    mcp_enabled: booleanInput.optional(),
    session_prefix: sessionPrefixSchema.optional(),
    // Accepts either an adapter array or a comma-separated string, exactly
    // like the FORGEBADGER_CLI_AUTONOMY_ADAPTERS env variable.
    cli_autonomy_adapters: cliAutonomyAdaptersSchema.optional(),
    pm_auto_dispatch: booleanInput.optional()
  })
  .strict();

export function envToEffective(env: GatewayEnv): RuntimeSettingsEffective {
  return {
    registration: env.FORGEBADGER_REGISTRATION,
    mcpEnabled: env.FORGEBADGER_MCP_ENABLED,
    sessionPrefix: env.FORGEBADGER_SESSION_PREFIX,
    cliAutonomyAdapters: env.FORGEBADGER_CLI_AUTONOMY_ADAPTERS,
    pmAutoDispatch: env.FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED,
    readonly: env.FORGEBADGER_RUNTIME_SETTINGS_READONLY
  };
}

export interface RuntimeSettingsStoreOptions {
  env: GatewayEnv;
  /**
   * Called with the refreshed effective values after each successful write
   * (and once at wiring time). The applier pushes hot changes into the live
   * process (autonomy registry, session prefix, dispatch supervisor, ...).
   */
  apply?: (effective: RuntimeSettingsEffective) => void;
}

export function createRuntimeSettingsStore(db: Database, options: RuntimeSettingsStoreOptions): RuntimeSettingsStore {
  const { env, apply } = options;
  const dbClient = drizzle(db);

  function safeJsonParse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  function readOverrides(): Map<string, unknown> {
    const rows = dbClient.select().from(runtimeSettings).all();
    const overrides = new Map<string, unknown>();
    for (const row of rows) {
      // A corrupt override falls back to env instead of breaking reads.
      overrides.set(row.key, safeJsonParse(row.value));
    }
    return overrides;
  }

  function effective(): RuntimeSettingsEffective {
    const merged = envToEffective(env);
    const overrides = readOverrides();
    if (overrides.has("registration")) {
      const value = registrationModeSchema.safeParse(overrides.get("registration"));
      if (value.success) merged.registration = value.data;
    }
    if (overrides.has("mcp_enabled")) {
      const value = z.boolean().safeParse(overrides.get("mcp_enabled"));
      if (value.success) merged.mcpEnabled = value.data;
    }
    if (overrides.has("session_prefix")) {
      const value = sessionPrefixSchema.safeParse(overrides.get("session_prefix"));
      if (value.success) merged.sessionPrefix = value.data;
    }
    if (overrides.has("cli_autonomy_adapters")) {
      const value = z.array(z.enum(["claude", "opencode", "codex", "kimi", "pi"])).safeParse(overrides.get("cli_autonomy_adapters"));
      if (value.success) merged.cliAutonomyAdapters = value.data;
    }
    if (overrides.has("pm_auto_dispatch")) {
      const value = z.boolean().safeParse(overrides.get("pm_auto_dispatch"));
      if (value.success) merged.pmAutoDispatch = value.data;
    }
    return merged;
  }

  function envValueOf(current: RuntimeSettingsEffective, key: RuntimeSettingKey): unknown {
    switch (key) {
      case "registration":
        return current.registration;
      case "mcp_enabled":
        return current.mcpEnabled;
      case "session_prefix":
        return current.sessionPrefix;
      case "cli_autonomy_adapters":
        return [...current.cliAutonomyAdapters];
      case "pm_auto_dispatch":
        return current.pmAutoDispatch;
    }
  }

  function views(): RuntimeSettingView[] {
    const current = effective();
    const overrides = readOverrides();
    const values: Record<RuntimeSettingKey, unknown> = {
      registration: current.registration,
      mcp_enabled: current.mcpEnabled,
      session_prefix: current.sessionPrefix,
      cli_autonomy_adapters: [...current.cliAutonomyAdapters],
      pm_auto_dispatch: current.pmAutoDispatch
    };
    return RUNTIME_SETTING_KEYS.map((key) => ({
      key,
      value: values[key],
      source: overrides.has(key) ? "settings" : "env",
      hot: RUNTIME_SETTING_META[key].hot
    }));
  }

  function update(
    userId: string,
    patch: Partial<Record<RuntimeSettingKey, unknown>>,
    ipAddress?: string
  ): RuntimeSettingView[] {
    const parsed = patchSchema.safeParse(patch ?? {});
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw new RuntimeSettingsError(400, "Invalid runtime settings input");
    }
    const data = parsed.data;

    const before = effective();
    if (before.readonly) {
      throw new RuntimeSettingsError(
        403,
        "Runtime settings are read-only (FORGEBADGER_RUNTIME_SETTINGS_READONLY); update .env and restart the Gateway"
      );
    }

    const normalized: Partial<Record<RuntimeSettingKey, unknown>> = {
      registration: data.registration,
      mcp_enabled: data.mcp_enabled === undefined ? undefined : toBoolean(data.mcp_enabled),
      session_prefix: data.session_prefix,
      cli_autonomy_adapters: data.cli_autonomy_adapters,
      pm_auto_dispatch: data.pm_auto_dispatch === undefined ? undefined : toBoolean(data.pm_auto_dispatch)
    };

    const now = Date.now();
    const changes: Record<string, { before: unknown; beforeSource: "env" | "settings"; after: unknown }> = {};
    db.transaction(() => {
      for (const key of RUNTIME_SETTING_KEYS) {
        if (normalized[key] === undefined) continue;
        const row = dbClient.select().from(runtimeSettings).where(eq(runtimeSettings.key, key)).get();
        changes[key] = {
          before: row ? safeJsonParse(row.value) : envValueOf(before, key),
          beforeSource: row ? "settings" : "env",
          after: normalized[key]
        };
        dbClient.insert(runtimeSettings)
          .values({ key, value: JSON.stringify(normalized[key]), updatedAt: now, updatedBy: userId })
          .onConflictDoUpdate({
            target: runtimeSettings.key,
            set: { value: JSON.stringify(normalized[key]), updatedAt: now, updatedBy: userId }
          })
          .run();
      }
    })();

    const after = effective();
    try {
      apply?.(after);
    } catch (error) {
      console.error("[runtime-settings] apply failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new RuntimeSettingsError(500, "Failed to apply runtime settings");
    }

    try {
      new AuditLogRepository(db, userId).create({
        action: "runtime_settings.update",
        resourceType: "runtime_settings",
        resourceId: Object.keys(changes).join(","),
        details: { changes },
        ipAddress: ipAddress ?? null
      });
    } catch (error) {
      console.error("[runtime-settings] audit write failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return views();
  }

  // Apply once at wiring so a pre-existing DB override is live even when it
  // diverges from the env the process started with.
  apply?.(effective());

  return { effective, views, update };
}
