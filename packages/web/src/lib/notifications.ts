import type { TranslationKey } from "./i18n";

export type NotificationEventType =
  | "session_created"
  | "session_status_changed"
  | "session_deleted"
  | "claude_notification";

export interface GatewayEvent {
  type?: string;
  payload?: Record<string, unknown>;
}

export interface StoredNotification {
  id: string;
  type: NotificationEventType;
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
}

export interface NotificationContextLabels {
  project: string;
  session: string;
  cli: string;
}

/** Only these CLI hook notification types surface as in-app notifications. */
const NOTIFIED_CLI_NOTIFICATION_TYPES = new Set([
  "permission_prompt",
  "task_completed",
  "task_interrupted",
]);

export function createNotificationFromEvent(
  event: GatewayEvent,
  now = new Date().toISOString()
): StoredNotification | null {
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
  if (notificationType === "task_completed") return "notifications.taskCompleted";
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
