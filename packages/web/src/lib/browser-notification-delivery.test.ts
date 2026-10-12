import { afterEach, describe, expect, it, vi } from "vitest";
import { browserNotificationPreferenceKey, showBrowserNotification } from "./browser-notifications";
import { createNotificationFromEvent } from "./notifications";

afterEach(() => vi.unstubAllGlobals());

describe("terminal attention browser delivery", () => {
  for (const adapter of ["claude", "kimi"]) {
    it(`delivers ${adapter} attention only when unread, opted in, and permitted`, () => {
      const delivered = vi.fn();
      const BrowserNotification = Object.assign(function (title: string, options: NotificationOptions) {
        delivered(title, options);
      }, { permission: "granted" });
      let enabled = true;
      vi.stubGlobal("Notification", BrowserNotification);
      vi.stubGlobal("window", {
        Notification: BrowserNotification,
        localStorage: { getItem: (key: string) => key === browserNotificationPreferenceKey && enabled ? "true" : "false" },
      });
      const event = { type: "session_notification", payload: {
        session_id: "session-1", adapter, notification_type: "attention", message: "Needs attention",
      } };
      const notification = createNotificationFromEvent(event)!;

      showBrowserNotification("Needs attention", notification, event);
      expect(delivered).toHaveBeenCalledWith("Needs attention", { body: "Needs attention", tag: notification.id });
      delivered.mockClear();
      showBrowserNotification("Needs attention", { ...notification, read: true }, event);
      enabled = false;
      showBrowserNotification("Needs attention", notification, event);
      enabled = true;
      BrowserNotification.permission = "denied";
      showBrowserNotification("Needs attention", notification, event);
      expect(delivered).not.toHaveBeenCalled();
    });
  }
});
