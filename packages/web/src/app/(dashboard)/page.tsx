"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  FolderOpen,
  TerminalSquare,
  Bot,
  CheckCircle2,
  FileCode2,
  Wrench,
  Plus,
  ArrowRight,
  Sparkles,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getDependencies,
  listSessions,
  getDashboardSummary,
  getConfigCompliance,
  listProjects,
  discoverAdapters,
} from "@/lib/api";
import { buildActivationReadiness } from "@/lib/activation-readiness";
import { buildCopilotLaunchHref } from "@/lib/copilot";
import { normalizeSessionStatus } from "@/lib/session-status";
import {
  getTerminalRuntimeRemediation,
  getTerminalRuntimeSetupGuidance,
} from "@/lib/terminal-runtime";
import { useLanguage } from "@/hooks/use-language";

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
  const firstProjectId = projectsQuery.data?.projects[0]?.id;
  const configComplianceQuery = useQuery({
    queryKey: ["project-config-compliance", firstProjectId],
    queryFn: () => getConfigCompliance(firstProjectId ?? ""),
    enabled: Boolean(firstProjectId),
    retry: false,
  });

  const sessionsData = sessionsQuery.data;
  const projects = projectsQuery.data?.projects ?? [];
  const firstProject = projects[0];
  const dashboard = dashboardQuery.data;
  const dashboardStats = dashboard?.stats;
  const dashboardHealth = dashboard?.health;
  const terminalRuntime = dependenciesQuery.data?.terminalRuntime;
  const terminalRemediation = getTerminalRuntimeRemediation(terminalRuntime?.mode);
  const terminalSetupGuidance = getTerminalRuntimeSetupGuidance(
    terminalRuntime?.mode,
    terminalRuntime?.supported
  );
  const dependenciesHealthy = dependenciesQuery.isSuccess && terminalRuntime?.supported === true;
  const dependenciesDetail = dependenciesQuery.isLoading
    ? t("dashboard.dependenciesHealthLoading")
    : dependenciesQuery.isError || !terminalRuntime
      ? t("dashboard.dependenciesHealthUnavailable")
      : t(terminalRemediation.detailKey);
  const showRuntimeCommands = !dependenciesQuery.isLoading && terminalSetupGuidance.blocked;
  const dashboardCopilotHref = buildCopilotLaunchHref({
    source: "dashboard",
  });

  const stats = [
    {
      label: "Projects",
      labelText: t("nav.projects"),
      value: dashboardStats?.projects ?? 0,
      icon: FolderOpen,
      href: "/projects",
    },
    {
      label: "Sessions",
      labelText: t("nav.sessions"),
      value: dashboardStats?.sessions ?? 0,
      icon: TerminalSquare,
      href: "/sessions",
    },
    {
      label: "Agents",
      labelText: t("nav.agents"),
      value: dashboardStats?.agents ?? 0,
      icon: Bot,
      href: "/agents",
    },
    {
      label: "Skills",
      labelText: t("nav.skills"),
      value: dashboardStats?.skills ?? 0,
      icon: Wrench,
      href: "/skills",
    },
  ];

  const recentSessions = (sessionsData?.sessions ?? []).slice(0, 5);
  const projectCount = dashboardStats?.projects ?? projects.length;
  const sessionCount = dashboardStats?.sessions ?? sessionsData?.sessions.length ?? 0;
  const activationReadiness = buildActivationReadiness({
    terminalRuntime,
    dependenciesLoading: dependenciesQuery.isLoading,
    dependenciesError: dependenciesQuery.isError,
    adapters: adaptersQuery.data?.adapters ?? [],
    adaptersLoading: adaptersQuery.isLoading,
    adaptersError: adaptersQuery.isError,
    modelsHealthy: dashboardHealth?.models.healthy,
    modelsLoading: dashboardQuery.isLoading,
    modelsError: dashboardQuery.isError,
    projectCount,
    projectConfigCompliant: configComplianceQuery.data?.compliance.status === "compliant",
    projectConfigLoading: Boolean(firstProjectId) && configComplianceQuery.isLoading,
    projectConfigError: Boolean(firstProjectId) && configComplianceQuery.isError,
    sessionCount,
    firstProjectId: firstProject?.id,
  });
  const showFirstRunReadiness = !activationReadiness.complete;
  const healthCards = [
    {
      label: t("dashboard.gatewayHealth"),
      detail: dashboardHealth?.gateway.message ?? t("dashboard.gatewayHealthDescription"),
      healthy: dashboardHealth?.gateway.healthy ?? !dashboardQuery.isError,
      icon: Activity,
      href: "/settings",
    },
    {
      label: t("dashboard.databaseHealth"),
      detail: dashboardHealth?.database.message ?? t("dashboard.databaseHealthDescription"),
      healthy: dashboardHealth?.database.healthy ?? !dashboardQuery.isError,
      icon: CheckCircle2,
      href: "/settings",
    },
    {
      label: t("dashboard.dependenciesHealth"),
      detail: dependenciesDetail,
      healthy: dependenciesHealthy,
      icon: CheckCircle2,
      href: terminalRemediation.href,
    },
    {
      label: t("dashboard.configHealth"),
      detail: dashboardHealth?.projectConfig.message ?? t("dashboard.configHealthDescription"),
      healthy: dashboardHealth?.projectConfig.healthy ?? false,
      icon: FileCode2,
      href: "/templates",
    },
    {
      label: t("dashboard.modelHealth"),
      detail: dashboardHealth?.models.message ?? t("dashboard.modelHealthDescription"),
      healthy: dashboardHealth?.models.healthy ?? false,
      icon: Bot,
      href: "/models",
    },
    {
      label: t("dashboard.sessionHealth"),
      detail: dashboardHealth?.sessions.message ?? t("dashboard.sessionHealthDescription"),
      healthy: dashboardHealth?.sessions.healthy ?? false,
      icon: TerminalSquare,
      href: "/sessions",
    },
    {
      label: t("dashboard.agentHealth"),
      detail: dashboardHealth?.agents.message ?? t("dashboard.agentHealthDescription"),
      healthy: dashboardHealth?.agents.healthy ?? false,
      icon: Bot,
      href: "/agents",
    },
    {
      label: t("dashboard.skillHealth"),
      detail: dashboardHealth?.skills.message ?? t("dashboard.skillHealthDescription"),
      healthy: dashboardHealth?.skills.healthy ?? false,
      icon: Wrench,
      href: "/skills",
    },
  ];
  const healthGaps = healthCards.filter((card) => !card.healthy);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={dashboardCopilotHref}>
            <Sparkles className="mr-2 size-4" />
            {t("copilot.askCopilot")}
          </Link>
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.labelText}
              </CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <Link
                href={stat.href}
                className="mt-1 inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
              >
                {t("dashboard.viewAll")} <ArrowRight className="ml-1 size-3" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {showFirstRunReadiness && (
        <Card className="border-primary/30 bg-muted/20">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{t("dashboard.firstRunTitle")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("dashboard.firstRunDescription")}
                </p>
              </div>
              <Badge variant={activationReadiness.complete ? "secondary" : "outline"}>
                {activationReadiness.complete
                  ? t("dashboard.firstRunReady")
                  : t("dashboard.firstRunBlocked")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              {activationReadiness.steps.map((step) => (
                <FirstRunStep
                  key={step.id}
                  label={t(step.labelKey)}
                  done={step.done}
                  detail={t(step.detailKey)}
                >
                  {step.id === "runtime" && showRuntimeCommands && (
                    <RuntimeSetupCommands guidance={terminalSetupGuidance} />
                  )}
                </FirstRunStep>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
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

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("dashboard.health")}</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {healthCards.map((card) => (
            <Link key={card.label} href={card.href}>
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-sm">{card.label}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
                  </div>
                  <card.icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <Badge variant={card.healthy ? "secondary" : "destructive"}>
                    {card.healthy ? t("dashboard.healthy") : t("dashboard.needsSetup")}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Active Sessions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("dashboard.activeSessions")}</h2>
          <Link href="/sessions">
            <Button variant="ghost" size="sm">
              {t("dashboard.viewAll")}
            </Button>
          </Link>
        </div>
        {recentSessions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t("dashboard.noSessions")}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("common.aiTool")}</TableHead>
                  <TableHead className="text-right">{t("projects.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">
                      {session.name || session.tmuxName || session.id}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={session.status} />
                    </TableCell>
                    <TableCell>{session.aiTool ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/sessions/${session.id}`}>
                        <Button variant="ghost" size="sm">
                          {t("common.connect")}
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t("dashboard.quickActions")}</h2>
        <div className="flex flex-wrap gap-3">
          {healthGaps.slice(0, 4).map((gap) => (
            <Link key={gap.label} href={gap.href}>
              <Button variant="outline">
                <AlertTriangle className="mr-2 size-4" />
                {gap.label}
              </Button>
            </Link>
          ))}
          <Link href="/projects/new">
            <Button>
              <Plus className="mr-2 size-4" />
              {t("projects.create")}
            </Button>
          </Link>
          <Link href="/sessions">
            <Button variant="outline">
              <TerminalSquare className="mr-2 size-4" />
              {t("projects.newSession")}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function FirstRunStep({
  label,
  detail,
  done,
  children,
}: {
  label: string;
  detail: string;
  done: boolean;
  children?: ReactNode;
}) {
  const { t } = useLanguage();

  return (
    <div className="min-w-0 rounded-md border border-border bg-background/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        <Badge variant={done ? "secondary" : "destructive"}>
          {done ? t("dashboard.firstRunReady") : t("dashboard.firstRunBlocked")}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const normalizedStatus = normalizeSessionStatus(status);
  const variant =
    normalizedStatus === "running"
      ? "default"
      : normalizedStatus === "error"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant as "default" | "destructive" | "secondary"}>
      {normalizedStatus === "running"
        ? t("sessions.running")
        : normalizedStatus === "error"
          ? t("sessions.error")
          : t("sessions.stopped")}
    </Badge>
  );
}
