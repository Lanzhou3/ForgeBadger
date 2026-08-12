import { NotificationRepository, type CreateNotificationInput } from "../db/repositories/notification-repository.js";
import type { Database } from "../db/types.js";
import type {
  ClaudeNotificationEvent,
  ErrorEvent,
  OpenForgeEvent,
  OpenForgeEventBus,
  SessionCreatedEvent,
  SessionDeletedEvent,
  SessionStatusChangedEvent
} from "./event-bus.js";

type PersistableNotificationEvent =
  | SessionCreatedEvent
  | SessionStatusChangedEvent
  | SessionDeletedEvent
  | ClaudeNotificationEvent
  | ErrorEvent;

export interface NotificationPersistenceOptions {
  db: Database;
  eventBus: OpenForgeEventBus;
}

export function attachNotificationPersistence(options: NotificationPersistenceOptions): void {
  options.eventBus.on("event", (event: OpenForgeEvent) => {
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

function isPersistableNotificationEvent(event: OpenForgeEvent): event is PersistableNotificationEvent {
  return (
    event.type === "session_created" ||
    event.type === "session_status_changed" ||
    event.type === "session_deleted" ||
    event.type === "claude_notification" ||
    event.type === "error"
  );
}

export function notificationInputFromEvent(event: OpenForgeEvent): CreateNotificationInput | undefined {
  switch (event.type) {
    case "session_created":
      return {
        type: event.type,
        titleKey: "notifications.sessionCreated",
        message: event.name,
        href: `/sessions/${encodeURIComponent(event.sessionId)}`,
        sessionId: event.sessionId,
        payload: {
          session_id: event.sessionId,
          project_id: event.projectId,
          name: event.name
        }
      };
    case "session_status_changed":
      return {
        type: event.type,
        titleKey: "notifications.sessionStatusChanged",
        message: `${event.sessionId}: ${event.oldStatus} -> ${event.newStatus}`,
        href: `/sessions/${encodeURIComponent(event.sessionId)}`,
        sessionId: event.sessionId,
        payload: {
          session_id: event.sessionId,
          old_status: event.oldStatus,
          new_status: event.newStatus
        }
      };
    case "session_deleted":
      return {
        type: event.type,
        titleKey: "notifications.sessionDeleted",
        message: event.sessionId,
        href: `/sessions/${encodeURIComponent(event.sessionId)}`,
        sessionId: event.sessionId,
        payload: {
          session_id: event.sessionId
        }
      };
    case "claude_notification": {
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
    case "activity_created":
      return undefined;
    case "copilot_run_updated":
      return undefined;
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
  if (notificationType === "task_interrupted") return "notifications.taskInterrupted";
  if (notificationType === "task_failed") return "notifications.taskFailed";
  if (notificationType === "session_ended") return "notifications.sessionEnded";
  return "notifications.cliNotification";
}
