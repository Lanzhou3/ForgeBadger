"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Square, ClipboardList, Copy, Download, ExternalLink, FileText, History, Maximize2, Minimize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notifySessionTabsChanged, SessionTabs } from "@/components/session-tabs";
import { TerminalView } from "@/components/terminal-view";
import {
  connectSession,
  GatewayApiError,
  getSession,
  listProjectManagerTaskPackets,
  startSession,
  stopSession,
  type ProjectManagerTaskPacket,
  type ProjectManagerTaskPacketQueueStatus,
  type Session,
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { getLatestRunningTab, removeSessionTab, sessionToTab, upsertSessionTab } from "@/lib/session-tabs";
import { normalizeSessionStatus } from "@/lib/session-status";
import { useLanguage } from "@/hooks/use-language";
import {
  findSessionTaskPacket,
  sessionTaskPacketProjectManagerHref,
} from "@/components/sessions/session-task-packet";
import { GitChangesPanel } from "@/components/sessions/git-changes-panel";
import { SessionSummaryPanel } from '@/components/sessions/SessionSummaryPanel';
import { ProviderQuotaPanel } from "@/components/sessions/provider-quota-panel";
import { SessionNotificationBell } from "@/components/sessions/session-notification-bell";
import {
  auditSessionHandoffExportInput,
  buildSessionHandoffMarkdown,
  sessionHandoffMarkdownFilename,
  type SessionHandoffAuditIssue,
} from "@/components/sessions/session-handoff-export";
import { useSessionProblemCopy } from "@/components/sessions/session-problem-copy";
import {
  shouldAutoConnectSession,
  shouldShowSessionPreparing,
} from "@/lib/session-connect-state";
import { cn } from "@/lib/utils";

export default function TerminalPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const problemCopy = useSessionProblemCopy();
  const id = params.id as string;
  const [focusMode, setFocusMode] = useState(false);
  const [outputHistoryOpen, setOutputHistoryOpen] = useState(false);

  const authToken = getToken() ?? "";
  const attachTokenOverride = searchParams.get("attachToken");

  const sessionQuery = useQuery({
    queryKey: ["session", id],
    queryFn: () => getSession(id),
    enabled: !!id,
    retry: false,
  });

  // A genuinely deleted session (404) can never be reopened. Its tab is a dead
  // end: drop it and move to the most recently used running session (or the
  // session list) so the user lands on a usable session instead of a dead-end
  // not-found card. The effect watches the specific error object, so it runs
  // only when a real 404 appears — not on transient network failures.
  useEffect(() => {
    const error = sessionQuery.error;
    if (!error || !(error instanceof GatewayApiError) || error.status !== 404) {
      return;
    }
    const nextActive = getLatestRunningTab(removeSessionTab(id));
    notifySessionTabsChanged();
    router.replace(nextActive ? `/sessions/${nextActive.id}` : "/sessions");
  }, [id, router, sessionQuery.error]);

  const connectMutation = useMutation({
    mutationFn: () => connectSession(id),
    onSuccess: ({ session }) => {
      queryClient.setQueryData(["session", id], { session });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  // Tab switching does not remount this page — the same instance re-renders
  // with a new `id`. Clear any connect request still in flight for the previous
  // tab so a stale pending/error never bleeds into the new tab, then let the
  // auto-connect effect below decide (with a fresh idle state) whether this tab
  // should connect. Keyed on `id` only: `useMutation` returns a new object every
  // render, so `connectMutation` must NOT be a dependency (reset() is a no-op
  // unless there is in-flight/stale state to clear).
  useEffect(() => {
    connectMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Guard connect results by id: the mutation above is reset on tab change,
  // but for one render before that reset commits its state, `connectMutation.data`
  // can still hold the previous tab's session/attachToken. Never apply those to
  // the new tab.
  const connectedSession =
    connectMutation.data && connectMutation.data.session.id === id ? connectMutation.data.session : undefined;
  const session = connectedSession ?? sessionQuery.data?.session;
  const attachToken =
    attachTokenOverride ?? connectedSession?.attachToken ?? sessionQuery.data?.session?.attachToken ?? "";

  const { data: taskPacketData, error: taskPacketError, isFetching: isTaskPacketFetching } = useQuery({
    queryKey: ["project-manager", session?.projectId, "task-packets", { limit: 50, sessionId: id }],
    queryFn: () => listProjectManagerTaskPackets(session?.projectId ?? "", { limit: 50 }),
    enabled: Boolean(session?.projectId),
    retry: false,
  });

  const startMutation = useMutation({
    mutationFn: () => startSession(id),
    onSuccess: async () => {
      // Task Packets intentionally create idle sessions. Starting the CLI must
      // remain an explicit operator action before terminal connection.
      await queryClient.invalidateQueries({ queryKey: ["session", id] });
      connectMutation.reset();
      connectMutation.mutate();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message
          ? `${t("sessions.startFailed")}: ${error.message}`
          : t("sessions.startFailed")
      );
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopSession(id),
    onSuccess: (result) => {
      if (result?.session?.warning) toast.warning(t("copilot.stopExternalWarning"));
      queryClient.invalidateQueries({ queryKey: ["session", id] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message
          ? `${t("sessions.stopFailed")}: ${error.message}`
          : t("sessions.stopFailed")
      );
    },
  });

  const connectSessionMutation = connectMutation.mutate;
  const isConnecting = connectMutation.isPending;
  const sessionTaskPacket = findSessionTaskPacket(taskPacketData?.taskPackets ?? [], id);

  useEffect(() => {
    // Only auto-connect a running session. `connect` 409s for anything else, so
    // a stopped/exited session must resolve through the GET query instead —
    // firing connect here would just surface a 409 error in the error branch.
    if (session?.status !== "running") {
      return;
    }
    if (
      !shouldAutoConnectSession({
        sessionId: id,
        hasAuthToken: authToken.length > 0,
        hasAttachTokenOverride: attachTokenOverride !== null,
        isConnecting,
        hasConnectedSession: Boolean(connectedSession),
        hasConnectError: connectMutation.isError,
      })
    ) {
      return;
    }
    connectSessionMutation();
  }, [
    attachTokenOverride,
    authToken,
    connectMutation.isError,
    connectSessionMutation,
    connectedSession,
    id,
    isConnecting,
    session?.status,
  ]);

  useEffect(() => {
    if (!session) {
      return;
    }
    upsertSessionTab(sessionToTab(session));
    notifySessionTabsChanged();
  }, [session]);

  // Rendering is driven by what we actually have to show, not by the connect
  // round-trip in flight. The terminal stays mounted across tab switches, so
  // switching never unmounts xterm into a "preparing" fallback.
  const hasAttachToken = attachToken.length > 0;
  const sessionRunning = session?.status === "running";
  const connectFailed = connectMutation.isError;
  const connectError =
    connectMutation.error instanceof Error ? connectMutation.error.message : "";

  // The tab strip stays mounted for EVERY state of this page. Replacing the
  // whole page for an exited/lost/unreadable session unmounted SessionTabs,
  // which also disabled the close-on-exit listener living inside it and
  // stranded the user on a dead panel with no way to reach other sessions.
  // Only the terminal area below swaps between the live terminal, an
  // exit/problem card, and the preparing state.
  let view: "terminal" | "preparing" | "problem" = "terminal";
  let problem: ProblemView | null = null;

  const startAction = (
    <Button
      size="sm"
      onClick={() => startMutation.mutate()}
      disabled={startMutation.isPending}
    >
      {t("common.start")}
    </Button>
  );

  // 1. No login token: nothing authenticated can be shown. (The dashboard
  //    layout normally redirects to /login before we get here.)
  if (!authToken) {
    view = "problem";
    problem = { title: t("sessions.cannotOpen"), message: t("sessions.returnToList") };
  } else if (session && session.status === "lost" && !hasAttachToken) {
    // 2a. A lost session's runtime is gone (daemon death / OS restart) and can
    //     never be reattached: explain what happened and how to get a working
    //     terminal again, instead of showing the same panel as a deliberate stop.
    view = "problem";
    problem = {
      title: t("sessions.lostTitle"),
      message: t("sessions.lostDescription"),
      tone: "warning",
      action: startAction,
    };
  } else if (session && !sessionRunning && !hasAttachToken) {
    // 2. Session is known but not connectable and we hold no attach token: a
    //    stopped/exited session. Offer an explicit Start instead of a terminal
    //    that can never attach. A deliberate stop is an expected state, not an
    //    error: neutral tone, and the guidance points at this panel's own Start
    //    button instead of sending the user away to "use Connect".
    view = "problem";
    problem = {
      title: problemCopy.stoppedTitle,
      message: problemCopy.stoppedMessage,
      tone: "muted",
      action: startAction,
    };
  } else if (!session) {
    // 3. Session unknown: distinguish "resolved but gone" (404/deleted) from
    //    "a connect attempt failed" from "still fetching".
    if (sessionQuery.isError) {
      view = "problem";
      problem = { title: t("sessions.cannotOpen"), message: t("sessions.notFound") };
    } else if (connectFailed) {
      view = "problem";
      problem = {
        title: t("sessions.cannotOpen"),
        message: connectError,
        hint: t("sessions.returnToList"),
      };
    } else if (
      shouldShowSessionPreparing({
        hasAuthToken: true,
        hasAttachTokenOverride: attachTokenOverride !== null,
        connectStatus: connectMutation.status,
        hasConnectError: connectMutation.isError,
        hasSession: false,
      })
    ) {
      view = "preparing";
    }
  } else if (connectFailed && !hasAttachToken) {
    // 4. A connectable session that has no token yet and whose connect attempt
    //    failed (e.g. the live PTY was lost after a gateway restart): surface
    //    the error instead of a terminal spinning on "connecting" forever.
    view = "problem";
    problem = {
      title: t("sessions.cannotOpen"),
      message: connectError,
      hint: t("sessions.returnToList"),
    };
  }

  // Focus mode gives the terminal the full window width. It only applies while
  // the terminal is actually shown; an exited/lost session drops back to a
  // problem card and must not keep the sidebar hidden with the toggle gone.
  // The flag itself is also cleared so restarting the session never revives a
  // stale focus state the user had no visible toggle for.
  const focusModeActive = focusMode && view === "terminal";
  useEffect(() => {
    if (view !== "terminal") {
      setFocusMode(false);
      return;
    }
    if (!focusModeActive) {
      return;
    }
    document.body.setAttribute("data-session-focus-mode", "");
    return () => document.body.removeAttribute("data-session-focus-mode");
  }, [focusModeActive, view]);

  // 5. The chrome row (tabs + status + bell) is always rendered. The terminal
  //    toolbar actions only make sense against a live terminal, so they are
  //    gated on the terminal view.
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Single chrome row: session tabs on the left, session actions on the right */}
      <SessionTabs
        activeSessionId={id}
        trailing={
          <>
            <SessionStatusBadge status={session?.status} />
            <SessionNotificationBell />
            {view === "terminal" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      title={t("nav.history")}
                      aria-label={t("nav.history")}
                    >
                      <History className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setOutputHistoryOpen(true)}>
                      {t("terminal.historyOutput")}
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/history?sessionId=${id}`}>{t("sessions.snapshotHistory")}</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setFocusMode((current) => !current)}
                  title={focusMode ? t("sessions.exitFocusMode") : t("sessions.focusMode")}
                  aria-label={focusMode ? t("sessions.exitFocusMode") : t("sessions.focusMode")}
                >
                  {focusMode ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
                <div className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => stopMutation.mutate()}
                  disabled={stopMutation.isPending}
                  title={stopMutation.isPending ? t("sessions.stopping") : t("common.stop")}
                  aria-label={stopMutation.isPending ? t("sessions.stopping") : t("common.stop")}
                >
                  <Square className="size-4" />
                </Button>
              </>
            )}
          </>
        }
      />

      {session && (view !== "terminal" || !focusMode) && <SessionSummaryPanel sessionId={id} />}
      {view === "terminal" ? (
        <div className={focusMode ? "grid min-h-0 flex-1 grid-cols-1 overflow-hidden" : "grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]"}>
          <div className="h-full min-h-0 overflow-hidden">
            <TerminalView
              sessionId={id}
              authToken={authToken}
              attachToken={attachToken}
              aiTool={session?.aiTool}
              historyOpen={outputHistoryOpen}
              onHistoryClose={() => setOutputHistoryOpen(false)}
              credentialsPending={!hasAttachToken}
            />
          </div>
          {!focusMode && (
            <SessionSidePanel
              projectId={session?.projectId}
              session={session}
              taskPacket={sessionTaskPacket}
              taskPacketError={taskPacketError}
              taskPacketFetching={isTaskPacketFetching}
            />
          )}
        </div>
      ) : view === "preparing" ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("sessions.preparing")}
        </div>
      ) : (
        <SessionProblemBody
          title={problem?.title ?? t("sessions.cannotOpen")}
          message={problem?.message ?? ""}
          {...(problem?.hint ? { hint: problem.hint } : {})}
          {...(problem?.tone ? { tone: problem.tone } : {})}
          {...(problem?.action ? { action: problem.action } : {})}
        />
      )}
    </div>
  );
}

interface ProblemView {
  title: string;
  message: string;
  hint?: string;
  tone?: "destructive" | "warning" | "muted";
  action?: React.ReactNode;
}

/**
 * Terminal-less state card rendered inside the always-mounted page layout.
 * The session tab strip above it stays visible, so an exited/lost/unreadable
 * session never strands the user: other tabs remain one click away and the
 * card's own action (Start for stopped/lost) or the back link leads onward.
 *
 * Tones: "muted" for expected states (stopped), "warning" for recoverable
 * failures (lost), "destructive" for hard failures (not found, connect
 * failed). The "return to the list and use Connect" hint is opt-in via `hint`
 * — it is only accurate for connect failures, never for deleted sessions
 * (which no longer exist) or the stopped card (which carries its own Start
 * button).
 */
function SessionProblemBody({
  title,
  message,
  hint,
  action,
  tone = "destructive",
}: {
  title: string;
  message: string;
  hint?: string;
  action?: React.ReactNode;
  /** "destructive" for hard failures; "warning" for recoverable states like lost;
   * "muted" for expected, non-error states like a deliberate stop. */
  tone?: "destructive" | "warning" | "muted";
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-1 items-center justify-center">
      <div
        className={cn(
          "max-w-md rounded-lg border p-6 text-center",
          tone === "warning"
            ? "border-amber-500/50 bg-amber-500/10"
            : tone === "muted"
              ? "border-border/70 bg-muted/30"
              : "border-destructive/50 bg-destructive/10"
        )}
      >
        <h2
          className={cn(
            "text-lg font-semibold",
            tone === "warning"
              ? "text-amber-500"
              : tone === "muted"
                ? "text-foreground"
                : "text-destructive"
          )}
        >
          {title}
        </h2>
        {message ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {message} {hint ?? ""}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {action}
          <Button asChild variant="outline" size="sm">
            <Link href="/sessions">{t("sessions.backToSessions")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function SessionSidePanel({
  projectId,
  session,
  taskPacket,
  taskPacketError,
  taskPacketFetching,
}: {
  projectId?: string;
  session?: Session;
  taskPacket: ProjectManagerTaskPacket | null;
  taskPacketError: unknown;
  taskPacketFetching: boolean;
}) {
  return (
    <aside className="hidden min-h-0 overflow-auto border-t border-border bg-background/95 p-3 lg:block lg:border-l lg:border-t-0">
      <div className="space-y-3">
        <SessionTaskPacketPanel
          error={taskPacketError}
          isFetching={taskPacketFetching}
          session={session}
          taskPacket={taskPacket}
        />
        {session?.aiTool ? (
          <ProviderQuotaPanel aiTool={session.aiTool} />
        ) : null}
        {projectId ? (
          <GitChangesPanel projectId={projectId} />
        ) : null}
      </div>
    </aside>
  );
}

function SessionTaskPacketPanel({
  error,
  isFetching,
  session,
  taskPacket,
}: {
  error: unknown;
  isFetching: boolean;
  session?: Session;
  taskPacket: ProjectManagerTaskPacket | null;
}) {
  const { t } = useLanguage();

  if (error) {
    return (
      <section className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <ClipboardList className="size-4" />
          {t("sessions.taskPacketHandoff")}
        </div>
        <p className="mt-2 text-xs text-destructive">
          {t("sessions.taskPacketLoadFailed")}
        </p>
      </section>
    );
  }

  if (!taskPacket) {
    if (!isFetching) return null;
    return (
      <section className="rounded-lg border border-border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardList className="size-4 text-muted-foreground" />
          {t("sessions.taskPacketHandoff")}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("sessions.taskPacketLoading")}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border p-3" data-testid="session-task-packet-handoff">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <ClipboardList className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{t("sessions.taskPacketHandoff")}</span>
        </div>
        <Badge variant={taskPacketQueueBadgeVariant(taskPacket.queueStatus)}>
          {taskPacketQueueLabel(taskPacket.queueStatus, t)}
        </Badge>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {t("sessions.taskPacketHandoffDescription")}
      </p>
      <div className="mt-3">
        <SessionTaskPacketDatum label={t("sessions.taskPacketWorkItem")} value={taskPacket.title} />
      </div>
      {taskPacket.prompt.trim() ? (
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground">
            {t("sessions.taskPacketPrompt")}
          </summary>
          <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/20 p-2 text-xs leading-5">
            {taskPacket.prompt}
          </pre>
        </details>
      ) : null}
      {taskPacket.acceptanceCriteria.length > 0 ? (
        <SessionTaskPacketList
          title={t("sessions.taskPacketAcceptanceCriteria")}
          values={taskPacket.acceptanceCriteria}
        />
      ) : null}
      {taskPacket.expectedVerification.length > 0 ? (
        <SessionTaskPacketList
          title={t("sessions.taskPacketExpectedVerification")}
          values={taskPacket.expectedVerification}
        />
      ) : null}
      {taskPacket.evidenceRequirements.length > 0 ? (
        <SessionTaskPacketList
          title={t("sessions.taskPacketEvidenceRequirements")}
          values={taskPacket.evidenceRequirements}
        />
      ) : null}
      <Button asChild variant="outline" size="sm" className="mt-3 w-full justify-start">
        <Link href={sessionTaskPacketProjectManagerHref(taskPacket)}>
          <ExternalLink className="mr-2 size-3" />
          {t("sessions.taskPacketOpenWorkItem")}
        </Link>
      </Button>
      {session && (
        <SessionHandoffDialog session={session} taskPacket={taskPacket} />
      )}
    </section>
  );
}

function SessionHandoffDialog({
  session,
  taskPacket,
}: {
  session: Session;
  taskPacket: ProjectManagerTaskPacket;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  // Notes live in the panel-scoped dialog component so they survive closing
  // and reopening the dialog; they are still not persisted server-side.
  const [operatorNotes, setOperatorNotes] = useState("");
  const [verificationNotes, setVerificationNotes] = useState("");
  const [openReviewItems, setOpenReviewItems] = useState("");
  const [exportActionError, setExportActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString());
  const exportInput = useMemo(() => ({
    generatedAt,
    openReviewItems,
    operatorNotes,
    session,
    taskPacket,
    verificationNotes,
  }), [generatedAt, openReviewItems, operatorNotes, session, taskPacket, verificationNotes]);
  const auditIssues = useMemo(
    () => auditSessionHandoffExportInput(exportInput),
    [exportInput]
  );
  const markdown = useMemo(
    () => auditIssues.length === 0 ? buildSessionHandoffMarkdown(exportInput) : "",
    [auditIssues.length, exportInput]
  );

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setExportActionError(null);
    } catch {
      setCopied(false);
      setExportActionError(t("sessions.handoffCopyFailed"));
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([`${markdown}\n`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sessionHandoffMarkdownFilename(exportInput);
    anchor.click();
    URL.revokeObjectURL(url);
    setExportActionError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setGeneratedAt(new Date().toISOString());
        }
        setOpen(nextOpen);
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={() => setOpen(true)}
      >
        <FileText className="mr-2 size-3" />
        {t("sessions.handoffGenerate")}
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="session-handoff-export">
        <DialogHeader>
          <DialogTitle>{t("sessions.handoffExport")}</DialogTitle>
          <DialogDescription>{t("sessions.handoffExportDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <SessionHandoffTextField
            label={t("sessions.handoffOperatorNotes")}
            value={operatorNotes}
            onChange={setOperatorNotes}
          />
          <SessionHandoffTextField
            label={t("sessions.handoffVerificationNotes")}
            value={verificationNotes}
            onChange={setVerificationNotes}
          />
          <SessionHandoffTextField
            label={t("sessions.handoffOpenReviewItems")}
            value={openReviewItems}
            onChange={setOpenReviewItems}
          />
        </div>
        {auditIssues.length > 0 ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2">
            <div className="text-xs font-medium text-destructive">{t("sessions.handoffAuditBlocked")}</div>
            <ul className="mt-2 space-y-1">
              {auditIssues.map((issue) => (
                <li key={issue} className="text-xs text-destructive">
                  {t(handoffAuditIssueKey(issue))}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-md border border-border/70 bg-muted/10 p-2">
            <div className="text-xs font-medium">{t("sessions.handoffMarkdownReady")}</div>
            <Textarea
              className="mt-2 max-h-72 min-h-40 font-mono text-xs"
              readOnly
              value={markdown}
            />
          </div>
        )}
        <DialogFooter>
          {exportActionError && <span className="mr-auto text-xs text-destructive">{exportActionError}</span>}
          <Button type="button" variant="outline" size="sm" onClick={() => void copyMarkdown()} disabled={auditIssues.length > 0}>
            <Copy className="mr-2 size-3" />
            {copied ? t("sessions.handoffCopied") : t("sessions.handoffCopy")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={downloadMarkdown} disabled={auditIssues.length > 0}>
            <Download className="mr-2 size-3" />
            {t("sessions.handoffDownload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionHandoffTextField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Textarea
        className="min-h-20 text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SessionTaskPacketDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/10 px-2 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-mono text-xs">{value}</div>
    </div>
  );
}

function SessionTaskPacketList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="mt-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <ul className="mt-1 space-y-1">
        {values.map((value) => (
          <li key={value} className="break-words rounded-md border border-border/70 bg-muted/10 px-2 py-1 text-xs">
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function taskPacketQueueBadgeVariant(status: ProjectManagerTaskPacketQueueStatus) {
  if (status === "completed") return "default";
  if (status === "blocked") return "destructive";
  if (status === "running" || status === "waiting_for_review") return "secondary";
  return "outline";
}

function taskPacketQueueLabel(status: ProjectManagerTaskPacketQueueStatus, t: ReturnType<typeof useLanguage>["t"]) {
  const labels: Record<ProjectManagerTaskPacketQueueStatus, Parameters<typeof t>[0]> = {
    planned: "sessions.taskPacketQueuePlanned",
    running: "sessions.taskPacketQueueRunning",
    waiting_for_review: "sessions.taskPacketQueueWaitingForReview",
    blocked: "sessions.taskPacketQueueBlocked",
    completed: "sessions.taskPacketQueueCompleted",
    cancelled: "sessions.taskPacketQueueCancelled",
  };
  return t(labels[status]);
}

function handoffAuditIssueKey(issue: SessionHandoffAuditIssue): Parameters<ReturnType<typeof useLanguage>["t"]>[0] {
  const labels: Record<SessionHandoffAuditIssue, Parameters<ReturnType<typeof useLanguage>["t"]>[0]> = {
    operator_notes_required: "sessions.handoffAuditOperatorNotesRequired",
    verification_notes_required: "sessions.handoffAuditVerificationNotesRequired",
    secret_like_value: "sessions.handoffAuditSecretLikeValue",
    placeholder_text: "sessions.handoffAuditPlaceholderText",
    raw_terminal_dump: "sessions.handoffAuditRawTerminalDump",
  };
  return labels[issue];
}

function SessionStatusBadge({ status }: { status?: string }) {
  const { t } = useLanguage();
  const normalizedStatus = normalizeSessionStatus(status);
  if (normalizedStatus === "running") {
    return (
      <Badge variant="default" className="gap-1.5 bg-green-600 hover:bg-green-600">
        <span className="size-1.5 rounded-full bg-white motion-safe:animate-pulse" />
        {t("sessions.running")}
      </Badge>
    );
  }
  if (normalizedStatus === "error") {
    return <Badge variant="destructive">{t("sessions.error")}</Badge>;
  }
  if (normalizedStatus === "lost") {
    return (
      <Badge className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600">
        {t("sessions.lost")}
      </Badge>
    );
  }
  return <Badge variant="secondary">{t("sessions.stopped")}</Badge>;
}
