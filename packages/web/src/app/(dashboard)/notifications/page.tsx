"use client";

import Link from "next/link";
import { Bell, CheckCheck, Circle, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";
import type { StoredNotification } from "@/lib/notifications";

export default function NotificationsPage() {
  const { t } = useLanguage();
  const { notifications, unreadCount, markRead, markAllRead, clearNotifications } = useNotifications();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("notifications.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="size-4" />
            {t("notifications.markAllRead")}
          </Button>
          <Button
            variant="outline"
            className="text-destructive"
            onClick={clearNotifications}
            disabled={notifications.length === 0}
          >
            <Trash2 className="size-4" />
            {t("notifications.clearAll")}
          </Button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="size-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">{t("notifications.emptyTitle")}</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {t("notifications.emptyDescription")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("notifications.title")}</CardTitle>
            <Badge variant={unreadCount > 0 ? "destructive" : "secondary"}>
              {unreadCount} {t("notifications.unread")}
            </Badge>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                title={t(notification.titleKey)}
                openLabel={t("notifications.openSession")}
                onMarkRead={() => markRead(notification.id)}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  title,
  openLabel,
  onMarkRead,
}: {
  notification: StoredNotification;
  title: string;
  openLabel: string;
  onMarkRead: () => void;
}) {
  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {!notification.read && <Circle className="size-2 fill-current text-destructive" />}
          <span className="font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{formatCreatedAt(notification.createdAt)}</span>
        </div>
        <p className="mt-1 break-words text-sm text-muted-foreground">{notification.message}</p>
      </div>
      <div className="flex justify-end gap-2">
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
