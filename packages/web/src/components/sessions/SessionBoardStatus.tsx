"use client";

import { useLanguage } from "@/hooks/use-language";
import { normalizeSessionStatus } from "@/lib/session-status";
import { cn } from "@/lib/utils";

export function SessionStatusDot({ status }: { status: string }) {
  const normalized = normalizeSessionStatus(status);
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        normalized === "running"
          ? "motion-safe:animate-pulse bg-success"
          : normalized === "error"
            ? "bg-destructive"
            : normalized === "lost"
              ? "bg-warning"
              : "bg-muted-foreground/40"
      )}
    />
  );
}

export function SessionStatusText({ status }: { status: string }) {
  const { t } = useLanguage();
  const normalized = normalizeSessionStatus(status);
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {normalized === "running"
        ? t("sessions.running")
        : normalized === "error"
          ? t("sessions.error")
          : normalized === "lost"
            ? t("sessions.lost")
            : t("sessions.stopped")}
    </span>
  );
}
