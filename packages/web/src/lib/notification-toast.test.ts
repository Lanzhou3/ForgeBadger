import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredNotification } from "./notifications";

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

import { toast } from "sonner";
import { showNotificationToast, toastDurationFor } from "./notification-toast";

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

describe("notification toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("toastDurationFor", () => {
    it("uses a long duration for permission prompts", () => {
      expect(toastDurationFor("permission_prompt")).toBe(12000);
    });

    it("uses the default duration for other notification types", () => {
      expect(toastDurationFor("adapter_terminated")).toBe(5000);
    });

    it("uses the default duration when no notification type is present", () => {
      expect(toastDurationFor(undefined)).toBe(5000);
    });
  });

  describe("showNotificationToast", () => {
    it("renders a sonner toast with the notification id, description, duration and open action", () => {
      const onOpen = vi.fn();

      showNotificationToast(
        "Title",
        notification(),
        {
          type: "claude_notification",
          payload: { notification_type: "permission_prompt" },
        },
        { onOpen, openLabel: "Open" }
      );

      expect(toast).toHaveBeenCalledWith("Title", {
        description: "Bash: Claude needs permission",
        duration: 12000,
        id: "notification-1",
        action: { label: "Open", onClick: onOpen },
      });
    });

    it("uses the default duration for non-permission notifications", () => {
      const onOpen = vi.fn();

      showNotificationToast(
        "Title",
        notification({ id: "notification-2" }),
        {
          type: "session_status_changed",
          payload: { new_status: "completed" },
        },
        { onOpen, openLabel: "Open" }
      );

      expect(toast).toHaveBeenCalledWith("Title", {
        description: "Bash: Claude needs permission",
        duration: 5000,
        id: "notification-2",
        action: { label: "Open", onClick: onOpen },
      });
    });
  });
});
