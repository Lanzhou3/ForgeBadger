"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { MessageRow, AssistantRail, indexToolResults } from "@/components/copilot/copilot-message-primitives";
import { toolStatusOf } from "@/components/copilot/copilot-tool-call-row";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import type { CopilotMessage } from "@/lib/copilot-api";

/**
 * Stream-level composition for a Copilot transcript.
 *
 * A raw message list renders one block per row, so an agent that reads four
 * sessions in a row paints four separate artefacts between the question and the
 * answer — the answer stops being the thing you read. This module groups
 * consecutive tool rows into one process block (a single quiet header plus slim
 * rows), keeps the rest as ordinary messages, and owns the assistant rail
 * avatar so it appears once per assistant turn instead of once per block.
 *
 * Pairing rules are unchanged from the message primitives: a tool_result whose
 * toolCallId has a matching tool_call is folded into that call's row and is not
 * rendered on its own.
 */

export interface CopilotMessageStreamEntryRow {
  message: CopilotMessage;
  pairedResult: CopilotMessage | null;
}

export type CopilotStreamEntry =
  | { kind: "message"; message: CopilotMessage; pairedResult: CopilotMessage | null; showAvatar: boolean }
  | { kind: "tools"; id: string; rows: CopilotMessageStreamEntryRow[]; showAvatar: boolean };

function isToolKind(message: CopilotMessage): boolean {
  return message.kind === "tool_call" || message.kind === "tool_result";
}

/** Group consecutive tool rows; mark which entries open an assistant turn. */
export function buildCopilotStream(messages: CopilotMessage[]): CopilotStreamEntry[] {
  const results = indexToolResults(messages);
  const callIds = new Set(
    messages
      .filter((message) => message.kind === "tool_call" && message.toolCallId)
      .map((message) => message.toolCallId as string)
  );
  const entries: CopilotStreamEntry[] = [];
  let group: Extract<CopilotStreamEntry, { kind: "tools" }> | null = null;

  for (const message of messages) {
    const pairedResult = message.kind === "tool_call" && message.toolCallId
      ? results.get(message.toolCallId) ?? null
      : null;

    // A tool_result that answers a recorded call is shown inside that call's
    // row; rendering it twice is what made transcripts read as duplication.
    // A result whose call is not in the loaded window stays visible on its own
    // — dropping it would silently lose the only record of what ran.
    if (message.kind === "tool_result" && message.toolCallId && callIds.has(message.toolCallId)) {
      continue;
    }

    if (isToolKind(message)) {
      if (group) {
        group.rows.push({ message, pairedResult });
      } else {
        group = { kind: "tools", id: `tools-${message.id}`, rows: [{ message, pairedResult }], showAvatar: false };
        entries.push(group);
      }
      continue;
    }

    group = null;
    entries.push({ kind: "message", message, pairedResult: null, showAvatar: false });
  }

  // The avatar marks a turn, not a block: the first assistant entry after the
  // user (or at the top of the transcript) carries it and the rest indent.
  let assistantOpen = false;
  for (const entry of entries) {
    const isAssistant = entry.kind === "tools" || entry.message.role !== "user";
    entry.showAvatar = isAssistant && !assistantOpen;
    assistantOpen = isAssistant;
  }
  return entries;
}

/** Dull runs fold away; anything failed, denied, or still pending stays visible. */
function shouldStartOpen(rows: CopilotMessageStreamEntryRow[]): boolean {
  if (rows.length < 2) return true;
  return rows.some((row) => toolStatusOf(row) !== "ok");
}

function ToolProcessGroup({
  rows,
  showAvatar,
  isEditing,
  editDraft,
  editError,
  editSubmitting,
  canEdit,
  onBeginEdit,
  onChangeDraft,
  onSubmitEdit,
  onCancelEdit,
}: {
  rows: CopilotMessageStreamEntryRow[];
  showAvatar: boolean;
} & EditProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(() => shouldStartOpen(rows));
  // A run that grows while collapsed reveals its new rows instead of silently
  // updating the count under a chevron the user never opened.
  const seenCount = useRef(rows.length);
  useEffect(() => {
    if (rows.length > seenCount.current) setOpen(true);
    seenCount.current = rows.length;
  }, [rows.length]);
  const collapsible = rows.length > 1;
  const failures = rows.filter((row) => {
    const status = toolStatusOf(row);
    return status === "error" || status === "denied";
  }).length;
  // A folded run names its single tool when every call used the same one, so
  // the header still answers "what ran?" without expanding anything.
  const toolNames = new Set(rows.map((row) => row.message.toolName).filter((name): name is string => Boolean(name)));
  const singleToolName = toolNames.size === 1 ? [...toolNames][0] : null;

  return (
    <AssistantRail showAvatar={showAvatar}>
      {collapsible && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:outline-none"
        >
          <ChevronRight
            className={cn("size-3 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
          <span className="font-medium">{t("copilot.toolProcess")}</span>
          <span aria-hidden className="size-[2px] shrink-0 rounded-full bg-muted-foreground/40" />
          <span className="min-w-0 shrink truncate">
            {t("copilot.toolCallCount").replace("{count}", String(rows.length))}
          </span>
          {!open && singleToolName ? (
            <span className="min-w-0 max-w-[45%] shrink truncate font-mono text-[11px] text-muted-foreground/70" aria-hidden="true">{singleToolName}</span>
          ) : null}
          <span className="flex-1" />
          {!open && failures > 0 ? (
            <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 text-[10px] font-medium text-destructive">
              {failures}
            </span>
          ) : null}
        </button>
      )}
      {(!collapsible || open) && (
        <div className="flex flex-col">
          {rows.map((row) => (
            <MessageRow
              key={row.message.id}
              message={row.message}
              pairedResult={row.pairedResult}
              suppressRender={false}
              isEditing={isEditing(row.message)}
              editDraft={editDraft}
              editError={editError}
              editSubmitting={editSubmitting}
              canEdit={canEdit}
              onBeginEdit={onBeginEdit}
              onChangeDraft={onChangeDraft}
              onSubmitEdit={onSubmitEdit}
              onCancelEdit={onCancelEdit}
            />
          ))}
        </div>
      )}
    </AssistantRail>
  );
}

interface EditProps {
  isEditing: (message: CopilotMessage) => boolean;
  editDraft: string;
  editError: string | null;
  editSubmitting: boolean;
  canEdit: boolean;
  onBeginEdit: (message: CopilotMessage) => void;
  onChangeDraft: (value: string) => void;
  onSubmitEdit: () => void;
  onCancelEdit: () => void;
}

export interface CopilotMessageStreamProps extends EditProps {
  messages: CopilotMessage[];
}

/**
 * Render a whole transcript with the same composition on every Copilot
 * surface (full console and robot widget panel), so grouping and rail
 * alignment cannot drift between them.
 */
export function CopilotMessageStream({
  messages,
  isEditing,
  editDraft,
  editError,
  editSubmitting,
  canEdit,
  onBeginEdit,
  onChangeDraft,
  onSubmitEdit,
  onCancelEdit,
}: CopilotMessageStreamProps) {
  const entries = useMemo(() => buildCopilotStream(messages), [messages]);
  return (
    <div className="flex flex-col gap-5">
      {entries.map((entry) =>
        entry.kind === "tools" ? (
          <ToolProcessGroup
            key={entry.id}
            rows={entry.rows}
            showAvatar={entry.showAvatar}
            isEditing={isEditing}
            editDraft={editDraft}
            editError={editError}
            editSubmitting={editSubmitting}
            canEdit={canEdit}
            onBeginEdit={onBeginEdit}
            onChangeDraft={onChangeDraft}
            onSubmitEdit={onSubmitEdit}
            onCancelEdit={onCancelEdit}
          />
        ) : (
          <MessageRow
            key={entry.message.id}
            message={entry.message}
            pairedResult={entry.pairedResult}
            suppressRender={false}
            showAvatar={entry.showAvatar}
            isEditing={isEditing(entry.message)}
            editDraft={editDraft}
            editError={editError}
            editSubmitting={editSubmitting}
            canEdit={canEdit}
            onBeginEdit={onBeginEdit}
            onChangeDraft={onChangeDraft}
            onSubmitEdit={onSubmitEdit}
            onCancelEdit={onCancelEdit}
          />
        )
      )}
    </div>
  );
}
