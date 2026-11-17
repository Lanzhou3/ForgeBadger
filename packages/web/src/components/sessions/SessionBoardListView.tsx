"use client";

import Link from "next/link";
import { ArrowUpRight, MoreHorizontal, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import type { Session, SessionBoardTask, SessionWorkState } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { getCliBrand } from "@/lib/cli-brand";
import { useLanguage } from "@/hooks/use-language";
import type { Language } from "@/lib/i18n";
import { sessionTabGroupColor } from "@/lib/session-tabs";
import { normalizeSessionStatus } from "@/lib/session-status";
import { cn } from "@/lib/utils";
import {
  statusBadgeClassName,
  statusBadgeVariant,
  statusLabel,
} from "@/components/projects/project-manager/utils";
import { SessionStatusDot, SessionStatusText } from "./SessionBoardStatus";
import {
  formatColumnStats,
  formatSessionRelativeTime,
  pickSessionTitle,
  shortNativeSessionId,
  type SessionBoardColumnData,
  type SessionStartOptions,
} from "./session-board-utils";

interface SessionBoardListViewProps {
  columns: SessionBoardColumnData[];
  sessionTasks?: Record<string, SessionBoardTask[]>;
  workStates?: ReadonlyMap<string, SessionWorkState>;
  prompts: Record<string, string>;
  now: number | null;
  actionPending: boolean;
  onNewSessionForProject?: (projectId: string, projectName: string) => void;
  onOpenSession: (session: Session) => void;
  onStartSession: (session: Session, options?: SessionStartOptions) => void;
  onStopSession: (session: Session) => void;
  onDeleteSession: (session: Session) => void;
}

/** Compact per-project row list; reuses the board's grouping, ordering, and filters. */
export function SessionBoardListView({
  columns,
  sessionTasks = {},
  workStates,
  prompts,
  now,
  actionPending,
  onNewSessionForProject,
  onOpenSession,
  onStartSession,
  onStopSession,
  onDeleteSession,
}: SessionBoardListViewProps) {
  const { t, language } = useLanguage();
  const router = useRouter();

  return (
    <div className="space-y-4">
      {columns.map((column, columnIndex) => {
        const color = column.unlinked ? null : sessionTabGroupColor(column.projectName);
        return (
          <section
            key={column.key}
            aria-label={column.projectName}
            className="forgebadger-animate-in overflow-hidden rounded-lg border border-border bg-card shadow-card"
            style={{ animationDelay: `${Math.min(columnIndex, 8) * 30}ms` }}
          >
            <header className="flex items-center gap-2 border-b border-border/70 bg-muted/25 px-3 py-2">
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", color ? "" : "bg-muted-foreground/40")}
                style={color ? { backgroundColor: color } : undefined}
              />
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight" title={column.projectName}>
                {column.projectName}
              </h2>
              <span
                className={cn(
                  "forgebadger-tabular-nums shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                  column.runningCount > 0
                    ? "bg-success/10 font-medium text-success"
                    : "bg-muted/60 text-muted-foreground"
                )}
              >
                {formatColumnStats(t("sessions.columnStats"), column.runningCount, column.totalCount)}
              </span>
              {!column.unlinked && column.projectId ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={`${t("projects.newSession")} · ${column.projectName}`}
                    title={`${t("projects.newSession")} · ${column.projectName}`}
                    onClick={() => {
                      const pid = column.projectId ?? "";
                      if (onNewSessionForProject) onNewSessionForProject(pid, column.projectName);
                      else router.push(`/projects/${pid}?tab=sessions`);
                    }}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label={`${t("sessions.openProject")} · ${column.projectName}`}
                    title={`${t("sessions.openProject")} · ${column.projectName}`}
                    onClick={() => router.push(`/projects/${column.projectId ?? ""}`)}
                  >
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </header>
            {column.sessions.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {t("sessions.columnEmpty")}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {column.sessions.map((session) => (
                  <SessionListRow
                    key={session.id}
                    session={session}
                    tasks={sessionTasks[session.id] ?? []}
                    workState={workStates?.get(session.id)?.state}
                    lastPrompt={prompts[session.id]}
                    now={now}
                    actionPending={actionPending}
                    onOpen={onOpenSession}
                    onStart={onStartSession}
                    onStop={onStopSession}
                    onDelete={onDeleteSession}
                    language={language}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface SessionListRowProps {
  session: Session;
  tasks: SessionBoardTask[];
  workState?: SessionWorkState["state"];
  lastPrompt?: string;
  now: number | null;
  actionPending: boolean;
  language: Language;
  onOpen: (session: Session) => void;
  onStart: (session: Session, options?: SessionStartOptions) => void;
  onStop: (session: Session) => void;
  onDelete: (session: Session) => void;
}

function SessionListRow({
  session,
  tasks,
  workState,
  lastPrompt,
  now,
  actionPending,
  language,
  onOpen,
  onStart,
  onStop,
  onDelete,
}: SessionListRowProps) {
  const { t } = useLanguage();
  const normalized = normalizeSessionStatus(session.status);
  const isRunning = normalized === "running";
  const picked = pickSessionTitle(session, lastPrompt);
  const redundantProjectTitle =
    picked.showNoInputHint && Boolean(session.projectName) && picked.title === session.projectName;
  const displayTitle = redundantProjectTitle
    ? `${getCliBrand(session.aiTool).label} · #${session.id.slice(0, 6)}`
    : picked.title;
  const relativeTime = now === null ? null : formatSessionRelativeTime(session, now, language);
  const primaryTask = tasks[0];

  return (
    <article
      data-session-id={session.id}
      className={cn(
        "group relative flex items-center gap-3 px-3 py-2.5 transition-colors",
        "hover:bg-muted/40 has-[a.session-row-link:focus-visible]:bg-muted/40 has-[a.session-row-link:focus-visible]:ring-2 has-[a.session-row-link:focus-visible]:ring-ring/50 has-[a.session-row-link:focus-visible]:ring-inset"
      )}
    >
      <SessionStatusDot status={session.status} workState={workState} />
      {session.aiTool ? <CliBrandChip aiTool={session.aiTool} /> : null}
      <span className="hidden sm:inline-flex">
        <SessionStatusText status={session.status} workState={workState} />
      </span>
      {!isRunning && session.nativeSessionId ? (
        <span
          className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          title={`${t("sessions.nativeSessionBadge")}: ${session.nativeSessionId}`}
        >
          {shortNativeSessionId(session.nativeSessionId)}
        </span>
      ) : null}
      <h3
        className={cn(
          "min-w-0 flex-1 truncate text-sm font-medium",
          !isRunning && normalized === "stopped" ? "text-foreground/85 group-hover:text-foreground" : "text-foreground"
        )}
        title={displayTitle}
      >
        <Link
          href={`/sessions/${session.id}`}
          onClick={(event) => {
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              onOpen(session);
            }
          }}
          className="session-row-link focus-visible:outline-none after:absolute after:inset-0 after:content-['']"
        >
          {displayTitle}
        </Link>
      </h3>
      {primaryTask ? (
        <div className="hidden max-w-48 shrink-0 items-center gap-1.5 lg:flex">
          <Badge
            variant={statusBadgeVariant(primaryTask.status)}
            className={cn("shrink-0 px-1.5 text-[10px]", statusBadgeClassName(primaryTask.status))}
          >
            {statusLabel(primaryTask.status, t)}
          </Badge>
          <span className="truncate text-xs text-muted-foreground" title={primaryTask.title}>
            {primaryTask.title}
          </span>
          {tasks.length > 1 ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">+{tasks.length - 1}</span>
          ) : null}
        </div>
      ) : null}
      <span className="forgebadger-tabular-nums shrink-0 text-xs text-muted-foreground">
        {now === null ? "" : (relativeTime ?? t("sessions.noActivity"))}
      </span>
      {isRunning ? (
        // Hidden below md: on narrow screens the button squeezed the title to
        // zero width, and tapping the row already opens the session.
        <Button
          variant="ghost"
          size="sm"
          className="relative z-10 hidden h-7 shrink-0 px-2 text-xs md:inline-flex"
          onClick={() => onOpen(session)}
        >
          <Play className="size-3.5" />
          {t("common.connect")}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={actionPending}
          className="relative z-10 hidden h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-brand md:inline-flex"
          onClick={() => onStart(session)}
        >
          <RotateCcw className="size-3.5" />
          {t("common.start")}
        </Button>
      )}
      <div className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${t("common.actions")} · ${displayTitle}`}
            className="relative z-10 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isRunning ? (
              <DropdownMenuItem disabled={actionPending} onSelect={() => onStop(session)}>
                <Square className="size-3.5" />
                {t("common.stop")}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem disabled={actionPending} onSelect={() => onStart(session)}>
                  <RotateCcw className="size-3.5" />
                  {t("common.start")}
                </DropdownMenuItem>
                {session.nativeSessionId ? (
                  <DropdownMenuItem
                    disabled={actionPending}
                    onSelect={() => onStart(session, { fresh: true })}
                  >
                    <RotateCcw className="size-3.5" />
                    {t("sessions.startFresh")}
                  </DropdownMenuItem>
                ) : null}
              </>
            )}
            <DropdownMenuItem
              disabled={actionPending}
              className="text-destructive focus:text-destructive"
              onSelect={() => onDelete(session)}
            >
              <Trash2 className="size-3.5" />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
