"use client";

import Link from "next/link";
import { MoreHorizontal, Play, RotateCcw, Square, Trash2 } from "lucide-react";

import type { Session, SessionBoardTask, SessionWorkState } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { getCliBrand } from "@/lib/cli-brand";
import { useLanguage } from "@/hooks/use-language";
import { normalizeSessionStatus } from "@/lib/session-status";
import { cn } from "@/lib/utils";
import {
  statusBadgeClassName,
  statusBadgeVariant,
  statusLabel,
} from "@/components/projects/project-manager/utils";
import { SessionStatusDot, SessionStatusText } from "./SessionBoardStatus";
import {
  formatSessionRelativeTime,
  pickSessionTitle,
  shortNativeSessionId,
} from "./session-board-utils";
import type { SessionStartOptions } from "./session-board-utils";

const VISIBLE_TASKS_PER_CARD = 2;

interface SessionBoardCardProps {
  session: Session;
  tasks: SessionBoardTask[];
  workState?: SessionWorkState["state"];
  lastPrompt?: string;
  highlight: boolean;
  now: number | null;
  actionPending: boolean;
  onOpen: (session: Session) => void;
  onStart: (session: Session, options?: SessionStartOptions) => void;
  onStop: (session: Session) => void;
  onDelete: (session: Session) => void;
}

export function SessionBoardCard({
  session,
  tasks,
  workState,
  lastPrompt,
  highlight,
  now,
  actionPending,
  onOpen,
  onStart,
  onStop,
  onDelete,
}: SessionBoardCardProps) {
  const { t, language } = useLanguage();
  const normalized = normalizeSessionStatus(session.status);
  const isRunning = normalized === "running";
  const isWorking = isRunning && workState === "working";
  const picked = pickSessionTitle(session, lastPrompt);
  const redundantProjectTitle =
    picked.showNoInputHint && Boolean(session.projectName) && picked.title === session.projectName;
  const displayTitle = redundantProjectTitle
    ? `${getCliBrand(session.aiTool).label} · #${session.id.slice(0, 6)}`
    : picked.title;
  const relativeTime = now === null ? null : formatSessionRelativeTime(session, now, language);
  const visibleTasks = tasks.slice(0, VISIBLE_TASKS_PER_CARD);
  const hiddenTaskCount = tasks.length - visibleTasks.length;

  return (
    <article
      data-session-id={session.id}
      className={cn(
        "group relative rounded-lg border p-3 pl-3.5",
        "forgebadger-motion-surface",
        "hover:shadow-raised motion-safe:hover:-translate-y-px",
        "has-[a.session-card-link:focus-visible]:ring-2 has-[a.session-card-link:focus-visible]:ring-ring/60",
        isWorking
          ? "border-brand/35 bg-card shadow-card before:pointer-events-none before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-brand hover:border-brand/55"
          : isRunning
            ? "border-border bg-card shadow-card before:pointer-events-none before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-success/80 hover:border-border/90"
            : normalized === "error"
              ? "border-destructive/35 bg-card shadow-card hover:border-destructive/55"
              : normalized === "lost"
                ? "border-warning/35 bg-card/90 shadow-card hover:border-warning/55 hover:bg-card"
                : "border-border/70 bg-card/90 hover:border-border hover:bg-card",
        highlight && "forgebadger-session-card-new"
      )}
    >
      <header className="flex items-center gap-2">
        <SessionStatusDot status={session.status} workState={workState} />
        {session.aiTool ? <CliBrandChip aiTool={session.aiTool} /> : null}
        <SessionStatusText status={session.status} workState={workState} />
        {!isRunning && session.nativeSessionId ? (
          <span
            className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            title={`${t("sessions.nativeSessionBadge")}: ${session.nativeSessionId}`}
          >
            {shortNativeSessionId(session.nativeSessionId)}
          </span>
        ) : null}
        <div className="min-w-0 flex-1" />
        <div
          className={cn(
            "flex items-center gap-0.5 transition-opacity duration-150",
            "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
          )}
        >
          {!isRunning ? (
            <button
              type="button"
              disabled={actionPending}
              aria-label={`${t("common.start")} · ${displayTitle}`}
              title={t("common.start")}
              onClick={() => onStart(session)}
              className="relative z-10 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] hover:bg-brand/12 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-95"
            >
              {normalized === "lost" || normalized === "error" ? (
                <RotateCcw className="size-3.5" aria-hidden="true" />
              ) : (
                <Play className="size-3.5" aria-hidden="true" />
              )}
            </button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${t("common.actions")} · ${displayTitle}`}
              className="relative z-10 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:active:scale-95"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isRunning ? (
                <DropdownMenuItem
                  disabled={actionPending}
                  onSelect={() => onStop(session)}
                >
                  <Square className="size-3.5" />
                  {t("common.stop")}
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem
                    disabled={actionPending}
                    onSelect={() => onStart(session)}
                  >
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
      </header>

      <h3
        className={cn(
          "mt-2 text-sm font-medium leading-snug tracking-tight",
          picked.fromPrompt ? "line-clamp-2 break-words" : "truncate",
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
          className="session-card-link focus-visible:outline-none after:absolute after:inset-0 after:content-['']"
        >
          {displayTitle}
        </Link>
      </h3>
      {picked.showNoInputHint ? (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/75">
          {t("sessions.noInputRecord")}
        </p>
      ) : null}

      {tasks.length > 0 ? (
        <div className="mt-2 space-y-1 border-t border-border/70 pt-2">
          {visibleTasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 rounded-md px-1 py-0.5">
              <Badge
                variant={statusBadgeVariant(task.status)}
                className={cn("shrink-0 px-1.5 text-[10px]", statusBadgeClassName(task.status))}
              >
                {statusLabel(task.status, t)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={task.title}>
                {task.title}
              </span>
            </div>
          ))}
          {hiddenTaskCount > 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t("sessions.moreTasks").replace("{count}", String(hiddenTaskCount))}
            </p>
          ) : null}
        </div>
      ) : null}

      <footer className="mt-2 flex items-center justify-between gap-2">
        <span className="forgebadger-tabular-nums truncate text-xs text-muted-foreground">
          {now === null ? "" : (relativeTime ?? t("sessions.noActivity"))}
        </span>
      </footer>
    </article>
  );
}
