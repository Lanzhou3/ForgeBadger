/**
 * Terminal- and hook-notification deduplication.
 *
 * A single CLI prompt can surface through two channels: the CLI-native hook
 * (HTTP) and PTY output interception (OSC 9/99/777, bell). Both land as
 * `session_notification` events, so within a short window the second copy of
 * the same logical notification is dropped.
 *
 * Bucket rules (per session):
 *   - "attention" (terminal bell for Claude/Kimi) shares a bucket with
 *     "permission_prompt" — both mean "the CLI is waiting on the user".
 *   - "task_completed" and "task_failed" are independent buckets.
 *   - Every other type is its own bucket.
 *
 * Source semantics:
 *   - A terminal notification is dropped when ANY source already recorded an
 *     entry in the bucket within the window (hooks are the primary channel;
 *     the terminal copy is the echo).
 *   - A hook notification is dropped only when an earlier HOOK entry exists —
 *     terminal output must never suppress a hook.
 */

export type NotificationSource = "hook" | "terminal";

/** Default suppression window shared by the hook and terminal channels. */
export const notificationDedupeWindowMs = 10_000;

export interface NotificationDeduperOptions {
  /** Suppression window in milliseconds. Default: notificationDedupeWindowMs. */
  windowMs?: number;
  /** Maximum active identity/type buckets. Oldest recorded bucket is evicted. */
  maxBuckets?: number;
}

export interface NotificationDeduper {
  shouldDrop(sessionId: string, notificationType: string, source: NotificationSource, nowMs: number): boolean;
  record(sessionId: string, notificationType: string, source: NotificationSource, nowMs: number): void;
}

interface DedupeEntry {
  source: NotificationSource;
  at: number;
}

export function createNotificationDeduper(options: NotificationDeduperOptions = {}): NotificationDeduper & { readonly size: number } {
  const windowMs = options.windowMs ?? notificationDedupeWindowMs;
  const maxBuckets = options.maxBuckets ?? 4_096;
  if (!Number.isInteger(maxBuckets) || maxBuckets < 1) throw new RangeError("maxBuckets must be a positive integer");
  const entries = new Map<string, DedupeEntry[]>();

  function keyFor(sessionId: string, notificationType: string): string {
    return `${sessionId}\u0000${dedupeBucket(notificationType)}`;
  }

  function prune(list: DedupeEntry[], nowMs: number): DedupeEntry[] {
    const cutoff = nowMs - windowMs;
    return list.filter((entry) => entry.at >= cutoff);
  }

  return {
    get size() { return entries.size; },
    shouldDrop(sessionId, notificationType, source, nowMs) {
      const list = entries.get(keyFor(sessionId, notificationType));
      if (!list) return false;
      for (const entry of list) {
        if (entry.at < nowMs - windowMs) continue;
        if (source === "terminal" || entry.source === "hook") return true;
      }
      return false;
    },
    record(sessionId, notificationType, source, nowMs) {
      // Sweep all identities, including native turns which may never recur.
      for (const [storedKey, storedList] of entries) {
        const active = prune(storedList, nowMs);
        if (active.length) entries.set(storedKey, active);
        else entries.delete(storedKey);
      }
      const key = keyFor(sessionId, notificationType);
      // Only the latest timestamp for each source affects suppression.
      const list = (entries.get(key) ?? []).filter((entry) => entry.source !== source);
      list.push({ source, at: nowMs });
      entries.delete(key);
      entries.set(key, list);
      while (entries.size > maxBuckets) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    }
  };
}

/**
 * "attention" and "permission_prompt" coalesce; everything else is its own
 * bucket (task_completed, task_failed, ...).
 */
function dedupeBucket(notificationType: string): string {
  if (notificationType === "attention") return "permission_prompt";
  return notificationType;
}

/** Process-wide deduper shared by the hook route and terminal ingestion. */
export const defaultNotificationDeduper = createNotificationDeduper();
