import { NotificationRepository, type CreateNotificationInput } from "../db/repositories/notification-repository.js";
import type { Database } from "../db/types.js";
import type {
  ClaudeNotificationEvent,
  ForgeBadgerEvent,
  ForgeBadgerEventBus
} from "./event-bus.js";

type PersistableNotificationEvent = ClaudeNotificationEvent;

/** Only these CLI hook notification types become in-app notifications. */
const NOTIFIED_CLI_NOTIFICATION_TYPES = new Set([
  "permission_prompt",
  "task_completed",
  "task_interrupted"
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
  return event.type === "claude_notification";
}

export function notificationInputFromEvent(event: ForgeBadgerEvent): CreateNotificationInput | undefined {
  switch (event.type) {
    case "claude_notification": {
      if (!NOTIFIED_CLI_NOTIFICATION_TYPES.has(event.notificationType)) {
        return undefined;
      }
      const adapter = event.adapter ?? "claude";
      const titleKey = notificationTitleKey(event.notificationType, adapter);
      const message = event.toolName ? `${event.toolName}: ${event.message}` : event.message;
      return {
        type: event.type,
        titleKey,
        message,
        href: `/sessions/${encodeURIComponent(event.sessionId)}`,
        sessionId: event.sessionId,
        payload: {
          session_id: event.sessionId,
          ...(event.projectId ? { project_id: event.projectId } : {}),
          ...(event.projectName ? { project_name: event.projectName } : {}),
          ...(event.sessionName ? { session_name: event.sessionName } : {}),
          hook_event_name: event.hookEventName,
          notification_type: event.notificationType,
          message: event.message,
          adapter,
          ...(event.title ? { title: event.title } : {}),
          ...(event.toolName ? { tool_name: event.toolName } : {})
        }
      };
    }
    case "session_created":
    case "session_status_changed":
    case "session_deleted":
    case "activity_created":
    case "error":
      return undefined;
  }
}

function notificationTitleKey(notificationType: string, adapter: string): string {
  if (notificationType === "permission_prompt") {
    if (adapter === "opencode") return "notifications.opencodePermissionRequest";
    if (adapter === "codex") return "notifications.codexPermissionRequest";
    if (adapter === "kimi") return "notifications.kimiPermissionRequest";
    return "notifications.claudePermissionRequest";
  }
  if (notificationType === "task_completed") return "notifications.taskCompleted";
  return "notifications.taskInterrupted";
}
