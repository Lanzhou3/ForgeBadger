"use client";

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
} from "@/lib/api";
import { buildCopilotLaunchHref } from "@/lib/copilot";
import { normalizeSessionStatus } from "@/lib/session-status";
import { getTerminalRuntimeRemediation } from "@/lib/terminal-runtime";
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
  const dependenciesQuery = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });

  const sessionsData = sessionsQuery.data;
  const dashboard = dashboardQuery.data;
  const dashboardStats = dashboard?.stats;
  const dashboardHealth = dashboard?.health;
  const terminalRuntime = dependenciesQuery.data?.terminalRuntime;
  const terminalRemediation = getTerminalRuntimeRemediation(terminalRuntime?.mode);
  const dependenciesHealthy = dependenciesQuery.isSuccess && terminalRuntime?.supported === true;
  const dependenciesDetail = dependenciesQuery.isLoading
    ? t("dashboard.dependenciesHealthLoading")
    : dependenciesQuery.isError || !terminalRuntime
      ? t("dashboard.dependenciesHealthUnavailable")
      : t(terminalRemediation.detailKey);
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
