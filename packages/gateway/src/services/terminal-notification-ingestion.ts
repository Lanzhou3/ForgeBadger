/**
 * Terminal-native notification ingestion.
 *
 * Consumes notifications observed on PTY output by the Session Server
 * (OSC 9, OSC 99, OSC 777, bell — see terminal-notification-scanner.ts) and
 * turns them into the same `claude_notification` event + activity row the
 * CLI hook route produces, so the web UI toasts uniformly regardless of
 * channel.
 *
 * Mapping is intentionally heuristic (Phase 1); live per-CLI tuning is
 * Phase 2. Bells only mean "needs attention" for CLIs whose idle prompts
 * rely on BEL (Claude Code, Kimi Code) — for the rest the bell is ambient
 * terminal noise and the notification is dropped as "unsupported".
 */
import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

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

  const projectName = row?.projectName;
  eventBus.emitEvent({
    type: "claude_notification",
    userId: session.userId,
    sessionId: session.id,
    projectId: session.projectId,
    ...(projectName ? { projectName } : {}),
    sessionName: session.name,
    hookEventName: "Notification",
    notificationType: mapped.type,
    message: mapped.message,
    adapter: session.aiTool,
    ...(mapped.title ? { title: mapped.title } : {})
  });
  recordActivity({
    db,
    eventBus,
    userId: session.userId,
    sessionId: session.id,
    projectId: session.projectId,
    type: mapped.type,
    status: activityStatus(mapped.type),
    message: mapped.message,
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
  const label = adapterLabel(aiTool);
  switch (notification.kind) {
    case "bell":
      // BEL is ambient for CLIs that use explicit OSC notifications; only
      // Claude Code and Kimi Code signal idle prompts with a bare bell.
      if (aiTool !== "claude" && aiTool !== "kimi") return undefined;
      return { type: "attention", message: `${label} needs your attention` };
    case "osc":
      if (notification.code === 9) {
        // Defense in depth: the daemon scanner already drops auxiliary OSC 9
        // sub-commands (e.g. `9;4` progress bars); guard again in case a
        // future path bypasses it.
        if (isOsc9AuxiliaryPayload(notification.text)) {
          return undefined;
        }
        const text = notification.text.trim();
        return {
          type: "permission_prompt",
          message: text || `${label} needs your attention`
        };
      }
      if (notification.code === 99) {
        const { alert, title } = parseKittyOsc99Payload(notification.text);
        const haystack = `${title ?? ""} ${alert ?? ""}`.toLowerCase();
        let type = "permission_prompt";
        if (/(error|fail)/.test(haystack)) {
          type = "task_failed";
        } else if (/(complete|idle|done)/.test(haystack)) {
          type = "task_completed";
        }
        return { type, message: title ?? "OpenCode notification" };
      }
      // code 777 (iTerm2-style): scanner already filtered to verb "notify"
      // with both title and body present.
      const title = notification.title.trim();
      const body = notification.body.trim();
      return {
        type: "permission_prompt",
        message: title || body || label,
        ...(title ? { title } : {})
      };
  }
}

/**
 * Minimal kitty OSC 99 parameter parse (`A=...;T=...`, semicolon-separated).
 * Heuristic by design — only the A/T fields are needed for classification.
 */
function parseKittyOsc99Payload(payload: string): { alert?: string; title?: string } {
  const result: { alert?: string; title?: string } = {};
  for (const part of payload.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const value = part.slice(eqIndex + 1);
    switch (part.slice(0, eqIndex)) {
      case "A":
        result.alert = value;
        break;
      case "T":
        result.title = value;
        break;
    }
  }
  return result;
}

function adapterLabel(aiTool: string): string {
  if (aiTool === "opencode") return "OpenCode";
  if (aiTool === "codex") return "Codex";
  if (aiTool === "kimi") return "Kimi Code";
  if (aiTool === "pi") return "PI";
  return "Claude Code";
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
