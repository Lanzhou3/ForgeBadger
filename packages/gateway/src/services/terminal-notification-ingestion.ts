/**
 * Terminal-native notification ingestion.
 *
 * Consumes notifications observed on PTY output by the Session Server
 * (OSC 9, OSC 99, OSC 777, bell — see terminal-notification-scanner.ts) and
 * turns them into the same `claude_notification` event + activity row the
 * CLI hook route produces, so the web UI toasts uniformly regardless of
 * channel.
 *
 * Only known user-facing prompt formats are actionable. Bells and arbitrary
 * completion prose lack event/agent identity and are not promoted to alerts.
 * Structured hooks supply main-session lifecycle notifications.
 */
import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { redactSensitiveContent } from "../lib/redaction.js";

import { projects, sessions } from "../db/schema.js";
import type { Database } from "../db/types.js";
import type { Session } from "../db/repositories/session-repository.js";
import type { ForgeBadgerEventBus } from "./event-bus.js";
import { recordActivity } from "./activity-events.js";
import type { TerminalNotification } from "./session-server/terminal-notification-scanner.js";
import { isOsc9AuxiliaryPayload } from "./session-server/terminal-notification-scanner.js";
import {
  defaultNotificationDeduper,
  type NotificationDeduper
} from "./notification-dedupe.js";

export type IngestTerminalNotificationResult =
  | { handled: true }
  | { handled: false; reason: "unknown_session" | "deduped" | "unsupported" };

/**
 * MiniMax Code notifier bodies, verbatim from the `H7` map in the shipped
 * launcher bundle (@minimax-ai/code 0.5.8). Matched exactly — a paraphrase by
 * a CLI update must degrade to "no notification", never to a wrong event type.
 */
const MCODE_PERMISSION_BODY = "Permission needs your input";
const MCODE_TURN_COMPLETE_BODY = "Response complete";
const MCODE_TURN_FAILED_BODY = "Response stopped with an error";

export interface IngestTerminalNotificationOptions {
  db: Database;
  eventBus: ForgeBadgerEventBus;
  sessionId: string;
  notification: TerminalNotification;
  deduper?: NotificationDeduper;
  now?: () => number;
}

export function ingestTerminalNotification(
  options: IngestTerminalNotificationOptions
): IngestTerminalNotificationResult {
  const { db, eventBus, sessionId, notification } = options;
  const deduper = options.deduper ?? defaultNotificationDeduper;
  const nowMs = options.now ? options.now() : Date.now();

  const dbClient = drizzle(db);
  // The daemon only knows the runtime session name (fb-{user8}-{sessionId});
  // match it against runtime_session_name first and fall back to the raw id.
  const row = dbClient
    .select({ session: sessions, projectName: projects.name })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      or(
        eq(sessions.id, sessionId),
        eq(sessions.runtimeSessionName, sessionId)
      )
    )
    .get() as { session: Session; projectName: string | null } | undefined;
  const session = row?.session;
  if (!session) {
    // Unknown sessions are dropped silently — the daemon may outlive a
    // session row during teardown, and this path must stay cheap.
    return { handled: false, reason: "unknown_session" };
  }

  const mapped = mapTerminalNotification(session.aiTool, notification);
  if (!mapped) {
    return { handled: false, reason: "unsupported" };
  }

  if (deduper.shouldDrop(session.id, mapped.type, "terminal", nowMs)) {
    return { handled: false, reason: "deduped" };
  }

  const projectName = row?.projectName ? redactSensitiveContent(row.projectName) : undefined;
  const message = redactSensitiveContent(mapped.message);
  const title = mapped.title ? redactSensitiveContent(mapped.title) : undefined;
  eventBus.emitEvent({
    type: "claude_notification",
    userId: session.userId,
    sessionId: session.id,
    projectId: session.projectId,
    ...(projectName ? { projectName } : {}),
    sessionName: redactSensitiveContent(session.name),
    hookEventName: "Notification",
    notificationType: mapped.type,
    message,
    adapter: session.aiTool,
    ...(title ? { title } : {})
  });
  recordActivity({
    db,
    eventBus,
    userId: session.userId,
    sessionId: session.id,
    projectId: session.projectId,
    type: mapped.type,
    status: activityStatus(mapped.type),
    message,
    metadata: {
      hookEventName: "Notification",
      notificationType: mapped.type,
      adapter: session.aiTool
    }
  });

  deduper.record(session.id, mapped.type, "terminal", nowMs);
  return { handled: true };
}

interface MappedTerminalNotification {
  type: string;
  message: string;
  title?: string;
}

function mapTerminalNotification(
  aiTool: string,
  notification: TerminalNotification
): MappedTerminalNotification | undefined {
  // BEL and arbitrary notification prose carry no event kind or agent identity.
  // Completion comes from structured root-session hooks, not text heuristics.
  if (notification.kind === "bell") return undefined;
  if (notification.code === 9 && isOsc9AuxiliaryPayload(notification.text)) return undefined;
  const text = notification.code === 777
    ? `${notification.title.trim()}: ${notification.body.trim()}` : notification.text.trim();
  if (aiTool === "codex" && /^(Approval requested(?::| by )|Codex wants to edit )/.test(text)) {
    return { type: "permission_prompt", message: text };
  }
  // OpenCode's TUI uses these fixed messages only for its pending input UI.
  if (aiTool === "opencode" && notification.code === 777
    && /^(Permission needs input|Question needs input)$/.test(notification.body.trim())) {
    return { type: "permission_prompt", message: text };
  }
  // MiniMax Code's notifier emits a fixed "MCode: <body>" OSC 9 (see `H7` in
  // the shipped launcher). The bodies are enumerated, so the mapping is exact
  // rather than a prose heuristic. `question-required` is deliberately not
  // promoted: it carries no ForgeBadger notification type today, and
  // mis-labelling it as a permission prompt would be wrong.
  if (aiTool === "mcode" && notification.code === 9) {
    const body = text.replace(/^MCode:\s*/u, "").trim();
    if (body === MCODE_PERMISSION_BODY) {
      return { type: "permission_prompt", message: text };
    }
    if (body === MCODE_TURN_COMPLETE_BODY) {
      return { type: "task_completed", message: text };
    }
    if (body === MCODE_TURN_FAILED_BODY) {
      return { type: "task_failed", message: text };
    }
  }
  return undefined;
}

function activityStatus(notificationType: string): "info" | "warning" | "error" {
  if (notificationType === "task_failed") return "error";
  if (
    notificationType === "permission_prompt" ||
    notificationType === "permission_denied" ||
    notificationType === "task_interrupted"
  ) {
    return "warning";
  }
  return "info";
}
