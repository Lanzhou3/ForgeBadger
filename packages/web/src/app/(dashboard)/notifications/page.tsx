"use client";

import Link from "next/link";
import { Bell, CheckCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";
import { notificationContextParts, type StoredNotification } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const { t } = useLanguage();
  const { notifications, unreadCount, markRead, markAllRead, clearNotifications } = useNotifications();

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t("notifications.title")}</h1>
            {notifications.length > 0 && (
              <Badge variant={unreadCount > 0 ? "destructive" : "secondary"} className="rounded-full">
                {unreadCount} {t("notifications.unread")}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("notifications.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="size-4" />
            {t("notifications.markAllRead")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={clearNotifications}
            disabled={notifications.length === 0}
          >
            <Trash2 className="size-4" />
            {t("notifications.clearAll")}
          </Button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <Card className="forgebadger-animate-in">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Bell className="size-5" />
            </div>
            <div>
              <div className="text-sm font-medium">{t("notifications.emptyTitle")}</div>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                {t("notifications.emptyDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {notifications.map((notification, index) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              index={index}
              title={t(notification.titleKey)}
              openLabel={t("notifications.openSession")}
              contextLabels={{
                project: t("notifications.projectContext"),
                session: t("notifications.sessionContext"),
                cli: t("notifications.cliContext"),
              }}
              onMarkRead={() => markRead(notification.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  index,
  title,
  openLabel,
  contextLabels,
  onMarkRead,
}: {
  notification: StoredNotification;
  index: number;
  title: string;
  openLabel: string;
  contextLabels: { project: string; session: string; cli: string };
  onMarkRead: () => void;
}) {
  const contextParts = notificationContextParts(notification, contextLabels).filter(
    (part) => !part.startsWith(`${contextLabels.cli}:`)
  );

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 transition-colors forgebadger-animate-in hover:bg-muted/40"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span
        className={cn(
          "mt-2 size-1.5 shrink-0 rounded-full",
          notification.read ? "bg-transparent" : "bg-brand"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {notification.adapter && <CliBrandChip aiTool={notification.adapter} />}
          <span className="text-xs text-muted-foreground">
            {formatCreatedAt(notification.createdAt)}
          </span>
        </div>
        <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
          {notification.message}
        </p>
        {contextParts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {contextParts.map((part) => (
              <Badge key={part} variant="outline" className="rounded font-normal">
                {part}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!notification.read && (
          <Button variant="ghost" size="sm" onClick={onMarkRead}>
            <CheckCheck className="size-4" />
          </Button>
        )}
        <Link href={notification.href} onClick={onMarkRead}>
          <Button variant="outline" size="sm">
            {openLabel}
          </Button>
        </Link>
      </div>
    </div>
  );
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
