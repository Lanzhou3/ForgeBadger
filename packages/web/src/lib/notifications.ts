import type { Language, TranslationKey } from "./i18n";

export type NotificationCategory = "session_event" | "app_action";

export type NotificationEventType =
  | "session_created"
  | "session_status_changed"
  | "session_deleted"
  | "claude_notification"
  | "app_action_notification";

export interface GatewayEvent {
  type?: string;
  payload?: Record<string, unknown>;
}

export interface StoredNotification {
  id: string;
  type: NotificationEventType;
  category: NotificationCategory;
  titleKey: TranslationKey;
  message: string;
  createdAt: string;
  href: string;
  read: boolean;
  projectId?: string;
  projectName?: string;
  sessionId?: string;
  sessionName?: string;
  adapter?: string;
  notificationType?: string;
  /** App action outcome; only present on app_action notifications. */
  status?: "success" | "error";
  /** App action identifier (e.g. "apply_provider", "model_sync"). */
  action?: string;
}

export interface NotificationContextLabels {
  project: string;
  session: string;
  cli: string;
}

/** Only these CLI hook notification types surface as in-app notifications. */
const NOTIFIED_CLI_NOTIFICATION_TYPES = new Set([
  "permission_prompt",
  "permission_denied",
  "task_completed",
  "task_interrupted",
  "task_failed",
  "session_ended",
]);

export function createNotificationFromEvent(
  event: GatewayEvent,
  now = new Date().toISOString()
): StoredNotification | null {
  if (event.type === "app_action_notification") {
    return createAppActionNotification(event, now);
  }
  if (event.type !== "claude_notification") {
    return null;
  }
  const notificationType = getString(event.payload, "notification_type");
  if (!notificationType || !NOTIFIED_CLI_NOTIFICATION_TYPES.has(notificationType)) {
    return null;
  }

  const sessionId = getString(event.payload, "session_id");
  if (!sessionId) {
    return null;
  }

  const message = formatNotificationMessage(event.payload ?? {});
  const serverId = getString(event.payload, "notification_id");
  const createdAt = getString(event.payload, "created_at") ?? now;
  const read = getBoolean(event.payload, "read") ?? false;
  const adapter = getString(event.payload, "adapter");
  const titleKey = cliNotificationTitleKey(notificationType, adapter);

  return {
    id: serverId ?? `${event.type}:${sessionId}:${notificationType}:${createdAt}`,
    type: event.type,
    category: "session_event",
    titleKey,
    message,
    createdAt,
    href: `/sessions/${encodeURIComponent(sessionId)}`,
    read,
    projectId: getString(event.payload, "project_id"),
    projectName: getString(event.payload, "project_name"),
    sessionId,
    sessionName: getString(event.payload, "session_name"),
    adapter,
    notificationType,
  };
}

function createAppActionNotification(
  event: GatewayEvent,
  now: string
): StoredNotification | null {
  const titleKey = getString(event.payload, "title_key");
  const message = getString(event.payload, "message");
  if (!titleKey || !message) {
    return null;
  }
  const serverId = getString(event.payload, "notification_id");
  const createdAt = getString(event.payload, "created_at") ?? now;
  const action = getString(event.payload, "action");
  const status = getAppActionStatus(event.payload);

  return {
    id: serverId ?? `${event.type}:${action ?? "unknown"}:${createdAt}`,
    type: "app_action_notification",
    category: "app_action",
    titleKey: titleKey as TranslationKey,
    message,
    createdAt,
    href: "/models",
    read: getBoolean(event.payload, "read") ?? false,
    adapter: getString(event.payload, "adapter"),
    action,
    status,
  };
}

function getAppActionStatus(
  payload: Record<string, unknown> | undefined
): "success" | "error" | undefined {
  const value = payload?.status;
  return value === "success" || value === "error" ? value : undefined;
}

export function notificationContextParts(
  notification: StoredNotification,
  labels?: NotificationContextLabels
): string[] {
  return [
    formatContextPart(labels?.project, notification.projectName),
    formatContextPart(labels?.session, notification.sessionName),
    formatContextPart(labels?.cli, adapterLabel(notification.adapter)),
  ].filter((value): value is string => Boolean(value));
}

export function mergeNotifications(
  current: StoredNotification[],
  incoming: StoredNotification,
  limit = 50
): StoredNotification[] {
  return trimNotifications(
    [incoming, ...current.filter((notification) => notification.id !== incoming.id)],
    limit
  );
}

export function trimNotifications(notifications: StoredNotification[], limit = 50): StoredNotification[] {
  return [...notifications]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** Returns the most recent unread notifications, newest first. */
export function latestUnread(
  notifications: readonly StoredNotification[],
  limit = 5
): StoredNotification[] {
  return notifications
    .filter((notification) => !notification.read)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

const RELATIVE_TIME_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

export function formatRelativeTime(
  value: string,
  language: Language,
  now: Date = new Date()
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  let duration = (date.getTime() - now.getTime()) / 1000;
  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatter.format(Math.round(duration), "year");
}

function formatNotificationMessage(payload: Record<string, unknown>): string {
  const message = getString(payload, "message") ?? "Code CLI notification";
  const toolName = getString(payload, "tool_name");
  return toolName ? `${toolName}: ${message}` : message;
}

function cliNotificationTitleKey(
  notificationType?: string,
  adapter?: string
): TranslationKey {
  if (notificationType === "permission_prompt") {
    if (adapter === "opencode") return "notifications.opencodePermissionRequest";
    if (adapter === "codex") return "notifications.codexPermissionRequest";
    if (adapter === "kimi") return "notifications.kimiPermissionRequest";
    return "notifications.claudePermissionRequest";
  }
  if (notificationType === "permission_denied") {
    if (adapter === "opencode") return "notifications.opencodePermissionDenied";
    if (adapter === "codex") return "notifications.codexPermissionDenied";
    if (adapter === "kimi") return "notifications.kimiPermissionDenied";
    return "notifications.claudePermissionDenied";
  }
  if (notificationType === "task_completed") return "notifications.taskCompleted";
  if (notificationType === "task_failed") return "notifications.taskFailed";
  if (notificationType === "session_ended") return "notifications.sessionEnded";
  return "notifications.taskInterrupted";
}

function adapterLabel(adapter?: string): string | undefined {
  if (adapter === "claude") return "Claude Code";
  if (adapter === "opencode") return "OpenCode";
  if (adapter === "codex") return "Codex";
  if (adapter === "kimi") return "Kimi Code";
  return adapter;
}

function formatContextPart(label: string | undefined, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return label ? `${label}: ${value}` : value;
}

function getString(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getBoolean(payload: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = payload?.[key];
  return typeof value === "boolean" ? value : undefined;
}
