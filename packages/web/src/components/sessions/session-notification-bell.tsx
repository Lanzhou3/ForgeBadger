"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";
import { notificationContextParts } from "@/lib/notifications";

const MAX_POPOVER_ITEMS = 8;

export function SessionNotificationBell() {
  const { t } = useLanguage();
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const recent = notifications.slice(0, MAX_POPOVER_ITEMS);
  const contextLabels = {
    project: t("notifications.projectContext"),
    session: t("notifications.sessionContext"),
    cli: t("notifications.cliContext"),
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8 text-muted-foreground hover:text-foreground"
          aria-label={t("notifications.title")}
          title={t("notifications.title")}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-semibold text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium">{t("notifications.title")}</span>
          {unreadCount > 0 && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => markAllRead()}
            >
              {t("notifications.markAllRead")}
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {recent.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("notifications.emptyTitle")}
            </p>
          ) : (
            recent.map((notification) => (
              <button
                key={notification.id}
                type="button"
                className="flex w-full flex-col gap-0.5 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                onClick={() => {
                  markRead(notification.id);
                  setOpen(false);
                  router.push(notification.href);
                }}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  {!notification.read && (
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  )}
                  {t(notification.titleKey)}
                </span>
                <span className="line-clamp-2 text-[11px] text-muted-foreground">
                  {notification.message}
                </span>
                {notificationContextParts(notification, contextLabels).length > 0 && (
                  <span className="truncate text-[10px] text-muted-foreground/75">
                    {notificationContextParts(notification, contextLabels).join(" · ")}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border px-3 py-2">
          <Link
            href="/notifications"
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            {t("notifications.viewAll")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
