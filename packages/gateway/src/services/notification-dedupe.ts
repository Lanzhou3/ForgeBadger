/**
 * Terminal- and hook-notification deduplication.
 *
 * A single CLI prompt can surface through two channels: the CLI-native hook
 * (HTTP) and PTY output interception (OSC 9/99/777, bell). Both land as
 * `claude_notification` events, so within a short window the second copy of
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
}

export interface NotificationDeduper {
  shouldDrop(sessionId: string, notificationType: string, source: NotificationSource, nowMs: number): boolean;
  record(sessionId: string, notificationType: string, source: NotificationSource, nowMs: number): void;
}

interface DedupeEntry {
  source: NotificationSource;
  at: number;
}

export function createNotificationDeduper(options: NotificationDeduperOptions = {}): NotificationDeduper {
  const windowMs = options.windowMs ?? notificationDedupeWindowMs;
  const entries = new Map<string, DedupeEntry[]>();

  function keyFor(sessionId: string, notificationType: string): string {
    return `${sessionId}\u0000${dedupeBucket(notificationType)}`;
  }

  function prune(list: DedupeEntry[], nowMs: number): DedupeEntry[] {
    const cutoff = nowMs - windowMs;
    return list.filter((entry) => entry.at >= cutoff);
  }

  return {
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
      const key = keyFor(sessionId, notificationType);
      const list = prune(entries.get(key) ?? [], nowMs);
      list.push({ source, at: nowMs });
      entries.set(key, list);
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
