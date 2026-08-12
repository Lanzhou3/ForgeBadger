"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderOpen, Play, Plus, RotateCcw, Search, Square, TerminalSquare, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { deleteSession, getDependencies, listProjects, listSessions, startSession, stopSession } from "@/lib/api";
import { notifySessionTabsChanged } from "@/components/session-tabs";
import { pruneSessionTabs, sessionToTab, upsertSessionTab } from "@/lib/session-tabs";
import { normalizeSessionStatus, sessionMatchesStatusFilter } from "@/lib/session-status";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { useLanguage } from "@/hooks/use-language";

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
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("sessions.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("sessions.subtitle")}
          </p>
        </div>
        {hasProjects ? (
          <Button onClick={() => setProjectPickerOpen(true)}>
            <Plus className="mr-2 size-4" />
            {t("projects.newSession")}
          </Button>
        ) : (
          <Button asChild>
            <Link href="/projects/new">
              <Plus className="mr-2 size-4" />
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
            {runtimeBlocked ? (
              <AlertTriangle className="size-10 text-destructive" />
            ) : (
              <TerminalSquare className="size-10 text-muted-foreground" />
            )}
            <div className="space-y-1">
              <h3 className="text-lg font-medium">
                {runtimeBlocked ? t(terminalSetupGuidance.titleKey) : t("sessions.emptyTitle")}
              </h3>
              <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
                {runtimeBlocked
                  ? t("sessions.runtimeBlockedDescription")
                  : t("sessions.emptyReadyDescription")}
              </p>
              {runtimeBlocked && (
                <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
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
                <Button asChild variant="outline">
                  <Link href="/settings">
                    <AlertTriangle className="mr-2 size-4" />
                    {t("sessions.openSettings")}
                  </Link>
                </Button>
              )}
              {hasProjects ? (
                <Button onClick={() => setProjectPickerOpen(true)}>
                  <FolderOpen className="mr-2 size-4" />
                  {t("sessions.createFromProject")}
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/projects/new">
                    <Plus className="mr-2 size-4" />
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
            <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_180px]">
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
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <TerminalSquare className="size-8 text-muted-foreground" />
                <h3 className="mt-3 text-base font-medium">{t("sessions.noMatchesTitle")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("sessions.noMatchesDescription")}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                {groupedSessions.map((group) => (
                  <div key={group.projectName} className="border-b last:border-b-0">
                    <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-3">
                      <div>
                        <h2 className="text-sm font-medium">{group.projectName}</h2>
                        <p className="text-xs text-muted-foreground">{t("sessions.groupedByProject")}</p>
                      </div>
                      <Badge variant="secondary">{group.sessions.length}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("common.name")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                          <TableHead>{t("common.aiTool")}</TableHead>
                          <TableHead className="w-[280px] text-right">{t("common.actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.sessions.map((session) => {
                          const isRunning = session.status === "running";
                          const canStart = !isRunning;
                          return (
                            <TableRow key={session.id}>
                              <TableCell className="font-medium">
                                {session.name || session.tmuxName || session.id}
                              </TableCell>
                              <TableCell>
                                <SessionStatusBadge status={session.status} />
                              </TableCell>
                              <TableCell>
                                {session.aiTool ? <CliBrandChip aiTool={session.aiTool} /> : "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-1">
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
                                        <Play className="mr-2 size-3" />
                                        {t("common.connect")}
                                      </Link>
                                    </Button>
                                  ) : (
                                    <Button variant="ghost" size="sm" disabled>
                                      <Play className="mr-2 size-3" />
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
                                      <RotateCcw className="mr-2 size-3" />
                                      {t("common.start")}
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => stopMutation.mutate(session.id)}
                                      disabled={stopMutation.isPending}
                                    >
                                      <Square className="mr-2 size-3" />
                                      {t("common.stop")}
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive"
                                    onClick={() => deleteMutation.mutate(session.id)}
                                    disabled={deleteMutation.isPending}
                                    aria-label={`${t("sessions.deleteLabel")} ${session.name || session.id}`}
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </CardContent>
            </Card>
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
                className="h-auto justify-start gap-3 px-3 py-2.5"
                onClick={() => {
                  setProjectPickerOpen(false);
                  router.push(`/projects/${project.id}?tab=sessions`);
                }}
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="truncate text-sm font-medium">{project.name}</span>
                  {project.path && (
                    <span className="truncate font-mono text-xs text-muted-foreground">
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
                <Button asChild>
                  <Link href="/projects/new">
                    <Plus className="mr-2 size-4" />
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

function SessionStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const normalizedStatus = normalizeSessionStatus(status);
  if (normalizedStatus === "running") {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-600">
        {t("sessions.running")}
      </Badge>
    );
  }
  if (normalizedStatus === "error") {
    return <Badge variant="destructive">{t("sessions.error")}</Badge>;
  }
  return <Badge variant="secondary">{t("sessions.stopped")}</Badge>;
}
