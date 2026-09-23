import { AgentError } from "../../services/agent/types.js";
import type { Database } from "../types.js";
import { ModelProviderRepository } from "./model-provider-repository.js";

export type ThinkingEffort = "off" | "low" | "medium" | "high";

export interface CopilotPreferences {
  modelId: string | null;
  thinkingEffort: ThinkingEffort;
}

const THINKING_EFFORTS: ReadonlySet<string> = new Set<ThinkingEffort>(["off", "low", "medium", "high"]);

interface PreferencesRow {
  model_id: string | null;
  copilot_thinking_effort: string | null;
}

/**
 * Per-user Copilot model + thinking-strength preferences, persisted in
 * user_settings (model_id + copilot_thinking_effort) so every entry point —
 * the web console, chat bots, automations — resolves the same model and
 * thinking strength the user picked. The LLM client falls back to these when
 * a request carries no explicit modelId.
 */
export class CopilotPreferencesRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    /**
     * Master key for the model-provider repository used to validate the
     * preferred profile. Optional (defaults to "") because profile lookup is
     * read-only and never decrypts credentials — but callers with the key
     * should pass it so no future code path can silently use an empty key.
     */
    private readonly masterKey: string = ""
  ) {}

  get(): CopilotPreferences {
    const row = this.db.prepare(`
      SELECT model_id, copilot_thinking_effort
      FROM user_settings
      WHERE user_id = ?
    `).get(this.userId) as PreferencesRow | undefined;
    return {
      modelId: row?.model_id ?? null,
      thinkingEffort: normalizeThinkingEffort(row?.copilot_thinking_effort)
    };
  }

  /**
   * Partial update. modelId: null clears the preference; any other value must
   * be one of the user's active model profiles. Returns the full updated
   * preference.
   */
  set(patch: { modelId?: string | null; thinkingEffort?: ThinkingEffort }): CopilotPreferences {
    if (patch.modelId === undefined && patch.thinkingEffort === undefined) return this.get();
    if (patch.modelId !== undefined && patch.modelId !== null) this.assertActiveModelProfile(patch.modelId);
    const current = this.get();
    const modelId = patch.modelId !== undefined ? patch.modelId : current.modelId;
    const thinkingEffort = patch.thinkingEffort !== undefined ? patch.thinkingEffort : current.thinkingEffort;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO user_settings (user_id, model_id, copilot_thinking_effort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        model_id = excluded.model_id,
        copilot_thinking_effort = excluded.copilot_thinking_effort,
        updated_at = excluded.updated_at
    `).run(this.userId, modelId, thinkingEffort, now, now);
    return this.get();
  }

  private assertActiveModelProfile(modelId: string): void {
    const profile = new ModelProviderRepository(this.db, this.userId, this.masterKey).getModelProfile(modelId);
    if (!profile || profile.status !== "active") {
      throw new AgentError("COPILOT_MODEL_INVALID", "Model profile is not available for the Copilot preference");
    }
  }
}

function normalizeThinkingEffort(value: string | null | undefined): ThinkingEffort {
  if (value !== null && value !== undefined && THINKING_EFFORTS.has(value)) return value as ThinkingEffort;
  return "off";
}
