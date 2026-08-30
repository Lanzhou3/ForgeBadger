"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderOpen, Play, Plus, RotateCcw, Search, Square, TerminalSquare, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import { Card, CardContent } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { deleteSession, getDependencies, listProjects, listSessions, startSession, stopSession } from "@/lib/api";
import { notifySessionTabsChanged } from "@/components/session-tabs";
import { pruneSessionTabs, sessionToTab, upsertSessionTab } from "@/lib/session-tabs";
import { normalizeSessionStatus, sessionMatchesStatusFilter } from "@/lib/session-status";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

export default function SessionsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
  });
  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });
  const { data: dependenciesData, isLoading: dependenciesLoading } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });

  const refreshSessions = () => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  const startMutation = useMutation({
    mutationFn: startSession,
    onSuccess: refreshSessions,
  });
  const stopMutation = useMutation({
    mutationFn: stopSession,
    onSuccess: refreshSessions,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteSession,
    onSuccess: refreshSessions,
  });

  const sessions = data?.sessions ?? [];
  const projects = projectsData?.projects ?? [];
  const hasProjects = !projectsLoading && projects.length > 0;
  const terminalRuntime = dependenciesData?.terminalRuntime;
  const terminalSetupGuidance = getTerminalRuntimeSetupGuidance(
    terminalRuntime?.mode,
    terminalRuntime?.supported
  );
  const runtimeBlocked = !dependenciesLoading && terminalSetupGuidance.blocked;
  useEffect(() => {
    if (!data) {
      return;
    }
    pruneSessionTabs(new Set(sessions.map((session) => session.id)));
    notifySessionTabsChanged();
  }, [data, sessions]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sessions.filter((session) => {
      const matchesStatus = sessionMatchesStatusFilter(session.status, statusFilter);
      if (!matchesStatus) {
        return false;
      }
      if (normalizedQuery.length === 0) {
        return true;
      }
      return [
        session.name,
        session.tmuxName,
        session.id,
        session.projectName,
        session.projectId,
        session.aiTool,
        session.status,
        normalizeSessionStatus(session.status),
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [query, sessions, statusFilter]);

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, typeof filteredSessions>();
    for (const session of filteredSessions) {
      const groupName = session.projectName ?? session.projectId ?? t("sessions.unknownProject");
      groups.set(groupName, [...(groups.get(groupName) ?? []), session]);
    }
    return Array.from(groups.entries()).map(([projectName, projectSessions]) => ({
      projectName,
      sessions: projectSessions,
    }));
  }, [filteredSessions, t]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("sessions.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("sessions.subtitle")}
          </p>
        </div>
        {hasProjects ? (
          <Button
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={() => setProjectPickerOpen(true)}
          >
            <Plus className="size-4" />
            {t("projects.newSession")}
          </Button>
        ) : (
          <Button asChild size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
            <Link href="/projects/new">
              <Plus className="size-4" />
              {t("sessions.createProject")}
            </Link>
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("sessions.loading")}
          </CardContent>
        </Card>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <div
              className={cn(
                "flex size-10 items-center justify-center rounded-md",
                runtimeBlocked ? "bg-destructive/10 text-destructive" : "bg-brand/10 text-brand"
              )}
            >
              {runtimeBlocked ? (
                <AlertTriangle className="size-5" />
              ) : (
                <TerminalSquare className="size-5" />
              )}
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-medium">
                {runtimeBlocked ? t(terminalSetupGuidance.titleKey) : t("sessions.emptyTitle")}
              </h3>
              <p className="mx-auto max-w-2xl text-xs text-muted-foreground">
                {runtimeBlocked
                  ? t("sessions.runtimeBlockedDescription")
                  : t("sessions.emptyReadyDescription")}
              </p>
              {runtimeBlocked && (
                <p className="mx-auto max-w-2xl text-xs text-muted-foreground">
                  {t(terminalSetupGuidance.descriptionKey)}
                </p>
              )}
            </div>
            {runtimeBlocked && (
              <div className="w-full max-w-3xl text-left">
                <RuntimeSetupCommands guidance={terminalSetupGuidance} />
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              {runtimeBlocked && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/settings">
                    <AlertTriangle className="size-4" />
                    {t("sessions.openSettings")}
                  </Link>
                </Button>
              )}
              {hasProjects ? (
                <Button
                  size="sm"
                  className="bg-brand text-brand-foreground hover:bg-brand/90"
                  onClick={() => setProjectPickerOpen(true)}
                >
                  <FolderOpen className="size-4" />
                  {t("sessions.createFromProject")}
                </Button>
              ) : (
                <Button asChild size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
                  <Link href="/projects/new">
                    <Plus className="size-4" />
                    {t("sessions.createProject")}
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-3 p-3 md:grid-cols-[1fr_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("sessions.searchPlaceholder")}
                  className="pl-9"
                />
              </div>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label={t("sessions.statusFilter")}
              >
                <option value="all">{t("sessions.statusAll")}</option>
                <option value="running">{t("sessions.running")}</option>
                <option value="stopped">{t("sessions.stopped")}</option>
                <option value="error">{t("sessions.error")}</option>
              </select>
            </CardContent>
          </Card>

          {filteredSessions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <TerminalSquare className="size-5" />
                </div>
                <div>
                  <div className="text-sm font-medium">{t("sessions.noMatchesTitle")}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("sessions.noMatchesDescription")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {groupedSessions.map((group, groupIndex) => (
                <section
                  key={group.projectName}
                  className="forgebadger-animate-in overflow-hidden rounded-lg border border-border bg-card"
                  style={{ animationDelay: `${groupIndex * 40}ms` }}
                >
                  <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/30 px-4 py-2.5">
                    <h2 className="truncate text-sm font-semibold">{group.projectName}</h2>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {group.sessions.length}
                    </span>
                  </div>
                  <div className="divide-y divide-border/70">
                    {group.sessions.map((session) => {
                      const isRunning = session.status === "running";
                      const canStart = !isRunning;
                      return (
                        <div
                          key={session.id}
                          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                        >
                          <SessionStatusDot status={session.status} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {session.name || session.tmuxName || session.id}
                            </div>
                          </div>
                          {session.aiTool ? <CliBrandChip aiTool={session.aiTool} /> : null}
                          <SessionStatusText status={session.status} />
                          <div className="flex shrink-0 items-center justify-end gap-1">
                            {isRunning ? (
                              <Button
                                asChild
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  upsertSessionTab(sessionToTab(session));
                                  notifySessionTabsChanged();
                                }}
                              >
                                <Link href={`/sessions/${session.id}`}>
                                  <Play className="size-3.5" />
                                  {t("common.connect")}
                                </Link>
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" disabled>
                                <Play className="size-3.5" />
                                {t("common.connect")}
                              </Button>
                            )}
                            {canStart ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => startMutation.mutate(session.id)}
                                disabled={startMutation.isPending}
                              >
                                <RotateCcw className="size-3.5" />
                                {t("common.start")}
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => stopMutation.mutate(session.id)}
                                disabled={stopMutation.isPending}
                              >
                                <Square className="size-3.5" />
                                {t("common.stop")}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteMutation.mutate(session.id)}
                              disabled={deleteMutation.isPending}
                              aria-label={`${t("sessions.deleteLabel")} ${session.name || session.id}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sessions.chooseProjectTitle")}</DialogTitle>
            <DialogDescription>{t("sessions.chooseProjectDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {projects.map((project) => (
              <Button
                key={project.id}
                variant="outline"
                className="h-auto w-full min-w-0 justify-start gap-3 px-3 py-2.5"
                onClick={() => {
                  setProjectPickerOpen(false);
                  router.push(`/projects/${project.id}?tab=sessions`);
                }}
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="max-w-full truncate text-sm font-medium">{project.name}</span>
                  {project.path && (
                    <span className="max-w-full truncate font-mono text-xs text-muted-foreground">
                      {project.path}
                    </span>
                  )}
                </span>
              </Button>
            ))}
            {projectsLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("sessions.loading")}
              </p>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("sessions.chooseProjectEmpty")}
                </p>
                <Button asChild size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
                  <Link href="/projects/new">
                    <Plus className="size-4" />
                    {t("sessions.createProject")}
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
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
