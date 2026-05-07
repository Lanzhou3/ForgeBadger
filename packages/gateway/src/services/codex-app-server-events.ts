import { recordActivity } from "./activity-events.js";
import type {
  CodexAppServerManager,
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
