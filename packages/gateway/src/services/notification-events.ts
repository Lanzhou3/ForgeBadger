import { NotificationRepository, type CreateNotificationInput } from "../db/repositories/notification-repository.js";
import type { Database } from "../db/types.js";
import type {
  AppActionNotificationEvent,
  ClaudeNotificationEvent,
  ForgeBadgerEvent,
  ForgeBadgerEventBus
} from "./event-bus.js";
import { redactSensitiveContent } from "../lib/redaction.js";

type PersistableNotificationEvent = ClaudeNotificationEvent | AppActionNotificationEvent;

/** Only these CLI hook notification types become in-app notifications. */
const NOTIFIED_CLI_NOTIFICATION_TYPES = new Set([
  "permission_prompt",
  "permission_denied",
  "task_completed",
  "task_interrupted",
  "task_failed",
  "session_ended",
  "attention"
]);

export interface NotificationPersistenceOptions {
  db: Database;
  eventBus: ForgeBadgerEventBus;
}

export function attachNotificationPersistence(options: NotificationPersistenceOptions): void {
  options.eventBus.on("event", (event: ForgeBadgerEvent) => {
    const input = notificationInputFromEvent(event);
    if (!input) return;

    try {
      const notification = new NotificationRepository(options.db, event.userId).create(input);
      if (isPersistableNotificationEvent(event)) {
        event.notificationId = notification.id;
        event.notificationCreatedAt = notification.createdAt;
      }
    } catch {
      // Notification persistence must not break the terminal/event stream.
    }
  });
}

function isPersistableNotificationEvent(event: ForgeBadgerEvent): event is PersistableNotificationEvent {
  return event.type === "claude_notification" || event.type === "app_action_notification";
}

export function notificationInputFromEvent(event: ForgeBadgerEvent): CreateNotificationInput | undefined {
  switch (event.type) {
    case "claude_notification": {
      if (!NOTIFIED_CLI_NOTIFICATION_TYPES.has(event.notificationType)) {
        return undefined;
      }
      const adapter = event.adapter ?? "claude";
      const titleKey = notificationTitleKey(event.notificationType, adapter);
      const safe = redactSensitiveContent;
      const message = safe(event.toolName ? `${event.toolName}: ${event.message}` : event.message);
      return {
        type: event.type,
        titleKey,
        message,
        href: `/sessions/${encodeURIComponent(event.sessionId)}`,
        sessionId: event.sessionId,
        payload: {
          session_id: event.sessionId,
          ...(event.projectId ? { project_id: event.projectId } : {}),
          ...(event.projectName ? { project_name: safe(event.projectName) } : {}),
          ...(event.sessionName ? { session_name: safe(event.sessionName) } : {}),
          hook_event_name: safe(event.hookEventName),
          notification_type: safe(event.notificationType),
          message: safe(event.message),
          adapter,
          ...(event.title ? { title: safe(event.title) } : {}),
          ...(event.toolName ? { tool_name: safe(event.toolName) } : {})
        }
      };
    }
    case "app_action_notification":
      return {
        type: event.type,
        category: "app_action",
        titleKey: event.titleKey,
        message: redactSensitiveContent(event.message),
        href: "/models",
        payload: {
          action: event.action,
          status: event.status,
          message: redactSensitiveContent(event.message),
          ...(event.adapter ? { adapter: event.adapter } : {}),
          ...(event.providerId ? { provider_id: event.providerId } : {}),
          ...(event.providerName ? { provider_name: redactSensitiveContent(event.providerName) } : {})
        }
      };
    case "session_created":
    case "session_status_changed":
    case "session_deleted":
    case "activity_created":
    case "copilot_run_updated":
    case "error":
      return undefined;
  }
}

function notificationTitleKey(notificationType: string, adapter: string): string {
  if (notificationType === "permission_prompt") {
    if (adapter === "opencode") return "notifications.opencodePermissionRequest";
    if (adapter === "codex") return "notifications.codexPermissionRequest";
    if (adapter === "kimi") return "notifications.kimiPermissionRequest";
    if (adapter === "pi") return "notifications.piPermissionRequest";
    return "notifications.claudePermissionRequest";
  }
  if (notificationType === "permission_denied") {
    if (adapter === "opencode") return "notifications.opencodePermissionDenied";
    if (adapter === "codex") return "notifications.codexPermissionDenied";
    if (adapter === "kimi") return "notifications.kimiPermissionDenied";
    if (adapter === "pi") return "notifications.piPermissionDenied";
    return "notifications.claudePermissionDenied";
  }
  if (notificationType === "task_completed") return "notifications.taskCompleted";
  if (notificationType === "task_failed") return "notifications.taskFailed";
  if (notificationType === "session_ended") return "notifications.sessionEnded";
  return "notifications.taskInterrupted";
}
