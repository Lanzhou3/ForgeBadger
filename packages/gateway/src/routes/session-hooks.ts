import { Router } from "express";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import { projects, sessions } from "../db/schema.js";
import type { Database } from "../db/types.js";
import type { Session } from "../db/repositories/session-repository.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";
import { recordActivity } from "../services/activity-events.js";

const claudeHookEventSchema = z.object({
  hook_event_name: z.string().optional(),
  notification_type: z.string().optional(),
  message: z.string().optional(),
  /** Kimi Notification events carry the text as `body` (plus `title`). */
  body: z.string().optional(),
  title: z.string().optional(),
  tool_name: z.string().optional(),
  adapter: z.enum(["claude", "opencode", "codex", "kimi"]).optional(),
  reason: z.string().optional(),
  error: z.string().optional()
}).passthrough();

const wrappedClaudeNotificationSchema = z.object({
  sessionId: z.string().min(1),
  event: claudeHookEventSchema
});

interface ParsedClaudeHook {
  sessionId: string;
  event: z.infer<typeof claudeHookEventSchema>;
}

export interface ClaudeNotificationHookResult {
  status: number;
  body: {
    code: 0 | 1;
    data?: { accepted: true };
    message: string;
  };
}

export function createSessionHookRoutes(db: Database, eventBus: OpenForgeEventBus): Router {
  const router = Router();

  router.post("/claude-notification/:sessionId", (req, res) => {
    traceClaudeNotificationHook("received", {
      route: "/claude-notification/:sessionId",
      sessionIdFromPath: req.params.sessionId,
      sessionIdHeaderPresent: Boolean(req.header("x-openforge-session-id")),
      sessionTokenPresent: Boolean(req.header("x-openforge-session-token")),
      bodyKeys: getBodyKeys(req.body)
    });
    const result = handleClaudeNotificationHook(
      db,
      eventBus,
      req.body ?? {},
      req.header("x-openforge-session-token"),
      req.params.sessionId || req.header("x-openforge-session-id")
    );
    traceClaudeNotificationHook("result", {
      route: "/claude-notification/:sessionId",
      status: result.status,
      code: result.body.code,
      accepted: result.body.data?.accepted ?? false,
      message: result.body.message
    });
    res.status(result.status).json(result.body);
  });

  router.post("/claude-notification", (req, res) => {
    traceClaudeNotificationHook("received", {
      route: "/claude-notification",
      sessionIdHeaderPresent: Boolean(req.header("x-openforge-session-id")),
      sessionTokenPresent: Boolean(req.header("x-openforge-session-token")),
      bodyKeys: getBodyKeys(req.body)
    });
    const result = handleClaudeNotificationHook(
      db,
      eventBus,
      req.body ?? {},
      req.header("x-openforge-session-token"),
      req.header("x-openforge-session-id")
    );
    traceClaudeNotificationHook("result", {
      route: "/claude-notification",
      status: result.status,
      code: result.body.code,
      accepted: result.body.data?.accepted ?? false,
      message: result.body.message
    });
    res.status(result.status).json(result.body);
  });

  return router;
}

export function handleClaudeNotificationHook(
  db: Database,
  eventBus: OpenForgeEventBus,
  body: unknown,
  sessionToken: string | undefined,
  sessionIdHeader?: string | undefined
): ClaudeNotificationHookResult {
  const dbClient = drizzle(db);
  const parsed = parseClaudeHookBody(body, sessionIdHeader);
  if (!parsed) {
    traceClaudeNotificationHook("reject", {
      reason: "invalid_input",
      sessionIdHeaderPresent: Boolean(sessionIdHeader?.trim()),
      bodyKeys: getBodyKeys(body)
    });
    return { status: 400, body: { code: 1, message: "Invalid input" } };
  }

  if (!sessionToken) {
    traceClaudeNotificationHook("reject", {
      reason: "missing_session_token",
      sessionId: parsed.sessionId,
      hookEventName: parsed.event.hook_event_name ?? "Notification"
    });
    return { status: 401, body: { code: 1, message: "Missing session token" } };
  }

  const row = dbClient
    .select({ session: sessions, projectName: projects.name })
    .from(sessions)
    .leftJoin(projects, eq(sessions.projectId, projects.id))
    .where(eq(sessions.id, parsed.sessionId))
    .get() as { session: Session; projectName: string | null } | undefined;
  const session = row?.session;

  if (!session || !session.attachToken || session.attachToken !== sessionToken) {
    traceClaudeNotificationHook("reject", {
      reason: "invalid_session_token",
      sessionId: parsed.sessionId,
      hookEventName: parsed.event.hook_event_name ?? "Notification"
    });
    return { status: 401, body: { code: 1, message: "Invalid session token" } };
  }

  const hookEventName = parsed.event.hook_event_name ?? "Notification";
  const notificationType = normalizeNotificationType(
    hookEventName,
    parsed.event.notification_type,
    parsed.event.message
  );
  const toolName = parsed.event.tool_name ?? inferPermissionToolName(parsed.event.message);
  const message = notificationMessage(parsed.event, hookEventName, notificationType, toolName);
  const activityType = notificationType;

  const adapter = parsed.event.adapter;
  eventBus.emitEvent({
    type: "claude_notification",
    userId: session.userId,
    sessionId: session.id,
    projectId: session.projectId,
    ...(row?.projectName ? { projectName: row.projectName } : {}),
    sessionName: session.name,
    hookEventName,
    notificationType,
    message,
    adapter: adapter ?? "claude",
    ...(parsed.event.title ? { title: parsed.event.title } : {}),
    ...(toolName ? { toolName } : {})
  });
  recordActivity({
    db,
    eventBus,
    userId: session.userId,
    sessionId: session.id,
    projectId: session.projectId,
    type: activityType,
    status: activityStatus(notificationType),
    message,
    metadata: {
      hookEventName,
      notificationType,
      adapter: adapter ?? "claude",
      ...(toolName ? { toolName } : {})
    }
  });

  return { status: 200, body: { code: 0, data: { accepted: true }, message: "" } };
}

function parseClaudeHookBody(
  body: unknown,
  sessionIdHeader?: string | undefined
): ParsedClaudeHook | undefined {
  const wrapped = wrappedClaudeNotificationSchema.safeParse(body);
  if (wrapped.success) {
    return wrapped.data;
  }

  const sessionId = sessionIdHeader?.trim();
  if (!sessionId) {
    return undefined;
  }

  const raw = claudeHookEventSchema.safeParse(body);
  if (!raw.success) {
    return undefined;
  }
  return { sessionId, event: raw.data };
}

function normalizeNotificationType(
  hookEventName: string,
  notificationType?: string,
  message?: string
): string {
  if (notificationType && notificationType.trim()) {
    const explicit = notificationType.trim();
    if (explicit === "task.completed" || explicit === "session.idle") {
      return "task_completed";
    }
    return explicit;
  }
  if (hookEventName === "PermissionDenied") {
    return "permission_denied";
  }
  if (hookEventName === "PermissionRequest") {
    return "permission_prompt";
  }
  if (hookEventName === "Stop") {
    return "task_completed";
  }
  if (hookEventName === "Interrupt") {
    return "task_interrupted";
  }
  if (hookEventName === "StopFailure") {
    return "task_failed";
  }
  if (hookEventName === "SessionEnd") {
    return "session_ended";
  }
  if (hookEventName === "Notification" && isPermissionPromptMessage(message)) {
    return "permission_prompt";
  }
  return hookEventName;
}

function notificationMessage(
  event: z.infer<typeof claudeHookEventSchema>,
  hookEventName: string,
  notificationType: string,
  toolName?: string | undefined
): string {
  const explicitMessage = event.message?.trim() || event.body?.trim();
  if (explicitMessage) {
    return explicitMessage;
  }
  const adapter = typeof event.adapter === "string" ? event.adapter : "claude";
  const label = adapterLabel(adapter);
  if (hookEventName === "PermissionRequest" && toolName) {
    return `${label} needs permission to use ${toolName}`;
  }
  if (hookEventName === "PermissionDenied" && toolName) {
    return `${label} permission was denied for ${toolName}`;
  }
  if (notificationType === "task_completed") {
    // Do not persist the assistant's final response from Stop payloads. The
    // notification only needs lifecycle context, not transcript content.
    return `${label} task completed`;
  }
  if (hookEventName === "Interrupt") {
    return event.reason?.trim() || `${label} task was interrupted`;
  }
  if (hookEventName === "StopFailure") {
    return event.error?.trim() || event.reason?.trim() || `${label} task failed`;
  }
  if (hookEventName === "SessionEnd") {
    return `${label} session ended`;
  }
  return `${label} notification`;
}

function adapterLabel(adapter: string): string {
  if (adapter === "opencode") return "OpenCode";
  if (adapter === "codex") return "Codex";
  if (adapter === "kimi") return "Kimi Code";
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

function isPermissionPromptMessage(message?: string): boolean {
  return /permission\s+to\s+use/i.test(message ?? "");
}

function inferPermissionToolName(message?: string): string | undefined {
  const match = message?.match(/permission\s+to\s+use\s+([A-Za-z0-9_.:-]+)/i);
  return match?.[1];
}

function getBodyKeys(body: unknown): string[] {
  if (!isRecord(body)) {
    return [];
  }
  return Object.keys(body).slice(0, 20);
}

function traceClaudeNotificationHook(stage: string, details: Record<string, unknown>): void {
  if (process.env.OPENFORGE_DEBUG_SESSION_HOOKS?.trim() !== "1") {
    return;
  }

  process.stderr.write(
    `${JSON.stringify({
      level: "info",
      action: "session_hooks.claude_notification",
      stage,
      timestamp: new Date().toISOString(),
      ...details
    })}\n`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
