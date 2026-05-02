import { describe, expect, it } from "vitest";

import {
  createNotificationFromEvent,
  mergeNotifications,
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
