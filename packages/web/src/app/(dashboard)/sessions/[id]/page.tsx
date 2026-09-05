"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Square, ClipboardList, Copy, Download, ExternalLink, History, Maximize2, Minimize2 } from "lucide-react";

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
  getSession,
  listProjectManagerTaskPackets,
  startSession,
  stopSession,
  type ProjectManagerTaskPacket,
  type ProjectManagerTaskPacketQueueStatus,
  type Session,
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import { sessionToTab, upsertSessionTab } from "@/lib/session-tabs";
import { normalizeSessionStatus } from "@/lib/session-status";
import { useLanguage } from "@/hooks/use-language";
import {
  findSessionTaskPacket,
  sessionTaskPacketProjectManagerHref,
} from "@/components/sessions/session-task-packet";
import { GitChangesPanel } from "@/components/sessions/git-changes-panel";
import { ProviderQuotaPanel } from "@/components/sessions/provider-quota-panel";
import { SessionNotificationBell } from "@/components/sessions/session-notification-bell";
import {
  auditSessionHandoffExportInput,
  buildSessionHandoffMarkdown,
  sessionHandoffMarkdownFilename,
  type SessionHandoffAuditIssue,
} from "@/components/sessions/session-handoff-export";
import {
  shouldAutoConnectSession,
  shouldShowSessionPreparing,
} from "@/lib/session-connect-state";

export default function TerminalPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const id = params.id as string;
  const [focusMode, setFocusMode] = useState(false);
  const [outputHistoryOpen, setOutputHistoryOpen] = useState(false);

  const authToken = getToken() ?? "";
  const attachTokenOverride = searchParams.get("attachToken");

  const { data: sessionData } = useQuery({
    queryKey: ["session", id],
    queryFn: () => getSession(id),
    enabled: !!id,
    retry: false,
  });

  const connectMutation = useMutation({
    mutationFn: () => connectSession(id),
    onSuccess: ({ session }) => {
      queryClient.setQueryData(["session", id], { session });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const session = connectMutation.data?.session ?? sessionData?.session;
  const attachToken = attachTokenOverride ?? connectMutation.data?.session.attachToken ?? "";

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
  });

  const stopMutation = useMutation({
    mutationFn: () => stopSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session", id] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const connectSessionMutation = connectMutation.mutate;
  const isConnecting = connectMutation.isPending;
  const connectedSession = connectMutation.data;
  const sessionTaskPacket = findSessionTaskPacket(taskPacketData?.taskPackets ?? [], id);

  useEffect(() => {
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
  ]);

  useEffect(() => {
    if (!session) {
      return;
    }
    upsertSessionTab(sessionToTab(session));
    notifySessionTabsChanged();
  }, [session]);

  // Focus mode gives the terminal the full window width.
  useEffect(() => {
    if (!focusMode) {
      return;
    }
    document.body.setAttribute("data-session-focus-mode", "");
    return () => document.body.removeAttribute("data-session-focus-mode");
  }, [focusMode]);

  const missing: string[] = [];
  if (!authToken) missing.push("login token");
  if (!attachToken) missing.push("attach token");

  if (
    shouldShowSessionPreparing({
      hasAuthToken: authToken.length > 0,
      hasAttachTokenOverride: attachTokenOverride !== null,
      connectStatus: connectMutation.status,
      hasConnectError: connectMutation.isError,
    })
  ) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <SessionFallbackHeader sessionId={id} />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("sessions.preparing")}
        </div>
      </div>
    );
  }

  if (missing.length > 0 || connectMutation.isError) {
    const errorMessage =
      connectMutation.error instanceof Error
        ? connectMutation.error.message
        : `Missing ${missing.join(" and ")}`;
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <SessionFallbackHeader sessionId={id} />
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
            <h2 className="text-lg font-semibold text-destructive">
              {t("sessions.cannotOpen")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {errorMessage}. {t("sessions.returnToList")}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {session && session.status !== "running" && (
                <Button
                  size="sm"
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                >
                  {t("common.start")}
                </Button>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/sessions">
                  {t("sessions.backToSessions")}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings">
                  {t("sessions.openSettings")}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Single chrome row: session tabs on the left, session actions on the right */}
      <SessionTabs
        activeSessionId={id}
        trailing={
          <>
            <SessionStatusBadge status={session?.status} />
            <SessionNotificationBell />
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
        }
      />

      <div className={focusMode ? "grid min-h-0 flex-1 grid-cols-1 overflow-hidden" : "grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]"}>
        <div className="h-full min-h-0 overflow-hidden">
          <TerminalView
            sessionId={id}
            authToken={authToken}
            attachToken={attachToken}
            historyOpen={outputHistoryOpen}
            onHistoryClose={() => setOutputHistoryOpen(false)}
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
    </div>
  );
}

function SessionFallbackHeader({ sessionId }: { sessionId: string }) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/sessions">
            <ArrowLeft className="size-4" />
            {t("sessions.back")}
          </Link>
        </Button>
        <span className="truncate text-sm font-medium">Session {sessionId}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SessionNotificationBell />
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
      <div className="mt-3 space-y-2">
        <SessionTaskPacketDatum label={t("sessions.taskPacketWorkItem")} value={taskPacket.title} />
        <SessionTaskPacketDatum label={t("sessions.taskPacketRuntime")} value={`${taskPacket.runtime.adapter} / ${taskPacket.runtime.templateId}`} />
        <SessionTaskPacketDatum
          label={t("sessions.taskPacketLinkedSession")}
          value={taskPacket.sessionLink
            ? `${taskPacket.sessionLink.sessionId} / ${taskPacket.sessionLink.status}`
            : "-"}
        />
      </div>
      <div className="mt-3">
        <div className="text-xs text-muted-foreground">{t("sessions.taskPacketPrompt")}</div>
        <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/20 p-2 text-xs leading-5">
          {taskPacket.prompt}
        </pre>
      </div>
      <SessionTaskPacketList
        title={t("sessions.taskPacketAcceptanceCriteria")}
        values={taskPacket.acceptanceCriteria}
      />
      <SessionTaskPacketList
        title={t("sessions.taskPacketExpectedVerification")}
        values={taskPacket.expectedVerification}
      />
      <SessionTaskPacketList
        title={t("sessions.taskPacketEvidenceRequirements")}
        values={taskPacket.evidenceRequirements}
      />
      <Button asChild variant="outline" size="sm" className="mt-3 w-full justify-start">
        <Link href={sessionTaskPacketProjectManagerHref(taskPacket)}>
          <ExternalLink className="mr-2 size-3" />
          {t("sessions.taskPacketOpenWorkItem")}
        </Link>
      </Button>
      {session && (
        <SessionHandoffExportPanel
          session={session}
          taskPacket={taskPacket}
        />
      )}
    </section>
  );
}

function SessionHandoffExportPanel({
  session,
  taskPacket,
}: {
  session: Session;
  taskPacket: ProjectManagerTaskPacket;
}) {
  const { t } = useLanguage();
  const [operatorNotes, setOperatorNotes] = useState("");
  const [verificationNotes, setVerificationNotes] = useState("");
  const [openReviewItems, setOpenReviewItems] = useState("");
  const [exportActionError, setExportActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generatedAt] = useState(() => new Date().toISOString());
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
    <div className="mt-4 border-t border-border/70 pt-3" data-testid="session-handoff-export">
      <div className="text-sm font-medium">{t("sessions.handoffExport")}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {t("sessions.handoffExportDescription")}
      </p>
      <div className="mt-3 space-y-3">
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
        <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-2">
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
        <div className="mt-3 rounded-md border border-border/70 bg-muted/10 p-2">
          <div className="text-xs font-medium">{t("sessions.handoffMarkdownReady")}</div>
          <Textarea
            className="mt-2 min-h-56 font-mono text-xs"
            readOnly
            value={markdown}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyMarkdown()}>
              <Copy className="mr-2 size-3" />
              {copied ? t("sessions.handoffCopied") : t("sessions.handoffCopy")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={downloadMarkdown}>
              <Download className="mr-2 size-3" />
              {t("sessions.handoffDownload")}
            </Button>
            {exportActionError && <span className="text-xs text-destructive">{exportActionError}</span>}
          </div>
        </div>
      )}
    </div>
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
  const { t } = useLanguage();

  return (
    <div className="mt-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      {values.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{t("sessions.taskPacketNoItems")}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {values.map((value) => (
            <li key={value} className="break-words rounded-md border border-border/70 bg-muted/10 px-2 py-1 text-xs">
              {value}
            </li>
          ))}
        </ul>
      )}
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
  return <Badge variant="secondary">{t("sessions.stopped")}</Badge>;
}
