"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderOpen, Plus, TerminalSquare, Trash2 } from "lucide-react";

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
import { IconTile } from "@/components/ui/icon-tile";
import { SessionBoard, SessionBoardSkeleton } from "@/components/sessions/SessionBoard";
import { SessionBoardListView } from "@/components/sessions/SessionBoardListView";
import { SessionBoardToolbar } from "@/components/sessions/SessionBoardToolbar";
import { SessionLaunchDialog } from "@/components/sessions/session-launch-dialog";
import { useSessionLastPrompts } from "@/components/sessions/use-session-last-prompts";
import { useSessionBoardPrefs } from "@/components/sessions/use-session-board-prefs";
import { applyColumnOrder } from "@/components/sessions/session-board-prefs";
import {
  collectSessionCliTools,
  countSessionsByStatus,
  filterBoardSessions,
  groupSessionsIntoColumns,
  resolveSessionPrompt,
  type SessionStartOptions,
} from "@/components/sessions/session-board-utils";
import type { Session } from "@/lib/api";
import {
  deleteSession,
  GatewayApiError,
  getDependencies,
  getSessionBoard,
  startSession,
  stopSession,
} from "@/lib/api";
import { notifySessionTabsChanged } from "@/components/session-tabs";
import { pruneSessionTabs, readSessionTabs, removeSessionTab, sessionToTab, upsertSessionTab } from "@/lib/session-tabs";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { toast } from "@/lib/toast";
import { useLanguage } from "@/hooks/use-language";
import { useSessionWorkStates } from "@/hooks/use-session-work-states";
import { cn } from "@/lib/utils";

export default function SessionsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCliTools, setSelectedCliTools] = useState<ReadonlySet<string>>(new Set());
  const [showEmptyProjects, setShowEmptyProjects] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<{ open: boolean; projectId?: string; projectName?: string }>({
    open: false,
  });
  const [clearStoppedOpen, setClearStoppedOpen] = useState(false);
  const [forceDeleteId, setForceDeleteId] = useState<string | null>(null);
  const workStates = useSessionWorkStates();
  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ["sessions-board"],
    queryFn: getSessionBoard,
  });
  const { data: dependenciesData, isLoading: dependenciesLoading } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });
  const prefs = useSessionBoardPrefs();
  // The kanban board uses fixed pixel column widths with horizontal scrolling,
  // which degrades on small screens: below md always render the list view
  // (the desktop preference is preserved and re-applies at md and up).
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const boardView = isDesktop ? prefs.view : "list";

  const refreshSessions = () => {
    queryClient.invalidateQueries({ queryKey: ["sessions-board"] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  const startMutation = useMutation({
    mutationFn: (input: { id: string; fresh?: boolean }) =>
      startSession(input.id, { resume: !input.fresh }),
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
    onSuccess: (result) => {
      if (result?.session?.warning) toast.warning(t("copilot.stopExternalWarning"));
      refreshSessions();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message
          ? `${t("sessions.stopFailed")}: ${error.message}`
          : t("sessions.stopFailed")
      );
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (input: { id: string; force?: boolean }) => deleteSession(input.id, { force: input.force }),
    onSuccess: () => {
      setForceDeleteId(null);
      refreshSessions();
    },
    onError: (error, input) => {
      // The CLI exited but a confirmed stop receipt could not be obtained
      // (lingering background processes or an unavailable runtime): offer the
      // operator-gated force delete instead of a dead-end toast.
      if (
        !input.force &&
        error instanceof GatewayApiError &&
        error.details?.code === "SESSION_RUNTIME_STOP_UNCONFIRMED"
      ) {
        setForceDeleteId(input.id);
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? `${t("sessions.deleteFailed")}: ${error.message}`
          : t("sessions.deleteFailed")
      );
    },
  });

  const clearStoppedMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results: PromiseSettledResult<unknown>[] = [];
      for (let offset = 0; offset < ids.length; offset += 5) {
        results.push(...await Promise.allSettled(
          ids.slice(offset, offset + 5).map((id) => deleteSession(id, { onlyStopped: true, force: true }))
        ));
      }
      return results;
    },
    onSuccess: (results, ids) => {
      const succeeded = results.filter((result) => result.status === "fulfilled").length;
      results.forEach((result, index) => {
        const id = ids[index];
        if (result.status === "fulfilled" && id) removeSessionTab(id);
      });
      if (succeeded) notifySessionTabsChanged();
      const failed = results.length - succeeded;
      const message = t(failed ? "sessions.clearStoppedPartial" : "sessions.clearStoppedSuccess")
        .replace("{count}", String(succeeded)).replace("{failed}", String(failed));
      if (failed) toast.warning(message); else toast.success(message);
      setClearStoppedOpen(false);
      refreshSessions();
    },
  });

  const board = data?.board;
  const sessions = board?.sessions ?? [];
  const stoppedSessions = sessions.filter((session) => ["idle", "stopped", "exited", "completed", "lost"].includes(session.status));
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
  // The board's allowlist is additionally widened with locally-tracked tabs
  // that are either still running or were created very recently: a session
  // started while a fetch was in flight is not in that fetch's snapshot, and
  // its tab may have already flipped to `exited`/`error` via a gateway event
  // before the next board settle observes it. A short grace window keeps
  // such tabs alive until a settled board that actually contains the row can
  // authoritatively keep or drop them. A running or just-created session is
  // always in the next settled board (creation is committed before its tab
  // is written), so this cannot mask a genuinely dead session indefinitely.
  useEffect(() => {
    if (!board || isFetching || isError) {
      return;
    }
    const now = Date.now();
    const RECENT_TAB_GRACE_MS = 30_000;
    const protectedTabIds = readSessionTabs()
      .filter((tab) => tab.status === "running" || now - tab.updatedAt < RECENT_TAB_GRACE_MS)
      .map((tab) => tab.id);
    pruneSessionTabs(new Set([...sessions.map((session) => session.id), ...protectedTabIds]));
    notifySessionTabsChanged();
  }, [board, sessions, isFetching, isError]);

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

  const cliTools = useMemo(() => collectSessionCliTools(sessions), [sessions]);
  const statusCounts = useMemo(() => countSessionsByStatus(sessions), [sessions]);
  const filteredSessions = useMemo(
    () => filterBoardSessions(sessions, { query, statusFilter, cliTools: selectedCliTools, prompts }),
    [sessions, query, statusFilter, selectedCliTools, prompts]
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

  // Relative times must not participate in SSR/hydration rendering (server
  // clock vs client clock diverge); render a placeholder until mounted, then
  // keep the clock fresh so relative labels tick over.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const actionPending = startMutation.isPending || stopMutation.isPending || deleteMutation.isPending || clearStoppedMutation.isPending;

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

  const openLaunchForProject = (projectId: string, projectName: string) => {
    setLaunchTarget({ open: true, projectId, projectName });
  };

  const openGlobalLaunch = () => {
    setLaunchTarget({ open: true });
  };

  const sessionActions = {
    onNewSessionForProject: openLaunchForProject,
    onOpenSession: openSession,
    onStartSession: (session: Session, options?: SessionStartOptions) => startMutation.mutate({ id: session.id, fresh: options?.fresh }),
    onStopSession: (session: Session) => stopMutation.mutate(session.id),
    onDeleteSession: (session: Session) => deleteMutation.mutate({ id: session.id }),
  };

  const noMatchesCard = (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <IconTile size="lg" tone="brand">
          <TerminalSquare strokeWidth={1.75} />
        </IconTile>
        <div>
          <div className="text-sm font-medium">{t("sessions.noMatchesTitle")}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("sessions.noMatchesDescription")}
          </p>
        </div>
      </CardContent>
    </Card>
  );

  const fullHeightBoard = boardView === "board" && !isLoading && sessions.length > 0;

  return (
    <div
      className={cn(
        "w-full p-5 md:p-6",
        fullHeightBoard
          ? "flex h-full min-h-0 flex-col gap-4 overflow-hidden"
          : "mx-auto max-w-[1600px] space-y-4"
      )}
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("sessions.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("sessions.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessions.length > 0 && (
            <Button size="sm" variant="outline" disabled={actionPending || isFetching || isError || stoppedSessions.length === 0} onClick={() => setClearStoppedOpen(true)}>
              <Trash2 className="size-4" />
              {t("sessions.clearStopped")}
              {stoppedSessions.length > 0 ? (
                <span
                  aria-hidden="true"
                  className="forgebadger-tabular-nums rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {stoppedSessions.length}
                </span>
              ) : null}
            </Button>
          )}
          {hasProjects ? (
            <Button
              size="sm"
              variant="brand"
              onClick={openGlobalLaunch}
            >
              <Plus className="size-4" />
              {t("projects.newSession")}
            </Button>
          ) : (
            <Button asChild size="sm" variant="brand">
              <Link href="/projects/new">
                <Plus className="size-4" />
                {t("sessions.createProject")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <SessionBoardSkeleton />
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[50vh] flex-col items-center justify-center gap-4 py-12 text-center">
            <IconTile size="lg" tone={runtimeBlocked ? "destructive" : "brand"}>
              {runtimeBlocked ? (
                <AlertTriangle strokeWidth={1.75} />
              ) : (
                <TerminalSquare strokeWidth={1.75} />
              )}
            </IconTile>
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
                  variant="brand"
                  onClick={openGlobalLaunch}
                >
                  <FolderOpen className="size-4" />
                  {t("sessions.createFromProject")}
                </Button>
              ) : (
                <Button asChild size="sm" variant="brand">
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
        <div className={cn(fullHeightBoard ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-4")}>
          <div className="shrink-0">
            <SessionBoardToolbar
              query={query}
              onQueryChange={setQuery}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              statusCounts={statusCounts}
              cliTools={cliTools}
              selectedCliTools={selectedCliTools}
              onToggleCliTool={toggleCliTool}
              showEmptyProjects={showEmptyProjects}
              onShowEmptyProjectsChange={setShowEmptyProjects}
              hasCustomColumnOrder={prefs.columnOrder.length > 0}
              onResetColumnOrder={prefs.resetColumnOrder}
              view={boardView}
              onViewChange={prefs.setView}
            />
          </div>
          {boardView === "list" ? (
            filteredSessions.length === 0 ? (
              noMatchesCard
            ) : (
              <SessionBoardListView
                columns={orderedColumns}
                sessionTasks={sessionTasks}
                workStates={workStates}
                prompts={prompts}
                now={now}
                actionPending={actionPending}
                {...sessionActions}
              />
            )
          ) : (
            <>
              {/* Keep the board mounted while filters hit zero results so its
                  one-time entrance does not replay when results return. */}
              <div className={cn("min-h-0 flex-1", filteredSessions.length === 0 && "hidden")}>
                <SessionBoard
                  columns={orderedColumns}
                  sessionTasks={sessionTasks}
                  workStates={workStates}
                  prompts={prompts}
                  now={now}
                  actionPending={actionPending}
                  columnWidth={prefs.columnWidth}
                  onColumnWidthChange={prefs.setColumnWidth}
                  onColumnOrderChange={prefs.setColumnOrder}
                  {...sessionActions}
                />
              </div>
              {filteredSessions.length === 0 ? noMatchesCard : null}
            </>
          )}
        </div>
      )}

      <SessionLaunchDialog
        open={launchTarget.open}
        projectId={launchTarget.projectId}
        projectName={launchTarget.projectName}
        projects={launchTarget.projectId ? undefined : projects}
        onOpenChange={(open) => setLaunchTarget((current) => ({ ...current, open }))}
        onCreated={(session) => {
          refreshSessions();
          openSession(session);
        }}
      />

      <Dialog open={clearStoppedOpen} onOpenChange={(open) => { if (!clearStoppedMutation.isPending) setClearStoppedOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sessions.clearStoppedTitle")}</DialogTitle>
            <DialogDescription>{t("sessions.clearStoppedDescription").replace("{count}", String(stoppedSessions.length))}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={clearStoppedMutation.isPending} onClick={() => setClearStoppedOpen(false)}>{t("sessions.forceDeleteCancel")}</Button>
            <Button variant="destructive" size="sm" disabled={clearStoppedMutation.isPending || stoppedSessions.length === 0} onClick={() => clearStoppedMutation.mutate(stoppedSessions.map((session) => session.id))}>
              {clearStoppedMutation.isPending ? t("sessions.clearingStopped") : t("sessions.clearStopped")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={forceDeleteId !== null} onOpenChange={(open) => { if (!open) setForceDeleteId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sessions.forceDeleteTitle")}</DialogTitle>
            <DialogDescription>{t("sessions.forceDeleteDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setForceDeleteId(null)}>
              {t("sessions.forceDeleteCancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (forceDeleteId) {
                  deleteMutation.mutate({ id: forceDeleteId, force: true });
                }
              }}
            >
              {t("sessions.forceDeleteConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
