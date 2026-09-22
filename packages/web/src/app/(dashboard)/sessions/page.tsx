"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderOpen, Plus, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import { Card, CardContent } from "@/components/ui/card";
import { SessionBoard, SessionBoardSkeleton } from "@/components/sessions/SessionBoard";
import { SessionBoardListView } from "@/components/sessions/SessionBoardListView";
import { SessionBoardToolbar } from "@/components/sessions/SessionBoardToolbar";
import { useSessionLastPrompts } from "@/components/sessions/use-session-last-prompts";
import { useSessionBoardPrefs } from "@/components/sessions/use-session-board-prefs";
import { applyColumnOrder } from "@/components/sessions/session-board-prefs";
import {
  collectSessionCliTools,
  filterBoardSessions,
  groupSessionsIntoColumns,
  resolveSessionPrompt,
} from "@/components/sessions/session-board-utils";
import type { Session } from "@/lib/api";
import {
  deleteSession,
  getDependencies,
  getSessionBoard,
  startSession,
  stopSession,
} from "@/lib/api";
import { notifySessionTabsChanged } from "@/components/session-tabs";
import { pruneSessionTabs, readSessionTabs, sessionToTab, upsertSessionTab } from "@/lib/session-tabs";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { toast } from "@/lib/toast";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

export default function SessionsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCliTools, setSelectedCliTools] = useState<ReadonlySet<string>>(new Set());
  const [showEmptyProjects, setShowEmptyProjects] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ["sessions-board"],
    queryFn: getSessionBoard,
  });
  const { data: dependenciesData, isLoading: dependenciesLoading } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });
  const prefs = useSessionBoardPrefs();

  const refreshSessions = () => {
    queryClient.invalidateQueries({ queryKey: ["sessions-board"] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  const startMutation = useMutation({
    mutationFn: (id: string) => startSession(id),
    onSuccess: refreshSessions,
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message
          ? `${t("sessions.startFailed")}: ${error.message}`
          : t("sessions.startFailed")
      );
    },
  });
  const stopMutation = useMutation({
    mutationFn: (id: string) => stopSession(id),
    onSuccess: refreshSessions,
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message
          ? `${t("sessions.stopFailed")}: ${error.message}`
          : t("sessions.stopFailed")
      );
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: refreshSessions,
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message
          ? `${t("sessions.deleteFailed")}: ${error.message}`
          : t("sessions.deleteFailed")
      );
    },
  });

  const board = data?.board;
  const sessions = board?.sessions ?? [];
  const projects = board?.projects ?? [];
  const sessionTasks = board?.sessionTasks ?? {};
  const hasProjects = !isLoading && projects.length > 0;
  const terminalRuntime = dependenciesData?.terminalRuntime;
  const terminalSetupGuidance = getTerminalRuntimeSetupGuidance(
    terminalRuntime?.mode,
    terminalRuntime?.supported
  );
  const runtimeBlocked = !dependenciesLoading && terminalSetupGuidance.blocked;
  // Prune only against a settled, current board. On mount the board query may
  // first paint a stale cache (staleTime is 0) while it refetches, and a
  // background refetch that fails keeps serving the stale board with
  // isFetching back to false — in either case pruning to that snapshot would
  // permanently drop tabs for sessions created since.
  //
  // The board's allowlist is additionally widened with locally-running tabs: a
  // session that was started while a fetch was in flight is not in that
  // fetch's snapshot, and a running tab must never be dropped by a settle. A
  // running session is always in the next settled board (creation is committed
  // before its tab is written), so this cannot mask a genuinely dead session.
  useEffect(() => {
    if (!board || isFetching || isError) {
      return;
    }
    const runningTabIds = readSessionTabs()
      .filter((tab) => tab.status === "running")
      .map((tab) => tab.id);
    pruneSessionTabs(new Set([...sessions.map((session) => session.id), ...runningTabIds]));
    notifySessionTabsChanged();
  }, [board, sessions, isFetching, isError]);

  const cliTools = useMemo(() => collectSessionCliTools(sessions), [sessions]);
  const filteredSessions = useMemo(
    () => filterBoardSessions(sessions, { query, statusFilter, cliTools: selectedCliTools }),
    [sessions, query, statusFilter, selectedCliTools]
  );
  const searching = query.trim().length > 0;
  const columns = useMemo(
    () =>
      groupSessionsIntoColumns(filteredSessions, projects, {
        showEmptyProjects: showEmptyProjects || searching,
      }),
    [filteredSessions, projects, showEmptyProjects, searching]
  );
  const orderedColumns = useMemo(
    () => applyColumnOrder(columns, prefs.columnOrder),
    [columns, prefs.columnOrder]
  );

  const localPrompts = useSessionLastPrompts();
  const prompts = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const session of sessions) {
      const prompt = resolveSessionPrompt(session, localPrompts);
      if (prompt) {
        merged[session.id] = prompt;
      }
    }
    return merged;
  }, [sessions, localPrompts]);

  const now = Date.now();
  const actionPending = startMutation.isPending || stopMutation.isPending || deleteMutation.isPending;

  const toggleCliTool = (tool: string) => {
    setSelectedCliTools((current) => {
      const next = new Set(current);
      if (next.has(tool)) {
        next.delete(tool);
      } else {
        next.add(tool);
      }
      return next;
    });
  };

  const openSession = (session: Session) => {
    upsertSessionTab(sessionToTab(session));
    notifySessionTabsChanged();
    router.push(`/sessions/${session.id}`);
  };

  const sessionActions = {
    onOpenSession: openSession,
    onStartSession: (session: Session) => startMutation.mutate(session.id),
    onStopSession: (session: Session) => stopMutation.mutate(session.id),
    onDeleteSession: (session: Session) => deleteMutation.mutate(session.id),
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 p-6">
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
        <SessionBoardSkeleton />
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
      ) : filteredSessions.length === 0 ? (
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
          <SessionBoardToolbar
            query={query}
            onQueryChange={setQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            cliTools={cliTools}
            selectedCliTools={selectedCliTools}
            onToggleCliTool={toggleCliTool}
            showEmptyProjects={showEmptyProjects}
            onShowEmptyProjectsChange={setShowEmptyProjects}
            hasCustomColumnOrder={prefs.columnOrder.length > 0}
            onResetColumnOrder={prefs.resetColumnOrder}
            view={prefs.view}
            onViewChange={prefs.setView}
          />
          {prefs.view === "list" ? (
            <SessionBoardListView
              columns={orderedColumns}
              prompts={prompts}
              now={now}
              actionPending={actionPending}
              {...sessionActions}
            />
          ) : (
            <SessionBoard
              columns={orderedColumns}
              sessionTasks={sessionTasks}
              prompts={prompts}
              now={now}
              actionPending={actionPending}
              columnWidth={prefs.columnWidth}
              onColumnWidthChange={prefs.setColumnWidth}
              onColumnOrderChange={prefs.setColumnOrder}
              {...sessionActions}
            />
          )}
        </div>
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
            {isLoading ? (
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
