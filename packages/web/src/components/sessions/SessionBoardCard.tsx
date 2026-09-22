"use client";

import { MoreHorizontal, RotateCcw, Square, Trash2 } from "lucide-react";

import type { Session, SessionBoardTask } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CliBrandChip } from "@/components/cli-brand-chip";
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
} from "./session-board-utils";

const STATUS_BAR_CLASS: Record<string, string> = {
  running: "bg-emerald-500/80",
  error: "bg-red-500/80",
  stopped: "bg-muted-foreground/30",
};

const VISIBLE_TASKS_PER_CARD = 2;

interface SessionBoardCardProps {
  session: Session;
  tasks: SessionBoardTask[];
  lastPrompt?: string;
  highlight: boolean;
  now: number;
  actionPending: boolean;
  onOpen: (session: Session) => void;
  onStart: (session: Session) => void;
  onStop: (session: Session) => void;
  onDelete: (session: Session) => void;
}

export function SessionBoardCard({
  session,
  tasks,
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
  const picked = pickSessionTitle(session, lastPrompt);
  const relativeTime = formatSessionRelativeTime(session, now, language);
  const visibleTasks = tasks.slice(0, VISIBLE_TASKS_PER_CARD);
  const hiddenTaskCount = tasks.length - visibleTasks.length;

  return (
    <div
      role="link"
      tabIndex={0}
      data-session-id={session.id}
      onClick={() => onOpen(session)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(session);
        }
      }}
      className={cn(
        "group relative cursor-pointer rounded-lg border border-border bg-card p-3 pl-4",
        "transition-all duration-150 hover:border-border/80 hover:shadow-md",
        "motion-safe:hover:-translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        highlight && "forgebadger-session-card-new"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 rounded-l-lg",
          STATUS_BAR_CLASS[normalized]
        )}
      />
      <div className="flex items-center gap-2">
        <SessionStatusDot status={session.status} />
        {session.aiTool ? <CliBrandChip aiTool={session.aiTool} /> : null}
        <SessionStatusText status={session.status} />
        <div className="min-w-0 flex-1" />
        <div
          className={cn(
            "flex items-center transition-opacity duration-150",
            "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${t("common.actions")} · ${picked.title}`}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
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
                <DropdownMenuItem
                  disabled={actionPending}
                  onSelect={() => onStart(session)}
                >
                  <RotateCcw className="size-3.5" />
                  {t("common.start")}
                </DropdownMenuItem>
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
      </div>

      <div
        className={cn(
          "mt-2 text-sm font-medium leading-snug",
          picked.fromPrompt ? "line-clamp-2 break-words" : "truncate"
        )}
        title={picked.title}
      >
        {picked.title}
      </div>
      {picked.showNoInputHint ? (
        <p className="mt-0.5 text-xs italic text-muted-foreground">
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

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs tabular-nums text-muted-foreground">
          {relativeTime ?? t("sessions.noActivity")}
        </span>
      </div>
    </div>
  );
}
