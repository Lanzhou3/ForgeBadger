"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, XCircle } from "lucide-react";

import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import type { CopilotMessage } from "@/lib/copilot-api";

/**
 * One tool call as a quiet single-line disclosure row.
 *
 * Transcripts that render every call as its own bordered card turn a run of
 * five identical reads into five boxes and bury the answer that follows (the
 * pattern this replaces). The row is therefore one 24px line — leading state
 * glyph, tool name, `·`, one-line argument/result summary, chevron — and the
 * raw payloads only mount after a click. Consecutive rows are stacked by
 * `ToolProcessGroup` (copilot-message-stream.tsx), which owns the rail avatar
 * and the collapse-everything-dull affordance.
 */

export type ToolStatus = "unknown" | "ok" | "error" | "denied";

/**
 * The orchestrator prefixes tool_result content so the UI can detect the
 * outcome without re-running security-policy or error parsing. Anything else
 * (real tool JSON output) counts as a successful read.
 */
const DENIED_OUTCOMES =
  /^(?:Denied by security policy:|Action rejected by owner|Tool disabled by owner:|Scheduled runs are read only)/u;
const FAILED_OUTCOMES =
  /^(?:Tool error:|Unknown tool:|Invalid tool input|Tool input digest mismatch)/u;

export function deriveToolStatus(resultContent: string | null | undefined): ToolStatus {
  if (!resultContent) return "unknown";
  if (DENIED_OUTCOMES.test(resultContent)) return "denied";
  if (FAILED_OUTCOMES.test(resultContent)) return "error";
  return "ok";
}

// Semantic status colors: emerald = healthy, amber = needs attention (denied /
// owner action), destructive = failed, muted = unknown.
const STATUS_ICON_STYLES: Record<ToolStatus, string> = {
  unknown: "text-muted-foreground/60",
  ok: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  denied: "text-amber-600 dark:text-amber-400",
};

/** Exported for the process header, which summarizes mixed outcomes. */
export function toolStatusOf(row: { message: CopilotMessage; pairedResult: CopilotMessage | null }): ToolStatus {
  return row.message.kind === "tool_call" || row.message.kind === "tool_result"
    ? deriveToolStatus(row.pairedResult?.content ?? (row.message.kind === "tool_result" ? row.message.content : null))
    : "unknown";
}

function ToolStatusIcon({ status }: { status: ToolStatus }) {
  const Icon = status === "ok"
    ? CheckCircle2
    : status === "error"
      ? XCircle
      : status === "denied"
        ? AlertTriangle
        : CircleHelp;
  return (
    <span className={cn("flex size-3.5 shrink-0 items-center justify-center", STATUS_ICON_STYLES[status])} role="img" aria-label={status}>
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  );
}

/** Argument keys worth surfacing on the collapsed row, most specific first. */
const SUMMARY_KEYS = [
  "path", "filePath", "file_path", "file", "pattern", "query", "command", "cmd",
  "sessionId", "session_id", "projectId", "project_id", "goalId", "taskId",
  "url", "name", "title", "id", "limit", "lines", "model",
];

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") return truncate(value.replace(/\s+/gu, " ").trim(), 56);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return "";
}

/**
 * `key=value · key=value` from the call's argument JSON, favoring the keys a
 * human reads first (path / query / command / id) over the rest. Falls back to
 * the first line of the result when the call carried no arguments, so a row
 * always says *something* about what it did.
 */
export function summarizeToolCall(message: CopilotMessage, result: CopilotMessage | null): string {
  const args = parseToolInput(message.toolInputJson);
  if (args) {
    const entries = Object.entries(args);
    const preferred = entries.filter(([key]) => SUMMARY_KEYS.includes(key));
    const parts: string[] = [];
    for (const [key, value] of [...preferred, ...entries.filter(([entryKey]) => !SUMMARY_KEYS.includes(entryKey))]) {
      const text = summarizeValue(value);
      if (!text) continue;
      parts.push(`${key}=${text}`);
      if (parts.length === 2) break;
    }
    if (parts.length > 0) return parts.join(" · ");
  }
  const firstLine = (result?.content ?? (message.kind === "tool_result" ? message.content : ""))
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? truncate(firstLine, 80) : "";
}

function parseToolInput(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Pretty-print argument JSON when it parses; otherwise show the raw string. */
function formatInput(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** One labelled monospace payload section inside the expanded row. */
function PayloadSection({ label, body, error = false }: { label: string; body: string; error?: boolean }) {
  return (
    <section className="min-w-0">
      <div className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground/70">{label}</div>
      <pre
        className={cn(
          "max-h-48 overflow-auto overscroll-contain rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words",
          error ? "text-destructive" : "text-foreground/80"
        )}
      >
        {body}
      </pre>
    </section>
  );
}

export function ToolCallRow({
  message,
  pairedResult,
}: {
  message: CopilotMessage;
  pairedResult: CopilotMessage | null;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const status = deriveToolStatus(pairedResult?.content);
  const resultContent = pairedResult?.content ?? (message.kind === "tool_result" ? message.content : null);
  const input = message.kind === "tool_call" ? message.toolInputJson : undefined;
  const summary = summarizeToolCall(message, pairedResult);
  const expandable = Boolean(input || resultContent);
  const title = message.toolName || (message.kind === "tool_result" ? t("copilot.toolResult") : t("copilot.toolCall"));

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors",
          expandable ? "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none" : "cursor-default"
        )}
      >
        <ToolStatusIcon status={status} />
        <span className="max-w-[45%] shrink-0 truncate font-mono text-[11.5px] font-medium text-foreground/80">{title}</span>
        {summary ? (
          <>
            <span aria-hidden className="size-[2px] shrink-0 rounded-full bg-muted-foreground/40" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">{summary}</span>
          </>
        ) : (
          <span className="flex-1" />
        )}
        {expandable ? (
          <ChevronRight
            className={cn("size-3 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
        ) : null}
      </button>
      {open && expandable && (
        <div className="mt-1 mb-1.5 ml-5 space-y-2 border-l border-border/60 pl-2.5">
          {input ? <PayloadSection label={t("copilot.toolInput")} body={formatInput(input)} /> : null}
          {resultContent ? (
            <PayloadSection label={t("copilot.toolOutput")} body={resultContent} error={status === "error"} />
          ) : null}
        </div>
      )}
    </div>
  );
}
