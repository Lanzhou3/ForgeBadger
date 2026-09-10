import type { Database } from "../types.js";
import type { AdapterId } from "../../services/adapter-discovery.js";

export interface CliConfigAppliedProvider {
  adapter: AdapterId;
  providerProfileId: string;
  modelProfileId: string | null;
  appliedAt: number;
}

interface AppliedProviderRow {
  adapter: string;
  provider_profile_id: string;
  model_profile_id: string | null;
  applied_at: number;
}

/**
 * Records which Model Center provider was last applied to each adapter's
 * global CLI config, so read-only surfaces (session sidebar quota) can resolve
 * "the current provider" without parsing CLI config files.
 */
export class CliConfigAppliedProviderRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  upsert(adapter: AdapterId, providerProfileId: string, modelProfileId: string | null): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO cli_config_applied_providers (
        user_id, adapter, provider_profile_id, model_profile_id, applied_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, adapter) DO UPDATE SET
        provider_profile_id = excluded.provider_profile_id,
        model_profile_id = excluded.model_profile_id,
        applied_at = excluded.applied_at,
        updated_at = excluded.updated_at
    `).run(this.userId, adapter, providerProfileId, modelProfileId, now, now, now);
  }

  get(adapter: AdapterId): CliConfigAppliedProvider | undefined {
    const row = this.db.prepare(`
      SELECT adapter, provider_profile_id, model_profile_id, applied_at
      FROM cli_config_applied_providers
      WHERE user_id = ? AND adapter = ?
    `).get(this.userId, adapter) as AppliedProviderRow | undefined;
    if (!row) return undefined;
    return {
      adapter: row.adapter as AdapterId,
      providerProfileId: row.provider_profile_id,
      modelProfileId: row.model_profile_id,
      appliedAt: row.applied_at
    };
  }

  clear(adapter: AdapterId): void {
    this.db.prepare(`
      DELETE FROM cli_config_applied_providers
      WHERE user_id = ? AND adapter = ?
    `).run(this.userId, adapter);
  }
}
