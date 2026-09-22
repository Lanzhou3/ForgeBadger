"use client";

import { useLanguage } from "@/hooks/use-language";
import { normalizeSessionStatus } from "@/lib/session-status";
import { cn } from "@/lib/utils";

export function SessionStatusDot({ status }: { status: string }) {
  const normalized = normalizeSessionStatus(status);
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        normalized === "running"
          ? "animate-pulse bg-emerald-400"
          : normalized === "error"
            ? "bg-red-400"
            : "bg-muted-foreground/40"
      )}
    />
  );
}

export function SessionStatusText({ status }: { status: string }) {
  const { t } = useLanguage();
  const normalized = normalizeSessionStatus(status);
  return (
    <span
      className={cn(
        "shrink-0 text-xs",
        normalized === "running"
          ? "text-emerald-400"
          : normalized === "error"
            ? "text-red-400"
            : "text-muted-foreground"
      )}
    >
      {normalized === "running"
        ? t("sessions.running")
        : normalized === "error"
          ? t("sessions.error")
          : t("sessions.stopped")}
    </span>
  );
}
