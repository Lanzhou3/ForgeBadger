import { Router } from "express";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";

import { sessions } from "../db/schema.js";
import type { Database } from "../db/types.js";
import type { Session } from "../db/repositories/session-repository.js";
import type { OpenForgeEventBus } from "../services/event-bus.js";
import { recordActivity } from "../services/activity-events.js";

const claudeHookEventSchema = z.object({
  hook_event_name: z.string().optional(),
  notification_type: z.string().optional(),
  message: z.string().optional(),
  title: z.string().optional(),
  tool_name: z.string().optional()
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
    const result = handleClaudeNotificationHook(
      db,
      eventBus,
      req.body ?? {},
      req.header("x-openforge-session-token"),
      req.params.sessionId || req.header("x-openforge-session-id")
    );
    res.status(result.status).json(result.body);
  });

  router.post("/claude-notification", (req, res) => {
    const result = handleClaudeNotificationHook(
      db,
      eventBus,
      req.body ?? {},
      req.header("x-openforge-session-token"),
      req.header("x-openforge-session-id")
    );
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
    return { status: 400, body: { code: 1, message: "Invalid input" } };
  }

  if (!sessionToken) {
    return { status: 401, body: { code: 1, message: "Missing session token" } };
  }

  const session = dbClient
    .select()
    .from(sessions)
    .where(eq(sessions.id, parsed.sessionId))
    .get() as Session | undefined;

  if (!session || !session.attachToken || session.attachToken !== sessionToken) {
    return { status: 401, body: { code: 1, message: "Invalid session token" } };
  }

  const hookEventName = parsed.event.hook_event_name ?? "Notification";
  const notificationType = normalizeNotificationType(
    hookEventName,
    parsed.event.notification_type,
    parsed.event.message
  );
  const toolName = parsed.event.tool_name ?? inferPermissionToolName(parsed.event.message);
  const message = notificationMessage(parsed.event, hookEventName, toolName);
  const activityType = notificationType === "permission_denied"
    ? "permission_denied"
    : "permission_prompt";

  eventBus.emitEvent({
    type: "claude_notification",
    userId: session.userId,
    sessionId: session.id,
    hookEventName,
    notificationType,
    message,
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
    status: notificationType === "permission_prompt" || notificationType === "permission_denied"
      ? "warning"
      : "info",
    message,
    metadata: {
      hookEventName,
      notificationType,
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
    return notificationType.trim();
  }
  if (hookEventName === "PermissionDenied") {
    return "permission_denied";
  }
  if (hookEventName === "PermissionRequest") {
    return "permission_prompt";
  }
  if (hookEventName === "Notification" && isPermissionPromptMessage(message)) {
    return "permission_prompt";
  }
  return hookEventName;
}

function notificationMessage(
  event: z.infer<typeof claudeHookEventSchema>,
  hookEventName: string,
  toolName?: string | undefined
): string {
  if (event.message?.trim()) {
    return event.message.trim();
  }
  if (hookEventName === "PermissionRequest" && toolName) {
    return `Claude needs permission to use ${toolName}`;
  }
  if (hookEventName === "PermissionDenied" && toolName) {
    return `Claude permission was denied for ${toolName}`;
  }
  return "Claude Code notification";
}

function isPermissionPromptMessage(message?: string): boolean {
  return /permission\s+to\s+use/i.test(message ?? "");
}

function inferPermissionToolName(message?: string): string | undefined {
  const match = message?.match(/permission\s+to\s+use\s+([A-Za-z0-9_.:-]+)/i);
  return match?.[1];
}
