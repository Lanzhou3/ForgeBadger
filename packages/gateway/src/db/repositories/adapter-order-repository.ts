import { isCanonicalAdapterId, type CanonicalAdapterId } from "../../lib/adapter-ids.js";
import type { Database } from "../types.js";

interface AdapterOrderRow {
  adapter_order: string | null;
}

/**
 * Per-user Code CLI display-order preference, persisted in
 * user_settings.adapter_order as a JSON array of canonical adapter ids. The
 * Settings → AI adapters drag-sort writes it; every picker that lists CLIs
 * (new-session dialog, AdapterSelect) renders the preferred ids first and
 * appends anything missing (e.g. newly added adapters) in discovery order, so
 * the stored value never needs a migration when the adapter list grows.
 */
export class AdapterOrderRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string
  ) {}

  get(): CanonicalAdapterId[] {
    const row = this.db.prepare(`
      SELECT adapter_order
      FROM user_settings
      WHERE user_id = ?
    `).get(this.userId) as AdapterOrderRow | undefined;
    if (!row?.adapter_order) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.adapter_order);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return normalizeAdapterOrder(parsed);
  }

  /** Replaces the preference; unknown ids are dropped and duplicates collapse. */
  set(order: readonly string[]): CanonicalAdapterId[] {
    const normalized = normalizeAdapterOrder(order);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO user_settings (user_id, adapter_order, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        adapter_order = excluded.adapter_order,
        updated_at = excluded.updated_at
    `).run(this.userId, JSON.stringify(normalized), now, now);
    return normalized;
  }
}

function normalizeAdapterOrder(order: readonly unknown[]): CanonicalAdapterId[] {
  const seen = new Set<string>();
  const normalized: CanonicalAdapterId[] = [];
  for (const entry of order) {
    if (typeof entry !== "string" || !isCanonicalAdapterId(entry) || seen.has(entry)) continue;
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized;
}
