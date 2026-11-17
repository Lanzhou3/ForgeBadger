"use client";

import type { SessionWorkState } from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";
import { normalizeSessionStatus } from "@/lib/session-status";
import { cn } from "@/lib/utils";

export function SessionStatusDot({
  status,
  workState,
}: {
  status: string;
  workState?: SessionWorkState["state"];
}) {
  const normalized = normalizeSessionStatus(status);
  const working = normalized === "running" && workState === "working";
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        working
          ? "bg-brand ring-2 ring-brand/25 motion-safe:animate-pulse"
          : normalized === "running"
            ? "bg-success"
            : normalized === "error"
              ? "bg-destructive"
              : normalized === "lost"
                ? "bg-warning"
                : "bg-muted-foreground/40"
      )}
    />
  );
}

export function SessionStatusText({
  status,
  workState,
}: {
  status: string;
  workState?: SessionWorkState["state"];
}) {
  const { t } = useLanguage();
  const normalized = normalizeSessionStatus(status);
  if (normalized === "running") {
    const suffix =
      workState === "working"
        ? ` · ${t("sessions.workWorking")}`
        : workState === "idle"
          ? ` · ${t("sessions.workIdle")}`
          : "";
    return (
      <span className={cn("shrink-0 text-xs", workState === "working" ? "font-medium text-brand" : "text-success")}>
        {t("sessions.running")}
        {suffix}
      </span>
    );
  }
  if (normalized === "error") {
    return <span className="shrink-0 text-xs font-medium text-destructive">{t("sessions.error")}</span>;
  }
  if (normalized === "lost") {
    return <span className="shrink-0 text-xs font-medium text-warning">{t("sessions.lost")}</span>;
  }
  return <span className="shrink-0 text-xs text-muted-foreground/80">{t("sessions.stopped")}</span>;
}
