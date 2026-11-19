"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AssistantRail,
  StreamingMessage,
  ThinkingSection,
} from "@/components/copilot/copilot-message-primitives";
import { CopilotApproval } from "@/components/copilot/CopilotApproval";
import { useLanguage } from "@/hooks/use-language";
import type { ActiveCopilotRun } from "@/hooks/use-copilot";
import type { TerminalCommandProgress } from "@/hooks/use-terminal-command-progress";
import { copilotPhaseLabel } from "@/lib/copilot-phase";
import { cn } from "@/lib/utils";

interface CopilotActiveRunAreaProps {
  active: ActiveCopilotRun | null;
  syncError: string | null;
  sendFailed: boolean;
  streamingShowsAvatar: boolean;
  terminalProgress: TerminalCommandProgress | null;
  onDecided: () => Promise<void> | void;
  onRetry: () => void;
}

/**
 * Shared live-run region for both the full /copilot console and the floating
 * robot quick-chat panel: error/retry banner, approval card, restrained phase
 * indicator, live thinking strip, streaming markdown body, and terminal
 * command progress card.
 */
export function CopilotActiveRunArea({
  active,
  syncError,
  sendFailed,
  streamingShowsAvatar,
  terminalProgress,
  onDecided,
  onRetry,
}: CopilotActiveRunAreaProps) {
  const { t } = useLanguage();

  const isRunning = Boolean(active && (active.status === "running" || active.status === "pending"));
  const phaseLabel = isRunning ? t(copilotPhaseLabel(active?.phase)) : null;
  const errorMessage = syncError || active?.error;

  const terminalProgressLabel = terminalProgress
    ? {
        running: t("copilot.terminalRunning"),
        completed: t("copilot.terminalCompleted"),
        timed_out: t("copilot.terminalTimedOut"),
        user_took_over: t("copilot.terminalUserTookOver"),
        error: t("copilot.terminalError"),
      }[terminalProgress.status]
    : null;

  return (
    <>
      {errorMessage ? (
        <div
          role="status"
          className="flex items-start justify-between gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive"
        >
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 leading-relaxed [overflow-wrap:anywhere]">
              {errorMessage}
              {!syncError && active?.errorCode ? (
                <span className="ml-1 text-[11px] opacity-75">({active.errorCode})</span>
              ) : null}
            </p>
          </div>
          {sendFailed ? (
            <Button variant="outline" size="sm" className="h-7 shrink-0 border-destructive/30 bg-background/80 text-destructive hover:bg-destructive/10" onClick={onRetry}>
              {t("copilot.retry")}
            </Button>
          ) : null}
        </div>
      ) : sendFailed ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("copilot.retry")}
          </Button>
        </div>
      ) : null}

      {active?.status === "awaiting_approval" &&
        (active.pendingAction ? (
          <CopilotApproval key={active.pendingAction.id} action={active.pendingAction} onDecided={onDecided} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t("copilot.awaitingApproval")}
          </p>
        ))}

      {isRunning && phaseLabel ? (
        <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
          <span className="size-1.5 forgebadger-pulse-dot rounded-full bg-brand" aria-hidden="true" />
          <span>{phaseLabel}</span>
        </div>
      ) : null}

      {active?.thinking ? (
        <AssistantRail>
          <ThinkingSection text={active.thinking} live={isRunning} />
        </AssistantRail>
      ) : null}

      {active?.text ? <StreamingMessage text={active.text} showAvatar={streamingShowsAvatar} /> : null}

      {terminalProgress && terminalProgressLabel ? (
        <Card className="w-full gap-2 p-3 text-xs" data-testid="terminal-command-progress">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                terminalProgress.status === "running"
                  ? "forgebadger-pulse-dot bg-brand"
                  : terminalProgress.status === "error" ||
                      terminalProgress.status === "timed_out" ||
                      terminalProgress.status === "user_took_over"
                    ? "bg-destructive"
                    : "bg-success",
              )}
              aria-hidden="true"
            />
            <span className="shrink-0 font-medium">{terminalProgressLabel}</span>
            <code className="min-w-0 flex-1 truncate text-muted-foreground" title={terminalProgress.command}>
              {terminalProgress.command}
            </code>
          </div>
          {terminalProgress.outputTail ? (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
              {terminalProgress.outputTail}
            </pre>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
