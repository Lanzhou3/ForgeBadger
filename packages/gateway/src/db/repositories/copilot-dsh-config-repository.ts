import type { Database } from "../types.js";

/**
 * Per-user dsh kernel configuration (M4). One row per user in
 * `copilot_dsh_config`; absent row = all defaults (system default model,
 * every optional plugin at its default on/off).
 *
 * Like every repository here, instances are constructed per user and all
 * statements carry `WHERE user_id = ?`.
 */
export interface CopilotDshConfig {
  userId: string;
  /** Model profile id overriding the system default for dsh runs; null = follow system default. */
  defaultModelId: string | null;
  /** Plugin on/off map keyed by the availablePlugins whitelist (sparse: only explicitly set keys). */
  plugins: Record<string, boolean>;
  updatedAt: Date;
}

export interface UpsertCopilotDshConfigInput {
  /** Absent = unchanged; null = clear back to the system default. */
  defaultModelId?: string | null | undefined;
  /** Merged key-by-key into the stored map. */
  plugins?: Record<string, boolean> | undefined;
}

interface CopilotDshConfigRow {
  user_id: string;
  default_model_id: string | null;
  plugins_json: string;
  updated_at: number;
}

export class CopilotDshConfigRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string
  ) {}

  get(): CopilotDshConfig | undefined {
    const row = this.db.prepare(`
      SELECT user_id, default_model_id, plugins_json, updated_at
      FROM copilot_dsh_config
      WHERE user_id = ?
    `).get(this.userId) as CopilotDshConfigRow | undefined;
    return row ? toConfig(row) : undefined;
  }

  upsert(input: UpsertCopilotDshConfigInput): CopilotDshConfig {
    const existing = this.get();
    const defaultModelId = input.defaultModelId === undefined
      ? existing?.defaultModelId ?? null
      : input.defaultModelId;
    const plugins = { ...(existing?.plugins ?? {}), ...(input.plugins ?? {}) };
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO copilot_dsh_config (user_id, default_model_id, plugins_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        default_model_id = excluded.default_model_id,
        plugins_json = excluded.plugins_json,
        updated_at = excluded.updated_at
    `).run(this.userId, defaultModelId, JSON.stringify(plugins), now);
    const stored = this.get();
    if (!stored) throw new Error("Failed to persist copilot dsh config");
    return stored;
  }
}

function toConfig(row: CopilotDshConfigRow): CopilotDshConfig {
  let plugins: Record<string, boolean> = {};
  try {
    const parsed: unknown = JSON.parse(row.plugins_json);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      plugins = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === "boolean")
      ) as Record<string, boolean>;
    }
  } catch {
    // A corrupt plugins payload degrades to defaults, never to a read failure.
  }
  return {
    userId: row.user_id,
    defaultModelId: row.default_model_id,
    plugins,
    updatedAt: new Date(row.updated_at)
  };
}
