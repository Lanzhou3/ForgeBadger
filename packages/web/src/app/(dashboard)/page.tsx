"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Circle,
  FolderOpen,
  Plus,
  TerminalSquare,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import {
  discoverAdapters,
  getDashboardSummary,
  getDependencies,
  isAdapterLaunchable,
  listProjects,
  listSessions,
} from "@/lib/api";
import { buildActivationReadiness } from "@/lib/activation-readiness";
import { normalizeSessionStatus } from "@/lib/session-status";
import {
  getTerminalRuntimeRemediation,
  getTerminalRuntimeSetupGuidance,
} from "@/lib/terminal-runtime";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { t } = useLanguage();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: getDashboardSummary,
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });
  const dependenciesQuery = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });
  const adaptersQuery = useQuery({
    queryKey: ["adapters", "discovery"],
    queryFn: discoverAdapters,
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const projects = projectsQuery.data?.projects ?? [];
  const firstProject = projects[0];
  const dashboardStats = dashboardQuery.data?.stats;
  const dashboardHealth = dashboardQuery.data?.health;
  const terminalRuntime = dependenciesQuery.data?.terminalRuntime;
  const terminalRemediation = getTerminalRuntimeRemediation(terminalRuntime?.mode);
  const terminalSetupGuidance = getTerminalRuntimeSetupGuidance(
    terminalRuntime?.mode,
    terminalRuntime?.supported
  );
  const dependenciesHealthy = dependenciesQuery.isSuccess && terminalRuntime?.supported === true;
  const dependenciesDetail = dependenciesQuery.isLoading
    ? t("dashboard.statusLoading")
    : dependenciesQuery.isError || !terminalRuntime
      ? t("dashboard.dependenciesHealthUnavailable")
      : t(terminalRemediation.detailKey);
  const showRuntimeCommands = !dependenciesQuery.isLoading && terminalSetupGuidance.blocked;

  const adapters = adaptersQuery.data?.adapters ?? [];
  const launchableAdapterCount = adapters.filter(isAdapterLaunchable).length;
  const adaptersHealthy = adaptersQuery.isSuccess && launchableAdapterCount > 0;
  const adaptersDetail = adaptersQuery.isLoading
    ? t("dashboard.statusLoading")
    : adaptersQuery.isError
      ? t("dashboard.activationAdapterUnavailable")
      : launchableAdapterCount > 0
        ? t("dashboard.adaptersHealthReady").replace("{count}", String(launchableAdapterCount))
        : t("dashboard.activationAdapterMissing");

  const runningCount = dashboardStats?.runningSessions
    ?? sessions.filter((session) => normalizeSessionStatus(session.status) === "running").length;

  const stats: { label: string; value: number; sub?: string; icon: typeof FolderOpen; href: string }[] = [
    {
      label: t("nav.projects"),
      value: dashboardStats?.projects ?? 0,
      icon: FolderOpen,
      href: "/projects",
    },
    {
      label: t("nav.sessions"),
      value: dashboardStats?.sessions ?? 0,
      sub: t("dashboard.runningNow").replace("{count}", String(runningCount)),
      icon: TerminalSquare,
      href: "/sessions",
    },
    {
      label: t("nav.skills"),
      value: dashboardStats?.skills ?? 0,
      icon: Wrench,
      href: "/skills",
    },
  ];

  const recentSessions = sessions.slice(0, 6);
  const projectCount = dashboardStats?.projects ?? projects.length;
  const sessionCount = dashboardStats?.sessions ?? sessions.length;
  const activationReadiness = buildActivationReadiness({
    terminalRuntime,
    dependenciesLoading: dependenciesQuery.isLoading,
    dependenciesError: dependenciesQuery.isError,
    adapters,
    adaptersLoading: adaptersQuery.isLoading,
    adaptersError: adaptersQuery.isError,
    modelsHealthy: dashboardHealth?.models.healthy,
    modelsLoading: dashboardQuery.isLoading,
    modelsError: dashboardQuery.isError,
    projectCount,
    sessionCount,
    firstProjectId: firstProject?.id,
  });
  const showFirstRunReadiness = !activationReadiness.complete;
  const doneStepCount = activationReadiness.steps.filter((step) => step.done).length;

  const statusItems = [
    {
      key: "runtime",
      label: t("dashboard.dependenciesHealth"),
      detail: dependenciesDetail,
      healthy: dependenciesHealthy,
      href: terminalRemediation.href,
    },
    {
      key: "adapters",
      label: t("dashboard.adaptersHealth"),
      detail: adaptersDetail,
      healthy: adaptersHealthy,
      href: "/settings",
    },
    {
      key: "models",
      label: t("dashboard.modelHealth"),
      detail: dashboardHealth?.models.message ?? t("dashboard.modelHealthDescription"),
      healthy: dashboardHealth?.models.healthy ?? false,
      href: "/models",
    },
    {
      key: "config",
      label: t("dashboard.configHealth"),
      detail: dashboardHealth?.projectConfig.message ?? t("dashboard.configHealthDescription"),
      healthy: dashboardHealth?.projectConfig.healthy ?? false,
      href: "/templates",
    },
    {
      key: "sessions",
      label: t("dashboard.sessionHealth"),
      detail: dashboardHealth?.sessions.message ?? t("dashboard.sessionHealthDescription"),
      healthy: dashboardHealth?.sessions.healthy ?? false,
      href: "/sessions",
    },
    {
      key: "skills",
      label: t("dashboard.skillHealth"),
      detail: dashboardHealth?.skills.message ?? t("dashboard.skillHealthDescription"),
      healthy: dashboardHealth?.skills.healthy ?? false,
      href: "/skills",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
            <Link href="/sessions">
              <Plus className="size-4" />
              {t("projects.newSession")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/projects/new">{t("projects.create")}</Link>
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {stats.map((stat, index) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="group forgebadger-animate-in"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <Card className="h-full transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:shadow-lg group-hover:shadow-brand/5">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <stat.icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-2xl font-semibold leading-none">{stat.value}</div>
                  <div className="mt-1.5 truncate text-xs text-muted-foreground">
                    {stat.label}
                    {stat.sub ? <span className="text-muted-foreground/70"> · {stat.sub}</span> : null}
                  </div>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-brand" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {showFirstRunReadiness && (
        <Card className="forgebadger-animate-in border-brand/30 bg-brand/5">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">{t("dashboard.firstRunTitle")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("dashboard.firstRunDescription")}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-500"
                    style={{
                      width: `${Math.round((doneStepCount / activationReadiness.steps.length) * 100)}%`,
                    }}
                  />
                </div>
                <span className="tabular-nums">
                  {doneStepCount}/{activationReadiness.steps.length}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {activationReadiness.steps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-start gap-2.5 rounded-md border border-border/70 bg-background/60 p-3"
                >
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t(step.labelKey)}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {t(step.detailKey)}
                    </p>
                    {step.id === "runtime" && showRuntimeCommands && (
                      <div className="mt-2">
                        <RuntimeSetupCommands guidance={terminalSetupGuidance} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
                <Link href={activationReadiness.primaryAction.href}>
                  {t(activationReadiness.primaryAction.labelKey)}
                </Link>
              </Button>
              {activationReadiness.secondaryActions.map((action) => (
                <Button key={action.href} asChild size="sm" variant="outline">
                  <Link href={action.href}>{t(action.labelKey)}</Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Recent sessions */}
        <section className="space-y-3 xl:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("dashboard.recentSessions")}</h2>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href="/sessions">{t("dashboard.viewAll")}</Link>
            </Button>
          </div>
          {recentSessions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <TerminalSquare className="size-5" />
                </div>
                <div>
                  <div className="text-sm font-medium">{t("dashboard.noSessions")}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("dashboard.emptySessionsDescription")}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/sessions">
                    <Plus className="size-4" />
                    {t("projects.newSession")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
              {recentSessions.map((session, index) => (
                <Link
                  key={session.id}
                  href={`/sessions/${session.id}`}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors forgebadger-animate-in hover:bg-muted/40"
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  <SessionStatusDot status={session.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {session.name || session.tmuxName || session.id}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {session.projectName ?? "—"}
                    </div>
                  </div>
                  <CliBrandChip aiTool={session.aiTool} />
                  <SessionStatusText status={session.status} />
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-brand" />
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* System status */}
        <section className="space-y-3 xl:col-span-2">
          <h2 className="text-sm font-semibold">{t("dashboard.systemStatus")}</h2>
          <Card>
            <CardContent className="space-y-0.5 p-2">
              {statusItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      item.healthy ? "bg-emerald-400" : "bg-amber-400"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{item.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{item.detail}</div>
                  </div>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/30" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function SessionStatusDot({ status }: { status: string }) {
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

function SessionStatusText({ status }: { status: string }) {
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
