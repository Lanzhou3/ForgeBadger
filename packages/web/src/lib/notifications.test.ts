import { describe, expect, it } from "vitest";

import {
  createNotificationFromEvent,
  mergeNotifications,
  notificationContextParts,
  trimNotifications,
  type StoredNotification,
} from "./notifications";

describe("notifications", () => {
  it("creates a session status notification from a Gateway event", () => {
    const notification = createNotificationFromEvent(
      {
        type: "session_status_changed",
        payload: {
          session_id: "session-1",
          old_status: "starting",
          new_status: "running",
        },
      },
      "2026-04-30T12:00:00.000Z"
    );

    expect(notification).toMatchObject({
      id: "session_status_changed:session-1:running:2026-04-30T12:00:00.000Z",
      type: "session_status_changed",
      titleKey: "notifications.sessionStatusChanged",
      message: "session-1: starting -> running",
      href: "/sessions/session-1",
      read: false,
    });
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

  it("uses the generic CLI notification title for unclassified adapter notifications", () => {
    const notification = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-6",
        notification_type: "status",
        adapter: "opencode",
        message: "OpenCode is idle",
      },
    });

    expect(notification).toMatchObject({
      titleKey: "notifications.cliNotification",
    });
  });

  it("keeps project, session, adapter, and lifecycle type context", () => {
    const notification = createNotificationFromEvent({
      type: "claude_notification",
      payload: {
        session_id: "session-7",
        project_id: "project-7",
        project_name: "OpenForge",
        session_name: "Repair notifications",
        notification_type: "task_interrupted",
        adapter: "kimi",
        message: "Kimi Code task was interrupted",
      },
    });

    expect(notification).toMatchObject({
      titleKey: "notifications.taskInterrupted",
      projectId: "project-7",
      projectName: "OpenForge",
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
      "Project: OpenForge",
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
      titleKey: "notifications.sessionCreated" as const,
      message: String(index),
      createdAt: `2026-04-30T12:00:0${index}.000Z`,
      href: "/sessions",
      read: false,
    }));

    expect(trimNotifications(notifications, 3).map((item) => item.id)).toEqual(["4", "3", "2"]);
  });
});
