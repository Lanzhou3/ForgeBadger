"use client";

import { useState } from "react";
import { AlertTriangle, Bot, Brain, CheckCircle2, ChevronDown, ChevronRight, Loader2, Pencil, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopilotMarkdown, closeOpenMarkdown } from "@/components/copilot/copilot-markdown";
import { useLanguage } from "@/hooks/use-language";
import { parseThinkingContent } from "@/lib/parse-thinking";
import type { CopilotMessage, CopilotPendingAction } from "@/lib/copilot-api";

/**
 * Shared Copilot message-stream primitives, used by both the full-page console
 * (copilot-chat.tsx) and the robot widget's floating chat panel
 * (robot-chat-panel.tsx). Layout follows the Linear/v0 floating-assistant
 * pattern: user messages are compact right-aligned accent bubbles, assistant
 * messages are full-width plain composition with a small avatar marker (no
 * bubble), reasoning is a dim collapsible strip. `<think>...</think>` blocks
 * inlined by some providers are split out via parseThinkingContent for both
 * persisted history and live streams.
 *
 * Edit-and-rerun props are optional: surfaces that do not support editing
 * simply omit them and the pencil affordance stays hidden.
 */
export function MessageRow({
  message,
  pairedResult,
  suppressRender,
  isEditing = false,
  editDraft = "",
  editError = null,
  editSubmitting = false,
  canEdit = false,
  onBeginEdit,
  onChangeDraft,
  onSubmitEdit,
  onCancelEdit,
}: {
  message: CopilotMessage;
  pairedResult: CopilotMessage | null;
  suppressRender: boolean;
  isEditing?: boolean;
  editDraft?: string;
  editError?: string | null;
  editSubmitting?: boolean;
  canEdit?: boolean;
  onBeginEdit?: (message: CopilotMessage) => void;
  onChangeDraft?: (value: string) => void;
  onSubmitEdit?: () => void;
  onCancelEdit?: () => void;
}) {
  const { t } = useLanguage();
  const isUser = message.role === "user";

  // tool_result rows that have been merged into their tool_call row above are
  // suppressed; the merged card already shows the result.
  if (suppressRender) return null;

  if (message.kind === "tool_call") {
    const status = pairedResult ? deriveToolStatus(pairedResult.content) : "running";
    return (
      <details className="rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
          <ToolStatusIcon status={status} />
          <Wrench className="size-3" />
          <span>{t("copilot.toolCall")}{message.toolName ? `：${message.toolName}` : ""}</span>
        </summary>
        {message.toolInputJson && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-background p-2 text-[11px]">{message.toolInputJson}</pre>
        )}
        {pairedResult && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-background p-2 text-[11px]">{pairedResult.content}</pre>
        )}
      </details>
    );
  }
  if (message.kind === "tool_result") {
    return (
      <details className="max-w-[85%] rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">
          {t("copilot.toolResult")} — {truncateContent(message.content)}
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-background p-2 text-[11px]">{message.content}</pre>
      </details>
    );
  }
  if (message.kind === "error") {
    return <div className="text-sm text-destructive">{message.content}</div>;
  }

  if (isUser && isEditing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Textarea
          value={editDraft}
          onChange={(event) => onChangeDraft?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void onSubmitEdit?.();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancelEdit?.();
            }
          }}
          className="max-w-[80%] min-h-[80px] resize-y"
          rows={3}
          disabled={editSubmitting}
          autoFocus
        />
        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" onClick={() => void onSubmitEdit?.()} disabled={editSubmitting || !editDraft.trim()}>
            {t("copilot.editSubmit")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onCancelEdit?.()} disabled={editSubmitting}>
            {t("copilot.editCancel")}
          </Button>
          {editError && <span className="text-destructive">{editError}</span>}
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="relative max-w-[85%]">
          <div className="whitespace-pre-wrap rounded-lg bg-brand px-3 py-1.5 text-sm text-brand-foreground">
            {message.content}
          </div>
          {canEdit && (
            <button
              type="button"
              aria-label={t("copilot.editPrompt")}
              title={t("copilot.editPrompt")}
              onClick={() => onBeginEdit?.(message)}
              className="absolute -left-9 top-1.5 hidden size-7 items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 md:flex"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return <AssistantBody content={message.content} />;
}

/** Full-width assistant composition: avatar marker + think strip + markdown. */
function AssistantBody({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const parsed = parseThinkingContent(content);
  // While tokens are still arriving, close obviously unfinished markdown
  // (unclosed fences, dangling emphasis) so partial output renders as its
  // final shape instead of flashing raw syntax.
  const bodyText = streaming ? closeOpenMarkdown(parsed.text) : parsed.text;
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/60">
        <Bot className="size-3.5 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed">
        {parsed.thinking ? (
          <ThinkingSection text={parsed.thinking} live={streaming && parsed.thinkingOpen} />
        ) : null}
        {bodyText ? <CopilotMarkdown content={bodyText} /> : null}
        {streaming ? (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-[1px] bg-foreground/70 align-text-bottom" />
        ) : null}
      </div>
    </div>
  );
}

export function StreamingMessage({ text }: { text: string }) {
  return <AssistantBody content={text} streaming />;
}

/**
 * Collapsible reasoning strip. Streams the model's internal thinking (a
 * separate reasoning channel, or `<think>` blocks inlined into the content)
 * dimmed and folded so the chat is not a wall of text. `live` marks a still-
 * open reasoning stream (unterminated `<think>` while tokens are arriving).
 */
export function ThinkingSection({ text, live = false }: { text: string; live?: boolean }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const chars = text.length;
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/30 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/60"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Brain className="size-3" />
        {live ? (
          <>
            <span className="size-1.5 animate-pulse rounded-full bg-brand" />
            <span className="font-medium">{t("copilot.thinking")}…</span>
          </>
        ) : (
          <span className="font-medium">{t("copilot.thinkingCount").replace("{chars}", String(chars))}</span>
        )}
      </button>
      {open && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-border/60 bg-background/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
          {text}
        </pre>
      )}
    </div>
  );
}

export function PendingActionRow({
  action,
  onDecide,
}: {
  action: CopilotPendingAction;
  onDecide: (approved: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-amber-500/50 text-amber-500">
          {t("copilot.approvalRequired")}
        </Badge>
        <span className="text-sm font-medium">{action.tool}</span>
      </div>
      {action.inputJson && (
        <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-xs">{action.inputJson}</pre>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void onDecide(true)}>
          {t("copilot.approve")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onDecide(false)}>
          {t("copilot.reject")}
        </Button>
      </div>
    </div>
  );
}

/** Pair tool_result rows to their tool_call row by provider toolCallId. */
export function indexToolResults(messages: CopilotMessage[]): Map<string, CopilotMessage> {
  const map = new Map<string, CopilotMessage>();
  for (const message of messages) {
    if (message.kind === "tool_result" && message.toolCallId) {
      map.set(message.toolCallId, message);
    }
  }
  return map;
}

function truncateContent(content: string): string {
  const max = 80;
  return content.length > max ? `${content.slice(0, max)}…` : content;
}

type ToolStatus = "running" | "ok" | "error" | "denied";

function deriveToolStatus(resultContent: string): ToolStatus {
  // The orchestrator prefixes tool_result content so the UI can detect the
  // outcome without re-running security-policy or error parsing. Anything
  // else (real tool JSON output) is treated as a successful read.
  if (/^Denied by security policy:/u.test(resultContent)) return "denied";
  if (/^Tool error:/u.test(resultContent) || /^Unknown tool:/u.test(resultContent)) return "error";
  return "ok";
}

function ToolStatusIcon({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return <Loader2 className="size-3 animate-spin text-muted-foreground" aria-label="running" />;
  }
  if (status === "ok") {
    return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" aria-label="ok" />;
  }
  // denied + error both surface as a warning; color is uniform because the
  // text body is the authoritative explanation.
  return <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400" aria-label={status} />;
}
