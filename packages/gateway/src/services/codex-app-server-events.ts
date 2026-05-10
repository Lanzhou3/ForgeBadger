import { recordActivity } from "./activity-events.js";
import type {
  CodexAppServerManager,
  CodexAppServerLifecycleEvent,
  CodexAppServerNotificationEvent
} from "./codex-app-server-manager.js";
import type { OpenForgeEventBus } from "./event-bus.js";
import type { Database } from "../db/types.js";

export interface AttachCodexAppServerNotificationPersistenceOptions {
  db: Database;
  manager: CodexAppServerManager;
  eventBus?: OpenForgeEventBus | undefined;
}

export function attachCodexAppServerNotificationPersistence(
  options: AttachCodexAppServerNotificationPersistenceOptions
): void {
  options.manager.on("lifecycle", (event: CodexAppServerLifecycleEvent) => {
    recordActivity({
      db: options.db,
      eventBus: options.eventBus,
      userId: event.userId,
      projectId: event.projectId,
      type: event.type,
      status: event.status,
      message: event.message,
      metadata: {
        appServerSessionId: event.appServerSessionId,
        runtimeMode: event.runtimeMode,
        listen: event.listen,
        ...(event.pid !== undefined ? { pid: event.pid } : {}),
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {})
      }
    });
  });

  options.manager.on("notification", (event: CodexAppServerNotificationEvent) => {
    recordActivity({
      db: options.db,
      eventBus: options.eventBus,
      userId: event.userId,
      projectId: event.projectId,
      type: "codex_app_server_notification",
      status: event.status,
      message: event.message,
      metadata: {
        appServerSessionId: event.appServerSessionId,
        ...(event.threadId ? { threadId: event.threadId } : {}),
        method: event.method,
        activityType: event.activityType
      }
    });
  });
}
