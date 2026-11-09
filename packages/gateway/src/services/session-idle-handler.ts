/**
 * PTY idle-transition handling.
 *
 * The Session Server daemon reports when a session's PTY went quiet after
 * activity (`session_idle` pushes). Some CLIs have no reliable completion
 * signal on certain versions (e.g. kimi 2.1.1 never fires its Stop hook),
 * which strands their work state at "working" forever. Silence at the PTY
 * level is ground truth, so a quiet session is flipped back to "idle".
 *
 * This deliberately never emits notifications and never writes to the DB —
 * it only corrects the in-memory work-state indicator.
 */
import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { sessions } from "../db/schema.js";
import type { Database } from "../db/types.js";
import type { ForgeBadgerEventBus } from "./event-bus.js";

export interface HandleSessionIdleOptions {
  db: Database;
  eventBus: ForgeBadgerEventBus;
  sessionId: string;
}

export function handleSessionIdle(options: HandleSessionIdleOptions): void {
  const { db, eventBus, sessionId } = options;
  // The daemon only knows the runtime session name; match it against
  // runtime_session_name first and fall back to the raw id (same lookup as
  // terminal-notification-ingestion).
  const row = drizzle(db)
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(or(eq(sessions.id, sessionId), eq(sessions.runtimeSessionName, sessionId)))
    .get();
  if (!row) return;
  if (eventBus.getSessionWorkState(row.userId, row.id)?.state !== "working") return;
  eventBus.setSessionWorkState({ userId: row.userId, sessionId: row.id, state: "idle" });
}
