"use client";

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Bot, Brain, Check, ChevronDown, ChevronRight, Copy, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopilotMarkdown, closeOpenMarkdown } from "@/components/copilot/copilot-markdown";
import { ToolCallRow } from "@/components/copilot/copilot-tool-call-row";
import { useLanguage } from "@/hooks/use-language";
import type { Language } from "@/lib/i18n";
import { parseThinkingContent } from "@/lib/parse-thinking";
import type { CopilotMessage } from "@/lib/copilot-api";

/**
 * Shared Copilot message-stream primitives, used by both the full-page console
 * (copilot-chat.tsx) and the robot widget's floating chat panel
 * (robot-chat-panel.tsx), composed into a stream by copilot-message-stream.tsx.
 *
 * Layout: user messages are compact right-aligned accent bubbles; assistant
 * content is plain full-width composition on a single rail — one avatar marker
 * per assistant turn (not per block), with every following block indented to
 * the same text column. Tool calls arrive as slim single-line rows from
 * copilot-tool-call-row.tsx rather than as bordered cards, because a run of
 * calls is process, not answer. Reasoning is a dim collapsible strip.
 * `<think>...</think>` blocks inlined by some providers are split out via
 * parseThinkingContent for both persisted history and live streams.
 *
 * Edit-and-rerun props are optional: surfaces that do not support editing
 * simply omit them and the pencil affordance stays hidden.
 */
export function MessageRow({
  message,
  pairedResult,
  suppressRender,
  showAvatar = true,
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
  /** false on blocks that follow the first of an assistant turn (rail indent). */
  showAvatar?: boolean;
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
  const { t, language } = useLanguage();
  const isUser = message.role === "user";

  // tool_result rows that have been merged into their tool_call row above are
  // suppressed; the merged row already shows the result.
  if (suppressRender) return null;

  // A missing durable result does not prove that a tool is still running;
  // live execution state is shown by the run indicator, not inferred here.
  if (message.kind === "tool_call" || message.kind === "tool_result") {
    return <ToolCallRow message={message} pairedResult={pairedResult} />;
  }
  if (message.kind === "error") {
    return (
      <AssistantRail>
        <div className="flex gap-2 break-words text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{message.content}</span>
        </div>
      </AssistantRail>
    );
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
    const time = formatMessageTime(message.createdAt, language);
    return (
      <div className="forgebadger-animate-in group flex justify-end">
        <div className="relative flex max-w-[75%] flex-col items-end gap-0.5">
          <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-brand-foreground [overflow-wrap:anywhere]">
            {message.content}
          </div>
          {time ? (
            <time dateTime={message.createdAt} className="text-[10px] text-muted-foreground/70">{time}</time>
          ) : null}
          {canEdit && (
            <button
              type="button"
              aria-label={t("copilot.editPrompt")}
              title={t("copilot.editPrompt")}
              onClick={() => onBeginEdit?.(message)}
              className="absolute -left-9 top-1.5 flex size-7 items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground opacity-100 transition-opacity hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return <AssistantBody content={message.content} createdAt={message.createdAt} showAvatar={showAvatar} />;
}

/** Small brand-tinted bot marker that opens an assistant turn. */
export function AssistantAvatar() {
  return (
    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-brand/10">
      <Bot className="size-3.5 text-brand" aria-hidden="true" />
    </span>
  );
}

/**
 * The assistant column: a fixed 24px rail slot (avatar or indent) plus the text
 * column every assistant block aligns to, so tool rows, reasoning strips and
 * the markdown answer share one left edge instead of each starting wherever
 * its own box happens to begin.
 */
export function AssistantRail({ showAvatar = false, children }: { showAvatar?: boolean; children: ReactNode }) {
  return (
    <div className="forgebadger-animate-in flex gap-2.5">
      {showAvatar ? <AssistantAvatar /> : <span aria-hidden="true" className="size-6 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Full-width assistant composition: rail avatar + think strip + markdown. */
function AssistantBody({
  content,
  createdAt,
  showAvatar = true,
  streaming = false,
}: {
  content: string;
  createdAt?: string;
  showAvatar?: boolean;
  streaming?: boolean;
}) {
  const { language } = useLanguage();
  const parsed = parseThinkingContent(content);
  // While tokens are still arriving, close obviously unfinished markdown
  // (unclosed fences, dangling emphasis) so partial output renders as its
  // final shape instead of flashing raw syntax.
  const bodyText = streaming ? closeOpenMarkdown(parsed.text) : parsed.text;
  const time = !streaming && createdAt ? formatMessageTime(createdAt, language) : "";
  return (
    <AssistantRail showAvatar={showAvatar}>
      <div className="space-y-2.5 text-sm leading-relaxed">
        {parsed.thinking ? (
          <ThinkingSection text={parsed.thinking} live={streaming && parsed.thinkingOpen} />
        ) : null}
        {bodyText ? <CopilotMarkdown content={bodyText} /> : null}
        {streaming ? (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-[1px] bg-foreground/70 align-text-bottom" />
        ) : (
          <AssistantActions content={content} time={time} createdAt={createdAt} />
        )}
      </div>
    </AssistantRail>
  );
}

/** Copy affordance + timestamp under a completed assistant message. */
function AssistantActions({ content, time, createdAt }: { content: string; time: string; createdAt?: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex items-center gap-1.5 pt-0.5">
      <button
        type="button"
        aria-label={copied ? t("copilot.copied") : t("copilot.copy")}
        title={copied ? t("copilot.copied") : t("copilot.copy")}
        onClick={() => {
          void navigator.clipboard?.writeText(content).then(() => setCopied(true));
        }}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>
      {time && createdAt ? (
        <time dateTime={createdAt} className="text-[10px] text-muted-foreground/70">{time}</time>
      ) : null}
    </div>
  );
}

export function StreamingMessage({ text, showAvatar = true }: { text: string; showAvatar?: boolean }) {
  return <AssistantBody content={text} streaming showAvatar={showAvatar} />;
}

/**
 * Collapsible reasoning strip. Streams the model's internal thinking (a
 * separate reasoning channel, or `<think>` blocks inlined into the content)
 * dimmed and folded so the chat is not a wall of text. The collapsed label
 * shows a readable summary (the opening line) instead of a raw character
 * count; very short reasoning falls back to the plain label so no content
 * leaks into the summary. `live` marks a still-open reasoning stream
 * (unterminated `<think>` while tokens are arriving).
 */
export function ThinkingSection({ text, live = false }: { text: string; live?: boolean }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const summary = summarizeThinking(text);
  return (
    <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <Brain className="size-3" />
        {live ? (
          <>
            <span className="size-1.5 animate-pulse rounded-full bg-brand" />
            <span className="font-medium">{t("copilot.thinking")}…</span>
          </>
        ) : summary ? (
          <span className="min-w-0 flex-1 truncate font-medium">{t("copilot.thinkingSummary").replace("{summary}", summary)}</span>
        ) : (
          <span className="font-medium">{t("copilot.thinking")}</span>
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

/** First content line of the reasoning, truncated; "" when it would equal the full text. */
function summarizeThinking(text: string): string {
  const firstLine = (text.split("\n").find((line) => line.trim()) ?? "").trim();
  if (!firstLine || firstLine === text.trim()) return "";
  const max = 60;
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine;
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

/** HH:mm message timestamp in the user's locale; "" for unparseable dates. */
export function formatMessageTime(createdAt: string, language?: Language): string {
  const date = new Date(createdAt);
  if (!createdAt || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(language ?? "zh-CN", { hour: "2-digit", minute: "2-digit" });
}
