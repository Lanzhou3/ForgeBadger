"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, CircleAlert, GitBranch, Play, RefreshCcw, ServerCog, ShieldCheck, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCodexAppServerCapabilities,
  initializeCodexAppServer,
  listActivities,
  listCodexAppServers,
  listProjects,
  startCodexAppServer,
  startCodexAppServerThread,
  stopCodexAppServer,
  type CodexAppServerSession,
  type SessionActivity,
} from "@/lib/api";
import { describeCodexAppServerActivity } from "@/lib/codex-app-server-activity";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

const CODEX_APP_SERVER_ACTIVITY_TYPES = [
  "codex_app_server_started",
  "codex_app_server_stopped",
  "codex_app_server_error",
  "codex_app_server_initialized",
  "codex_app_server_thread_started",
  "codex_app_server_notification",
];

export default function CodexAppServerPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [runtimeMode, setRuntimeMode] = useState<"app-server-stdio" | "app-server-websocket">("app-server-stdio");
  const [operationResult, setOperationResult] = useState("");
  const [operationError, setOperationError] = useState("");

  const { data: projectData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });
  const { data: appServerData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["codex-app-servers"],
    queryFn: listCodexAppServers,
  });
  const { data: capabilityData } = useQuery({
    queryKey: ["codex-app-server-capabilities"],
    queryFn: getCodexAppServerCapabilities,
  });
  const { data: activityData, isLoading: activitiesLoading } = useQuery({
    queryKey: ["codex-app-server-activities"],
    queryFn: () => listActivities({
      types: CODEX_APP_SERVER_ACTIVITY_TYPES,
      limit: 20,
    }),
  });

  const codexProjects = useMemo(
    () => (projectData?.projects ?? []).filter((project) => project.aiTool === "codex"),
    [projectData]
  );
  const sessions = appServerData?.sessions ?? [];
  const activities = activityData?.activities ?? [];
  const capabilities = capabilityData?.capabilities ?? {
    initializeEnabled: true,
    threadCreationEnabled: true,
    turnInputEnabled: false,
    promptInputExposed: false,
    transcriptPersistence: "disabled" as const,
  };

  const refreshAppServers = () => {
    queryClient.invalidateQueries({ queryKey: ["codex-app-servers"] });
    queryClient.invalidateQueries({ queryKey: ["codex-app-server-capabilities"] });
    queryClient.invalidateQueries({ queryKey: ["codex-app-server-activities"] });
  };

  const startMutation = useMutation({
    mutationFn: (input: { projectId: string; runtimeMode: "app-server-stdio" | "app-server-websocket" }) =>
      startCodexAppServer({
        projectId: input.projectId,
        runtimeMode: input.runtimeMode,
        credentialMode: "host_environment",
      }),
    onSuccess: (result) => {
      setOperationError("");
      setOperationResult(`${t("codexAppServer.started")}: ${result.session.id}`);
      refreshAppServers();
    },
    onError: (error) => reportError(error, setOperationError),
  });
  const initializeMutation = useMutation({
    mutationFn: (id: string) => initializeCodexAppServer(id),
    onSuccess: (result) => {
      setOperationError("");
      setOperationResult(JSON.stringify(result.result, null, 2));
    },
    onError: (error) => reportError(error, setOperationError),
  });
  const threadMutation = useMutation({
    mutationFn: (session: CodexAppServerSession) =>
      startCodexAppServerThread(session.id, {
        cwd: session.projectRoot,
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
    onSuccess: (result) => {
      setOperationError("");
      setOperationResult(JSON.stringify(result.result, null, 2));
    },
    onError: (error) => reportError(error, setOperationError),
  });
  const stopMutation = useMutation({
    mutationFn: (id: string) => stopCodexAppServer(id),
    onSuccess: (result) => {
      setOperationError("");
      setOperationResult(`${t("codexAppServer.stopped")}: ${result.session.id}`);
      refreshAppServers();
    },
    onError: (error) => reportError(error, setOperationError),
  });

  const selectedProjectId = projectId || codexProjects[0]?.id || "";
  const canStart = selectedProjectId.length > 0 && !startMutation.isPending;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t("codexAppServer.title")}</h1>
            <Badge variant="secondary" className="rounded-full">
              {t("codexAppServer.experimental")}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("codexAppServer.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAppServers}>
          <RefreshCcw className="size-4" />
          {t("codexAppServer.refresh")}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="of-animate-in">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <ServerCog className="size-4" />
              </div>
              <CardTitle className="text-sm font-semibold">{t("codexAppServer.launch")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              aria-label={t("codexAppServer.capabilityStateAria")}
              className="rounded-md border border-border/70 bg-muted/30 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  {t("codexAppServer.capabilityState")}
                </span>
                <Badge
                  variant={capabilities.turnInputEnabled ? "default" : "secondary"}
                  className="rounded-full"
                >
                  {capabilities.turnInputEnabled
                    ? t("codexAppServer.turnEnabled")
                    : t("codexAppServer.turnDisabled")}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {t("codexAppServer.transcriptOff")}
              </div>
            </div>

            <label className="block space-y-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t("common.project")}</span>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={selectedProjectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={projectsLoading || codexProjects.length === 0}
              >
                {codexProjects.length === 0 ? (
                  <option value="">{t("codexAppServer.noCodexProjects")}</option>
                ) : (
                  codexProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t("codexAppServer.runtimeMode")}</span>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={runtimeMode}
                onChange={(event) => setRuntimeMode(event.target.value as "app-server-stdio" | "app-server-websocket")}
              >
                <option value="app-server-stdio">stdio</option>
                <option value="app-server-websocket">WebSocket</option>
              </select>
            </label>

            <Button
              className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
              size="sm"
              disabled={!canStart}
              onClick={() => {
                setProjectId(selectedProjectId);
                startMutation.mutate({ projectId: selectedProjectId, runtimeMode });
              }}
            >
              <Play className="size-4" />
              {startMutation.isPending ? t("codexAppServer.starting") : t("common.start")}
            </Button>
          </CardContent>
        </Card>

        <Card className="of-animate-in" style={{ animationDelay: "40ms" }}>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold">{t("codexAppServer.sessions")}</CardTitle>
              <Badge variant="secondary" className="rounded-full tabular-nums">
                {sessions.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <ServerCog className="size-5" />
                </div>
                <div>
                  <div className="text-sm font-medium">{t("codexAppServer.empty")}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("codexAppServer.subtitle")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
                {sessions.map((session, index) => (
                  <div
                    key={session.id}
                    className="of-animate-in px-4 py-3"
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              session.status === "running"
                                ? "animate-pulse bg-emerald-400"
                                : session.status === "error"
                                  ? "bg-red-400"
                                  : "bg-muted-foreground/40"
                            )}
                          />
                          <Badge variant={session.status === "running" ? "default" : "secondary"}>
                            {session.status}
                          </Badge>
                          <Badge variant={session.features?.turnInputEnabled ? "default" : "secondary"}>
                            {session.features?.turnInputEnabled
                              ? t("codexAppServer.turnEnabled")
                              : t("codexAppServer.turnDisabled")}
                          </Badge>
                          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                            {session.runtimeMode}
                          </span>
                        </div>
                        <div className="mt-2 truncate font-mono text-xs text-muted-foreground">
                          {session.projectRoot}
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                          <CodexSessionMetric label={t("codexAppServer.endpoint")} value={session.listen} />
                          <CodexSessionMetric label={t("codexAppServer.processId")} value={session.pid ? String(session.pid) : "-"} />
                          <CodexSessionMetric label={t("codexAppServer.updatedAt")} value={formatCodexActivityTime(session.updatedAt)} />
                        </div>
                        {session.errorMessage && (
                          <div className="mt-2 break-words text-xs text-destructive">
                            {safeCodexAppServerErrorMessage(session.errorMessage, t("codexAppServer.processError"))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={initializeMutation.isPending}
                          onClick={() => initializeMutation.mutate(session.id)}
                        >
                          <CheckCircle2 className="size-3.5" />
                          {t("codexAppServer.initialize")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={threadMutation.isPending}
                          onClick={() => threadMutation.mutate(session)}
                        >
                          <GitBranch className="size-3.5" />
                          {t("codexAppServer.createThread")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          disabled={stopMutation.isPending}
                          onClick={() => stopMutation.mutate(session.id)}
                        >
                          <Square className="size-3.5" />
                          {t("common.stop")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card aria-label={t("codexAppServer.activityFeedAria")} className="of-animate-in" style={{ animationDelay: "80ms" }}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Activity className="size-4" />
              </div>
              <CardTitle className="text-sm font-semibold">{t("codexAppServer.recentActivity")}</CardTitle>
            </div>
            <Badge variant="secondary" className="rounded-full tabular-nums">
              {activities.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {activitiesLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Activity className="size-5" />
              </div>
              <div className="text-sm font-medium">{t("codexAppServer.noActivity")}</div>
            </div>
          ) : (
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
              {activities.map((activity, index) => (
                <CodexAppServerActivityRow key={activity.id} activity={activity} index={index} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(operationError || operationResult) && (
        <Card className="of-animate-in">
          <CardContent className="space-y-3 p-4">
            {operationError && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{operationError}</span>
              </div>
            )}
            {operationResult && (
              <pre className="max-h-64 overflow-auto rounded-md border border-border/70 bg-muted/50 p-3 text-xs text-muted-foreground">
                {operationResult}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CodexSessionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-foreground">{label}</div>
      <div className="truncate font-mono">{value}</div>
    </div>
  );
}

function CodexAppServerActivityRow({ activity, index }: { activity: SessionActivity; index: number }) {
  const { t } = useLanguage();
  const presentation = describeCodexAppServerActivity(activity);

  return (
    <div
      className="of-animate-in grid gap-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[180px_minmax(0,1fr)_120px] md:items-center"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Badge variant={presentation.variant} className="w-fit">
        {t(presentation.labelKey)}
      </Badge>
      <div className="min-w-0 space-y-1">
        <p className="break-words text-sm">{presentation.message}</p>
        {presentation.detail && (
          <p className="break-words font-mono text-xs text-muted-foreground">{presentation.detail}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground md:text-right">
        {formatCodexActivityTime(activity.createdAt)}
      </span>
    </div>
  );
}

function formatCodexActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString();
}

function safeCodexAppServerErrorMessage(value: string, fallback: string): string {
  const message = value.trim().replace(/\s+/g, " ");
  if (!message || isUnsafeErrorMessage(message)) {
    return fallback;
  }
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

function isUnsafeErrorMessage(message: string): boolean {
  return (
    /(?:^|\s)at\s+\S+/i.test(message) ||
    /\bstack\b/i.test(message) ||
    /(?:^|[\s(["'])\/(?:root|home|users|var|tmp|data)\//i.test(message) ||
    /[A-Za-z]:\\/i.test(message) ||
    /(?:api[_-]?key|token|secret|password|authorization|bearer)/i.test(message) ||
    /-----BEGIN [A-Z ]+-----/.test(message) ||
    /\b[A-Za-z0-9_-]{32,}\b/.test(message)
  );
}

function reportError(error: unknown, setOperationError: (message: string) => void): void {
  setOperationError(error instanceof Error ? error.message : String(error));
}
