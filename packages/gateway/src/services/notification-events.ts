import { type CreateNotificationInput } from "../db/repositories/notification-repository.js";
import { NotificationService } from './notification-service.js';
import type { Database } from "../db/types.js";
import type {
  AppActionNotificationEvent,
  SessionNotificationEvent,
  ForgeBadgerEvent,
  ForgeBadgerEventBus
} from "./event-bus.js";
import { redactAgentText } from './agent/redaction.js';
import { nativePromptIdentity, SessionNotificationPromptRepository } from '../db/repositories/session-notification-prompt-repository.js';

/**
 * Local shape of the web translation keys this service emits. The web owns the
 * catalogue; the gateway only builds the key string, so it is declared here
 * rather than imported to keep the dependency direction one-way.
 */
type TranslationKey = `notifications.${string}`;

/**
 * Adapters that have their own `notifications.<adapter>Permission*` titles in
 * the web catalogue. An adapter missing from this set falls back to the
 * adapter-neutral `notifications.cliPermission*` wording.
 */
const NOTIFICATION_TITLE_ADAPTERS: ReadonlySet<string> = new Set([
  "claude",
  "opencode",
  "codex",
  "kimi",
  "pi",
  "mcode"
]);

type PersistableNotificationEvent = SessionNotificationEvent | AppActionNotificationEvent;

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
      if (event.type === 'session_notification') {
        try {
          const native = nativePromptIdentity(event.nativeSessionId, event.nativeTurnId);
          const prompt = event.cliSummary?.identityQuality === 'exact_turn' ? event.cliSummary.request
            : native?.turnId && !event.cliSummary && !event.nativeSubagent
              ? new SessionNotificationPromptRepository(options.db, event.userId).find(event.sessionId, native) : undefined;
          if (prompt && input.payload && typeof input.payload === 'object') {
            input.payload = { ...input.payload, last_prompt: prompt };
          }
        } catch { /* Optional identity enrichment must not suppress lifecycle notifications. */ }
      }
      const notification = new NotificationService(options.db, event.userId).create(input);
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
  return event.type === "session_notification" || event.type === "app_action_notification";
}

export function notificationInputFromEvent(event: ForgeBadgerEvent): CreateNotificationInput | undefined {
  switch (event.type) {
    case "session_notification": {
      if (!NOTIFIED_CLI_NOTIFICATION_TYPES.has(event.notificationType)) {
        return undefined;
      }
      const adapter = event.adapter ?? "claude";
      const titleKey = notificationTitleKey(event.notificationType, adapter);
      const safe = redactAgentText;
      const message = safe(event.toolName ? `${event.toolName}: ${event.message}` : event.message);
      return {
        type: event.type,
        titleKey,
        message,
        href: `/sessions/${encodeURIComponent(event.sessionId)}`,
        sessionId: event.sessionId,
        payload: {
          session_id: event.sessionId,
          ...(event.nativeSessionId ? { native_session_id: event.nativeSessionId } : {}),
          ...(event.nativeTurnId ? { native_turn_id: event.nativeTurnId } : {}),
          ...(event.nativeSubagent ? { native_subagent: true } : {}),
          ...(event.projectId ? { project_id: event.projectId } : {}),
          ...(event.projectName ? { project_name: safe(event.projectName) } : {}),
          ...(event.sessionName ? { session_name: safe(event.sessionName) } : {}),
          hook_event_name: safe(event.hookEventName),
          notification_type: safe(event.notificationType),
          message: safe(event.message),
          adapter,
          ...(event.cliSummary ? { cli_summary: event.cliSummary } : {}),
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
        message: redactAgentText(event.message),
        href: "/models",
        payload: {
          action: event.action,
          status: event.status,
          message: redactAgentText(event.message),
          ...(event.adapter ? { adapter: event.adapter } : {}),
          ...(event.providerId ? { provider_id: event.providerId } : {}),
          ...(event.providerName ? { provider_name: redactAgentText(event.providerName) } : {})
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

function notificationTitleKey(notificationType: string, adapter: string | undefined): string {
  const prefix = adapter !== undefined && NOTIFICATION_TITLE_ADAPTERS.has(adapter) ? adapter : "cli";
  if (notificationType === "permission_prompt") return `notifications.${prefix}PermissionRequest` as TranslationKey;
  if (notificationType === "permission_denied") return `notifications.${prefix}PermissionDenied` as TranslationKey;
  if (notificationType === "task_completed") return "notifications.taskCompleted";
  if (notificationType === "task_failed") return "notifications.taskFailed";
  if (notificationType === "session_ended") return "notifications.sessionEnded";
  return "notifications.taskInterrupted";
}
