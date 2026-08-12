import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredNotification } from "./notifications";

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

import { toast } from "sonner";
import { showNotificationToast, toastDurationFor, toastToneFor } from "./notification-toast";

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

      expect(toast).toHaveBeenCalledWith(
        "Title",
        expect.objectContaining({
          description: "Bash: Claude needs permission",
          duration: 12000,
          id: "notification-1",
          className: "border-l-2 border-l-amber-400",
          action: { label: "Open", onClick: onOpen },
        })
      );
      const options = vi.mocked(toast).mock.calls[0]?.[1] as { icon?: unknown };
      expect(options.icon).toBeTruthy();
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

      expect(toast).toHaveBeenCalledWith(
        "Title",
        expect.objectContaining({
          description: "Bash: Claude needs permission",
          duration: 5000,
          id: "notification-2",
          className: "border-l-2 border-l-emerald-500",
          action: { label: "Open", onClick: onOpen },
        })
      );
    });
  });

  describe("toastToneFor", () => {
    it("maps permission prompts to warning", () => {
      expect(toastToneFor("permission_prompt", { type: "claude_notification" })).toBe("warning");
    });

    it("maps completed and errored sessions to success and error", () => {
      expect(
        toastToneFor(undefined, { type: "session_status_changed", payload: { new_status: "completed" } })
      ).toBe("success");
      expect(
        toastToneFor(undefined, { type: "session_status_changed", payload: { new_status: "error" } })
      ).toBe("error");
    });

    it("maps gateway error events to error and everything else to info", () => {
      expect(toastToneFor(undefined, { type: "error" })).toBe("error");
      expect(toastToneFor(undefined, { type: "session_created" })).toBe("info");
    });
  });
});
