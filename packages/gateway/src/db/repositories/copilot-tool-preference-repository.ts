import type { Database } from "../types.js";

/**
 * Per-user Copilot tool switches. One row per (user, tool) that was explicitly
 * toggled; an absent row means the tool is enabled at its registered default.
 * Enforced by both execution paths:
 *   - in-process orchestrator (model schemas + hard check at call time)
 *   - internal bridge routes (dsh runtime callbacks)
 *
 * Like every repository here, instances are constructed per user and all
 * statements carry `WHERE user_id = ?`.
 */
export class CopilotToolPreferenceRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string
  ) {}

  /** Names the owner has explicitly disabled. */
  listDisabled(): string[] {
    const rows = this.db.prepare(`
      SELECT tool_name FROM copilot_tool_preferences WHERE user_id = ? AND enabled = 0
    `).all(this.userId) as Array<{ tool_name: string }>;
    return rows.map((row) => row.tool_name);
  }

  isEnabled(toolName: string): boolean {
    const row = this.db.prepare(`
      SELECT enabled FROM copilot_tool_preferences WHERE user_id = ? AND tool_name = ?
    `).get(this.userId, toolName) as { enabled: number } | undefined;
    return row ? row.enabled === 1 : true;
  }

  setEnabled(toolName: string, enabled: boolean): void {
    this.db.prepare(`
      INSERT INTO copilot_tool_preferences (user_id, tool_name, enabled, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, tool_name) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(this.userId, toolName, enabled ? 1 : 0, Date.now());
  }
}
