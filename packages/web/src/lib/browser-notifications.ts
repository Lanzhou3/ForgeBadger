import type { GatewayEvent, StoredNotification } from "./notifications";

export const browserNotificationPreferenceKey = "forgebadger.browserNotifications.enabled";

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export function getBrowserNotificationPreference(storage: Storage | undefined = getStorage()): boolean {
  return storage?.getItem(browserNotificationPreferenceKey) === "true";
}

export function setBrowserNotificationPreference(enabled: boolean, storage: Storage | undefined = getStorage()): void {
  if (!storage) return;
  storage.setItem(browserNotificationPreferenceKey, enabled ? "true" : "false");
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.requestPermission();
}

export function shouldTriggerBrowserNotification(
  event: GatewayEvent,
  notification: StoredNotification
): boolean {
  if (notification.read) {
    return false;
  }
  if (
    event.type === "claude_notification" &&
    [
      "permission_prompt",
      "permission_denied",
      "task_completed",
      "task_interrupted",
      "task_failed",
      "session_ended",
    ].includes(String(event.payload?.notification_type ?? ""))
  ) {
    return true;
  }
  if (event.type !== "session_status_changed") {
    return false;
  }
  return (
    event.payload?.new_status === "stopped" ||
    event.payload?.new_status === "completed" ||
    event.payload?.new_status === "error"
  );
}

export function showBrowserNotification(
  title: string,
  notification: StoredNotification,
  event: GatewayEvent
): void {
  if (!getBrowserNotificationPreference()) return;
  if (getBrowserNotificationPermission() !== "granted") return;
  if (!shouldTriggerBrowserNotification(event, notification)) return;

  try {
    new Notification(title, {
      body: notification.message,
      tag: notification.id,
    });
  } catch {
    // Some browsers expose Notification but still block construction in this context.
  }
}

function getStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}
