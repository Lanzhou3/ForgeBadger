"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { QueryState } from "@/components/ui/query-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";
import {
  formatRelativeTime,
  notificationContextParts,
  type NotificationCategory,
  type StoredNotification,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

type CategoryFilter = "all" | NotificationCategory;

// The notification API has no pagination parameters, so the page paginates
// the client-side list (the provider retains a bounded history beyond this
// page size so "load more" has something to reveal).
const NOTIFICATION_PAGE_SIZE = 50;

export default function NotificationsPage() {
  const { t } = useLanguage();
  const { notifications, unreadCount, markRead, markAllRead, clearNotifications, initialLoadError, reloadNotifications } = useNotifications();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(NOTIFICATION_PAGE_SIZE);

  const filteredNotifications =
    categoryFilter === "all"
      ? notifications
      : notifications.filter((notification) => notification.category === categoryFilter);
  const visibleNotifications = filteredNotifications.slice(0, visibleCount);
  const hasMore = filteredNotifications.length > visibleCount;

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
            variant="brand"
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
            onClick={() => setClearConfirmOpen(true)}
            disabled={notifications.length === 0}
          >
            <Trash2 className="size-4" />
            {t("notifications.clearAll")}
          </Button>
        </div>
      </div>

      <Tabs
        value={categoryFilter}
        onValueChange={(value) => {
          setCategoryFilter(value as CategoryFilter);
          // A narrower list may need fewer pages; reset so results reappear.
          setVisibleCount(NOTIFICATION_PAGE_SIZE);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">{t("notifications.tabAll")}</TabsTrigger>
          <TabsTrigger value="session_event">{t("notifications.tabSessionEvents")}</TabsTrigger>
          <TabsTrigger value="app_action">{t("notifications.tabAppActions")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {initialLoadError && notifications.length === 0 ? (
        <QueryState
          isLoading={false}
          isError
          isEmpty={false}
          onRetry={() => void reloadNotifications()}
          empty={null}
        />
      ) : filteredNotifications.length === 0 ? (
        <Card className="forgebadger-animate-in">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Bell className="size-5" />
            </div>
            <div>
              <div className="text-sm font-medium">
                {notifications.length === 0
                  ? t("notifications.emptyTitle")
                  : t("notifications.emptyFilteredTitle")}
              </div>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                {notifications.length === 0
                  ? t("notifications.emptyDescription")
                  : t("notifications.emptyFilteredDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
            {visibleNotifications.map((notification, index) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                index={index}
                title={t(notification.titleKey)}
                openLabel={
                  notification.category === "app_action"
                    ? t("notifications.viewDetails")
                    : t("notifications.openSession")
                }
                contextLabels={{
                  project: t("notifications.projectContext"),
                  session: t("notifications.sessionContext"),
                  cli: t("notifications.cliContext"),
                }}
                onMarkRead={() => markRead(notification.id)}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setVisibleCount((count) => count + NOTIFICATION_PAGE_SIZE)}
              >
                {t("notifications.loadMore")}
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("notifications.showingCount")
                  .replace("{shown}", String(visibleNotifications.length))
                  .replace("{total}", String(filteredNotifications.length))}
              </span>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={clearConfirmOpen}
        destructive
        title={t("notifications.clearConfirmTitle")}
        description={t("notifications.clearConfirmDescription")}
        confirmLabel={t("notifications.clearAll")}
        onOpenChange={setClearConfirmOpen}
        onConfirm={() => {
          setClearConfirmOpen(false);
          clearNotifications();
        }}
      />
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
  const { language } = useLanguage();
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
          {notification.category === "app_action" && notification.status && (
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                notification.status === "success" ? "bg-emerald-400" : "bg-red-400"
              )}
              aria-label={notification.status}
              title={notification.status}
            />
          )}
          <span className="text-sm font-medium">{title}</span>
          {notification.adapter && <CliBrandChip aiTool={notification.adapter} />}
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(notification.createdAt, language)}
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
