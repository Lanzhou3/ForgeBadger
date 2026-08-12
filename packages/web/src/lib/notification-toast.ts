import { createElement } from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { GatewayEvent, StoredNotification } from "./notifications";

const permissionPromptToastDuration = 12000;
const defaultToastDuration = 5000;

export type NotificationToastTone = "info" | "success" | "warning" | "error";

const toneIcons: Record<NotificationToastTone, LucideIcon> = {
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: ShieldAlertIcon,
  error: OctagonXIcon,
};

const toneIconClassNames: Record<NotificationToastTone, string> = {
  info: "size-4 text-brand",
  success: "size-4 text-emerald-400",
  warning: "size-4 text-amber-400",
  error: "size-4 text-red-400",
};

const toneAccentClassNames: Record<NotificationToastTone, string> = {
  info: "border-l-2 border-l-brand",
  success: "border-l-2 border-l-emerald-500",
  warning: "border-l-2 border-l-amber-400",
  error: "border-l-2 border-l-red-500",
};

export function toastDurationFor(notificationType?: string): number {
  return notificationType === "permission_prompt"
    ? permissionPromptToastDuration
    : defaultToastDuration;
}

/** Maps a gateway event to a visual tone so toasts are scannable at a glance. */
export function toastToneFor(
  notificationType: string | undefined,
  event: GatewayEvent
): NotificationToastTone {
  if (notificationType === "permission_prompt") return "warning";
  if (event.type === "error") return "error";
  if (event.type === "session_status_changed") {
    const newStatus = event.payload?.new_status;
    if (newStatus === "completed") return "success";
    if (newStatus === "error") return "error";
  }
  return "info";
}

export function showNotificationToast(
  title: string,
  notification: StoredNotification,
  event: GatewayEvent,
  options: { onOpen: () => void; openLabel: string; context?: string }
): void {
  const notificationType = getNotificationType(event);
  const tone = toastToneFor(notificationType, event);
  toast(title, {
    description: [options.context, notification.message].filter(Boolean).join(" · "),
    duration: toastDurationFor(notificationType),
    id: notification.id,
    icon: createElement(toneIcons[tone], {
      className: toneIconClassNames[tone],
      "aria-hidden": true,
    }),
    className: toneAccentClassNames[tone],
    action: { label: options.openLabel, onClick: options.onOpen },
  });
}

function getNotificationType(event: GatewayEvent): string | undefined {
  const value = event.payload?.notification_type;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
