"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, GitBranch, Play, RefreshCcw, ServerCog, ShieldCheck, Square } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  initializeCodexAppServer,
  listCodexAppServers,
  listProjects,
  startCodexAppServer,
  startCodexAppServerThread,
  stopCodexAppServer,
  type CodexAppServerSession,
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

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

  const codexProjects = useMemo(
    () => (projectData?.projects ?? []).filter((project) => project.aiTool === "codex"),
    [projectData]
  );
  const sessions = appServerData?.sessions ?? [];

  const refreshAppServers = () => {
    queryClient.invalidateQueries({ queryKey: ["codex-app-servers"] });
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
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{t("codexAppServer.title")}</h1>
            <Badge variant="secondary">{t("codexAppServer.experimental")}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">{t("codexAppServer.subtitle")}</p>
        </div>
        <Button variant="outline" onClick={refreshAppServers}>
          <RefreshCcw className="mr-2 size-4" />
          {t("codexAppServer.refresh")}
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ServerCog className="size-4 text-muted-foreground" />
              <CardTitle>{t("codexAppServer.launch")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  {t("codexAppServer.zeroQuotaState")}
                </span>
                <Badge variant="secondary">{t("codexAppServer.turnDisabled")}</Badge>
              </div>
              <div className="mt-2 text-muted-foreground">
                {t("codexAppServer.transcriptOff")}
              </div>
            </div>

            <label className="block space-y-2 text-sm">
              <span className="font-medium">{t("common.project")}</span>
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

            <label className="block space-y-2 text-sm">
              <span className="font-medium">{t("codexAppServer.runtimeMode")}</span>
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
              className="w-full"
              disabled={!canStart}
              onClick={() => {
                setProjectId(selectedProjectId);
                startMutation.mutate({ projectId: selectedProjectId, runtimeMode });
              }}
            >
              <Play className="mr-2 size-4" />
              {startMutation.isPending ? t("codexAppServer.starting") : t("common.start")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t("codexAppServer.sessions")}</CardTitle>
              <Badge variant="secondary">{sessions.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessionsLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : sessions.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("codexAppServer.empty")}
              </div>
            ) : (
              sessions.map((session) => (
                <div key={session.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant={session.status === "running" ? "default" : "secondary"}>
                          {session.status}
                        </Badge>
                        <Badge variant={session.features?.turnInputEnabled ? "default" : "secondary"}>
                          {session.features?.turnInputEnabled
                            ? t("codexAppServer.turnEnabled")
                            : t("codexAppServer.turnDisabled")}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground">{session.runtimeMode}</span>
                      </div>
                      <div className="mt-2 truncate font-mono text-xs text-muted-foreground">
                        {session.projectRoot}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={initializeMutation.isPending}
                        onClick={() => initializeMutation.mutate(session.id)}
                      >
                        <CheckCircle2 className="mr-2 size-3" />
                        {t("codexAppServer.initialize")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={threadMutation.isPending}
                        onClick={() => threadMutation.mutate(session)}
                      >
                        <GitBranch className="mr-2 size-3" />
                        {t("codexAppServer.createThread")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={stopMutation.isPending}
                        onClick={() => stopMutation.mutate(session.id)}
                      >
                        <Square className="mr-2 size-3" />
                        {t("common.stop")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {(operationError || operationResult) && (
        <Card>
          <CardContent className="space-y-3 p-4">
            {operationError && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 size-4" />
                <span>{operationError}</span>
              </div>
            )}
            {operationResult && (
              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {operationResult}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function reportError(error: unknown, setOperationError: (message: string) => void): void {
  setOperationError(error instanceof Error ? error.message : String(error));
}
