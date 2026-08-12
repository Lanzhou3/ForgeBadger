import { describe, expect, it } from "vitest";

import {
  browserNotificationPreferenceKey,
  getBrowserNotificationPreference,
  setBrowserNotificationPreference,
  shouldTriggerBrowserNotification,
} from "./browser-notifications";
import type { StoredNotification } from "./notifications";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function notification(overrides: Partial<StoredNotification> = {}): StoredNotification {
  return {
    id: "notification-1",
    type: "claude_notification",
    titleKey: "notifications.claudePermissionRequest",
    message: "Bash: Claude needs permission",
    createdAt: "2026-05-02T00:00:00.000Z",
    href: "/sessions/session-1",
    read: false,
    ...overrides,
  };
}

describe("browser notifications", () => {
  it("stores the browser notification opt-in preference", () => {
    const storage = memoryStorage();

    expect(getBrowserNotificationPreference(storage)).toBe(false);
    setBrowserNotificationPreference(true, storage);
    expect(storage.getItem(browserNotificationPreferenceKey)).toBe("true");
    expect(getBrowserNotificationPreference(storage)).toBe(true);
    setBrowserNotificationPreference(false, storage);
    expect(getBrowserNotificationPreference(storage)).toBe(false);
  });

  it("triggers for unread Claude permission prompts", () => {
    expect(
      shouldTriggerBrowserNotification(
        {
          type: "claude_notification",
          payload: {
            session_id: "session-1",
            notification_type: "permission_prompt",
          },
        },
        notification()
      )
    ).toBe(true);
  });

  it("triggers for terminal completion and error status changes", () => {
    for (const status of ["stopped", "completed", "error"]) {
      expect(
        shouldTriggerBrowserNotification(
          {
            type: "session_status_changed",
            payload: {
              session_id: "session-1",
              new_status: status,
            },
          },
          notification({ type: "session_status_changed" })
        )
      ).toBe(true);
    }
  });

  it("triggers for unread CLI lifecycle notifications", () => {
    for (const notificationType of ["task_completed", "task_interrupted", "task_failed", "session_ended"]) {
      expect(
        shouldTriggerBrowserNotification(
          {
            type: "claude_notification",
            payload: { session_id: "session-1", notification_type: notificationType },
          },
          notification()
        )
      ).toBe(true);
    }
  });

  it("does not trigger for read notifications or routine running status", () => {
    expect(
      shouldTriggerBrowserNotification(
        {
          type: "claude_notification",
          payload: { session_id: "session-1", notification_type: "permission_prompt" },
        },
        notification({ read: true })
      )
    ).toBe(false);
    expect(
      shouldTriggerBrowserNotification(
        {
          type: "session_status_changed",
          payload: { session_id: "session-1", new_status: "running" },
        },
        notification({ type: "session_status_changed" })
      )
    ).toBe(false);
  });
});
