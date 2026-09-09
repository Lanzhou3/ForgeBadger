import { describe, expect, it } from "vitest";

import {
  createNotificationFromEvent,
  formatRelativeTime,
  latestUnread,
  mergeNotifications,
  notificationContextParts,
  trimNotifications,
  type StoredNotification,
} from "./notifications";

describe("notifications", () => {
  it("ignores session lifecycle events", () => {
    // Arrange / Act / Assert
    expect(
      createNotificationFromEvent({
        type: "session_status_changed",
        payload: { session_id: "session-1", old_status: "starting", new_status: "running" },
      })
    ).toBeNull();
    expect(
      createNotificationFromEvent({
        type: "session_created",
        payload: { session_id: "session-1", name: "Session 1" },
      })
    ).toBeNull();
  });

  it("creates a Claude Code permission notification from a hook event", () => {
    const notification = createNotificationFromEvent(
      {
        type: "claude_notification",
        payload: {
          session_id: "session-2",
          notification_id: "notification-2",
          created_at: "2026-04-30T12:00:59.000Z",
          notification_type: "permission_prompt",
          message: "Claude needs your permission to use Bash",
          tool_name: "Bash",
          read: true,
        },
      },
      "2026-04-30T12:01:00.000Z"
    );

    expect(notification).toMatchObject({
      id: "notification-2",
      type: "claude_notification",
      titleKey: "notifications.claudePermissionRequest",
      message: "Bash: Claude needs your permission to use Bash",
      createdAt: "2026-04-30T12:00:59.000Z",
      href: "/sessions/session-2",
      read: true,
    });
  });

  it("uses the OpenCode title for an OpenCode permission notification", () => {
    const notification = createNotificationFromEvent(
      {
        type: "claude_notification",
        payload: {
          session_id: "session-3",
          notification_id: "notification-3",
          notification_type: "permission_prompt",
          adapter: "opencode",
          message: "OpenCode needs your permission to edit a file",
          tool_name: "Edit",
        },
      },
      "2026-04-30T12:02:00.000Z"
    );

    expect(notification).toMatchObject({
      titleKey: "notifications.opencodePermissionRequest",
      message: "Edit: OpenCode needs your permission to edit a file",
    });
  });

  it("falls back to the Claude title when adapter is claude or missing", () => {
    const withClaude = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-4",
        notification_type: "permission_prompt",
        adapter: "claude",
        message: "Claude needs permission",
      },
    });
    const withMissingAdapter = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-5",
        notification_type: "permission_prompt",
        message: "Claude needs permission",
      },
    });

    expect(withClaude).toMatchObject({
      titleKey: "notifications.claudePermissionRequest",
    });
    expect(withMissingAdapter).toMatchObject({
      titleKey: "notifications.claudePermissionRequest",
    });
  });

  it("ignores CLI notifications outside the allowlist", () => {
    // Arrange / Act / Assert
    for (const notificationType of ["status", "notification"]) {
      expect(
        createNotificationFromEvent({
          type: "claude_notification",
          payload: {
            session_id: "session-6",
            notification_type: notificationType,
            adapter: "opencode",
            message: "filtered out",
          },
        })
      ).toBeNull();
    }
  });

  it("creates a permission denied notification with a per-adapter title", () => {
    const kimiDenied = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-9",
        notification_type: "permission_denied",
        adapter: "kimi",
        message: "Kimi Code was denied permission to run Bash",
      },
    });
    const defaultDenied = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-10",
        notification_type: "permission_denied",
        message: "Permission denied",
      },
    });

    expect(kimiDenied).toMatchObject({
      type: "claude_notification",
      category: "session_event",
      titleKey: "notifications.kimiPermissionDenied",
      notificationType: "permission_denied",
      href: "/sessions/session-9",
    });
    expect(defaultDenied).toMatchObject({
      titleKey: "notifications.claudePermissionDenied",
    });
  });

  it("creates task failed and session ended notifications", () => {
    const failed = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-11",
        notification_type: "task_failed",
        adapter: "codex",
        message: "Codex task failed",
      },
    });
    const ended = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-12",
        notification_type: "session_ended",
        adapter: "claude",
        message: "Session ended",
      },
    });

    expect(failed).toMatchObject({
      titleKey: "notifications.taskFailed",
      notificationType: "task_failed",
    });
    expect(ended).toMatchObject({
      titleKey: "notifications.sessionEnded",
      notificationType: "session_ended",
    });
  });

  it("creates an app action notification from an app_action_notification frame", () => {
    const notification = createNotificationFromEvent(
      {
        type: "app_action_notification",
        payload: {
          action: "apply_provider",
          status: "success",
          title_key: "notifications.applyProviderSucceeded",
          message: "Provider Moonshot applied to claude",
          adapter: "claude",
          provider_id: "provider-1",
          provider_name: "Moonshot",
          notification_id: "notification-app-1",
          created_at: "2026-05-01T08:00:00.000Z",
          read: false,
        },
      },
      "2026-05-01T08:00:01.000Z"
    );

    expect(notification).toMatchObject({
      id: "notification-app-1",
      type: "app_action_notification",
      category: "app_action",
      titleKey: "notifications.applyProviderSucceeded",
      message: "Provider Moonshot applied to claude",
      createdAt: "2026-05-01T08:00:00.000Z",
      href: "/models",
      read: false,
      adapter: "claude",
      action: "apply_provider",
      status: "success",
    });
    expect(notification?.sessionId).toBeUndefined();
  });

  it("rejects app action frames without a title key or message", () => {
    expect(
      createNotificationFromEvent({
        type: "app_action_notification",
        payload: { action: "model_sync", status: "error", message: "sync failed" },
      })
    ).toBeNull();
    expect(
      createNotificationFromEvent({
        type: "app_action_notification",
        payload: { action: "model_sync", status: "error", title_key: "notifications.modelSyncFailed" },
      })
    ).toBeNull();
  });

  it("ignores unknown app action status values", () => {
    const notification = createNotificationFromEvent({
      type: "app_action_notification",
      payload: {
        action: "model_sync",
        status: "pending",
        title_key: "notifications.modelSyncSucceeded",
        message: "synced",
      },
    });

    expect(notification).toMatchObject({ action: "model_sync" });
    expect(notification?.status).toBeUndefined();
  });

  it("creates a task completion notification", () => {
    // Arrange / Act
    const notification = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-8",
        notification_type: "task_completed",
        adapter: "codex",
        message: "Codex finished the task",
      },
    });

    // Assert
    expect(notification).toMatchObject({
      titleKey: "notifications.taskCompleted",
      notificationType: "task_completed",
      adapter: "codex",
    });
  });

  it("keeps project, session, adapter, and lifecycle type context", () => {
    const notification = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-7",
        project_id: "project-7",
        project_name: "ForgeBadger",
        session_name: "Repair notifications",
        notification_type: "task_interrupted",
        adapter: "kimi",
        message: "Kimi Code task was interrupted",
      },
    });

    expect(notification).toMatchObject({
      titleKey: "notifications.taskInterrupted",
      projectId: "project-7",
      projectName: "ForgeBadger",
      sessionId: "session-7",
      sessionName: "Repair notifications",
      adapter: "kimi",
      notificationType: "task_interrupted",
    });
    expect(notificationContextParts(notification!, {
      project: "Project",
      session: "Session",
      cli: "CLI",
    })).toEqual([
      "Project: ForgeBadger",
      "Session: Repair notifications",
      "CLI: Kimi Code",
    ]);
  });

  it("ignores malformed Gateway events", () => {
    expect(createNotificationFromEvent({ type: "unknown", payload: {} })).toBeNull();
    expect(createNotificationFromEvent({ type: "session_deleted", payload: {} })).toBeNull();
  });

  it("merges newest notifications first and de-duplicates ids", () => {
    const existing: StoredNotification[] = [
      {
        id: "same",
        type: "session_created",
        category: "session_event",
        titleKey: "notifications.sessionCreated",
        message: "old",
        createdAt: "2026-04-30T11:00:00.000Z",
        href: "/sessions/a",
        read: true,
      },
    ];
    const incoming: StoredNotification = {
      id: "same",
      type: "session_created",
      category: "session_event",
      titleKey: "notifications.sessionCreated",
      message: "new",
      createdAt: "2026-04-30T12:00:00.000Z",
      href: "/sessions/a",
      read: false,
    };

    expect(mergeNotifications(existing, incoming)[0]).toEqual(incoming);
  });

  it("trims notification history to the configured limit", () => {
    const notifications = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      type: "session_created" as const,
      category: "session_event" as const,
      titleKey: "notifications.sessionCreated" as const,
      message: String(index),
      createdAt: `2026-04-30T12:00:0${index}.000Z`,
      href: "/sessions",
      read: false,
    }));

    expect(trimNotifications(notifications, 3).map((item) => item.id)).toEqual(["4", "3", "2"]);
  });

  it("latestUnread returns only unread notifications, newest first, capped", () => {
    const notifications = Array.from({ length: 8 }, (_, index) => ({
      id: String(index),
      type: "session_created" as const,
      category: "session_event" as const,
      titleKey: "notifications.sessionCreated" as const,
      message: String(index),
      createdAt: `2026-04-30T12:00:0${index}.000Z`,
      href: "/sessions",
      read: index % 2 === 0,
    }));

    expect(latestUnread(notifications).map((item) => item.id)).toEqual(["7", "5", "3", "1"]);
    expect(latestUnread(notifications, 2).map((item) => item.id)).toEqual(["7", "5"]);
    expect(latestUnread([])).toEqual([]);
  });

  it("formatRelativeTime renders relative time in the active language", () => {
    const now = new Date("2026-04-30T12:00:00.000Z");

    expect(formatRelativeTime("2026-04-30T11:55:00.000Z", "en", now)).toBe("5 minutes ago");
    expect(formatRelativeTime("2026-04-30T11:55:00.000Z", "zh-CN", now)).toBe("5分钟前");
    expect(formatRelativeTime("2026-04-30T11:00:00.000Z", "en", now)).toBe("1 hour ago");
    expect(formatRelativeTime("2026-04-30T12:00:00.000Z", "en", now)).toBe("now");
    expect(formatRelativeTime("not-a-date", "en", now)).toBe("not-a-date");
  });
});
