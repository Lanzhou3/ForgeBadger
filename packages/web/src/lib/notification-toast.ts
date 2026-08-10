import { toast } from "sonner";

import type { GatewayEvent, StoredNotification } from "./notifications";

const permissionPromptToastDuration = 12000;
const defaultToastDuration = 5000;

export function toastDurationFor(notificationType?: string): number {
  return notificationType === "permission_prompt"
    ? permissionPromptToastDuration
    : defaultToastDuration;
}

export function showNotificationToast(
  title: string,
  notification: StoredNotification,
  event: GatewayEvent,
  options: { onOpen: () => void; openLabel: string }
): void {
  toast(title, {
    description: notification.message,
    duration: toastDurationFor(getNotificationType(event)),
    id: notification.id,
    action: { label: options.openLabel, onClick: options.onOpen },
  });
}

function getNotificationType(event: GatewayEvent): string | undefined {
  const value = event.payload?.notification_type;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
