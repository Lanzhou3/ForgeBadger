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
  return event.type !== "activity_created";
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
      const titleKey =
        event.notificationType === "permission_prompt"
          ? "notifications.claudePermissionRequest"
          : "notifications.claudeNotification";
      const message = event.toolName ? `${event.toolName}: ${event.message}` : event.message;
      return {
        type: event.type,
        titleKey,
        message,
        href: `/sessions/${encodeURIComponent(event.sessionId)}`,
        sessionId: event.sessionId,
        payload: {
          session_id: event.sessionId,
          hook_event_name: event.hookEventName,
          notification_type: event.notificationType,
          message: event.message,
          ...(event.title ? { title: event.title } : {}),
          ...(event.toolName ? { tool_name: event.toolName } : {})
        }
      };
    }
    case "activity_created":
      return undefined;
    case "error":
      return undefined;
  }
}
