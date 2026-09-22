"use client";

import { MoreHorizontal, Play, RotateCcw, Square, Trash2 } from "lucide-react";

import type { Session } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { useLanguage } from "@/hooks/use-language";
import type { Language } from "@/lib/i18n";
import { sessionTabGroupColor } from "@/lib/session-tabs";
import { normalizeSessionStatus } from "@/lib/session-status";
import { cn } from "@/lib/utils";
import { SessionStatusDot } from "./SessionBoardStatus";
import {
  formatColumnStats,
  formatSessionRelativeTime,
  pickSessionTitle,
  type SessionBoardColumnData,
} from "./session-board-utils";

interface SessionBoardListViewProps {
  columns: SessionBoardColumnData[];
  prompts: Record<string, string>;
  now: number;
  actionPending: boolean;
  onOpenSession: (session: Session) => void;
  onStartSession: (session: Session) => void;
  onStopSession: (session: Session) => void;
  onDeleteSession: (session: Session) => void;
}

/** Compact per-project row list; reuses the board's grouping, ordering, and filters. */
export function SessionBoardListView({
  columns,
  prompts,
  now,
  actionPending,
  onOpenSession,
  onStartSession,
  onStopSession,
  onDeleteSession,
}: SessionBoardListViewProps) {
  const { t, language } = useLanguage();

  return (
    <div className="space-y-4">
      {columns.map((column, columnIndex) => {
        const color = column.unlinked ? null : sessionTabGroupColor(column.projectName);
        return (
          <section
            key={column.key}
            aria-label={column.projectName}
            className="forgebadger-animate-in overflow-hidden rounded-lg border border-border bg-card"
            style={{ animationDelay: `${columnIndex * 40}ms` }}
          >
            <header className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-3 py-2">
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", color ? "" : "bg-muted-foreground/40")}
                style={color ? { backgroundColor: color } : undefined}
              />
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={column.projectName}>
                {column.projectName}
              </h2>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatColumnStats(t("sessions.columnStats"), column.runningCount, column.totalCount)}
              </span>
            </header>
            {column.sessions.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {t("sessions.columnEmpty")}
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {column.sessions.map((session) => (
                  <SessionListRow
                    key={session.id}
                    session={session}
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
  lastPrompt?: string;
  now: number;
  actionPending: boolean;
  language: Language;
  onOpen: (session: Session) => void;
  onStart: (session: Session) => void;
  onStop: (session: Session) => void;
  onDelete: (session: Session) => void;
}

function SessionListRow({
  session,
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
  const relativeTime = formatSessionRelativeTime(session, now, language);

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
        "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors",
        "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      )}
    >
      <SessionStatusDot status={session.status} />
      {session.aiTool ? <CliBrandChip aiTool={session.aiTool} /> : null}
      <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground md:block" title={session.projectName}>
        {session.projectName}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={picked.title}>
        {picked.title}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {relativeTime ?? t("sessions.noActivity")}
      </span>
      {isRunning ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(session);
          }}
        >
          <Play className="size-3.5" />
          {t("common.connect")}
        </Button>
      ) : null}
      <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${t("common.actions")} · ${picked.title}`}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isRunning ? (
              <DropdownMenuItem disabled={actionPending} onSelect={() => onStop(session)}>
                <Square className="size-3.5" />
                {t("common.stop")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={actionPending} onSelect={() => onStart(session)}>
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
  );
}
