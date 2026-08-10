"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";

export function SessionNotificationBell() {
  const { t } = useLanguage();
  const { unreadCount } = useNotifications();

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      aria-label={t("notifications.title")}
      title={t("notifications.title")}
    >
      <Link href="/notifications" className="relative">
        <Bell className="size-3 sm:mr-2" />
        <span className="hidden sm:inline">{t("notifications.title")}</span>
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="ml-1 h-4 min-w-4 justify-center px-1 text-[10px]"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </Link>
    </Button>
  );
}
