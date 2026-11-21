"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { MessageRow, AssistantRail, indexToolResults, toolReceiptKey } from "@/components/copilot/copilot-message-primitives";
import { toolStatusOf } from "@/components/copilot/copilot-tool-call-row";
import { CopilotPlanCard, parseSubmittedPlan, type CopilotPlanActions, type SubmittedPlan } from "@/components/copilot/CopilotPlanCard";
import { CopilotModeProposalCard, EnteredPlanModeRow, parseEnterPlanMode, parseModeProposal } from "@/components/copilot/CopilotModeProposalCard";
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
 * A result with a matching runtime step is folded into its tool call row.
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
  const callKeys = new Set(
    messages
      .filter((message) => message.kind === "tool_call")
      .map(toolReceiptKey)
  );
  const entries: CopilotStreamEntry[] = [];
  let group: Extract<CopilotStreamEntry, { kind: "tools" }> | null = null;

  for (const message of messages) {
    const receiptKey = toolReceiptKey(message);
    const pairedResult = message.kind === "tool_call" && receiptKey
      ? results.get(receiptKey) ?? null
      : null;

    // A tool_result that answers a recorded call is shown inside that call's
    // row; rendering it twice is what made transcripts read as duplication.
    // A result whose call is not in the loaded window stays visible on its own
    // — dropping it would silently lose the only record of what ran.
    if (message.kind === "tool_result" && receiptKey && callKeys.has(receiptKey)) {
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
  return rows.some((row) => row.message.toolName === "submit_plan" || row.message.toolName === "propose_mode_switch" || toolStatusOf(row) !== "ok");
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
  planActions,
  previousPlans,
}: {
  rows: CopilotMessageStreamEntryRow[];
  showAvatar: boolean;
  planActions?: CopilotPlanActions;
  previousPlans?: Map<string, SubmittedPlan>;
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
      <div className="flex flex-col">
        {rows.map((row) => {
          const receipt = row.pairedResult ?? row.message;
          const plan = parseSubmittedPlan(receipt);
          if (plan && receipt.planProposal && receipt.stepId) return (
            <CopilotPlanCard
              key={receipt.id}
              plan={plan}
              stepId={receipt.stepId}
              conversationId={receipt.conversationId}
              proposal={receipt.planProposal}
              previousPlan={receipt.planProposal.previousStepId ? previousPlans?.get(receipt.planProposal.previousStepId) ?? null : null}
              {...planActions}
            />
          );
          const modeProposal = parseModeProposal(receipt);
          if (modeProposal && receipt.modeProposal && receipt.stepId) return (
            <CopilotModeProposalCard
              key={receipt.id}
              proposal={modeProposal}
              stored={receipt.modeProposal}
              stepId={receipt.stepId}
              conversationId={receipt.conversationId}
              busy={planActions?.busy}
              onReceipt={planActions?.onModeReceipt}
            />
          );
          const enteredPlanReason = parseEnterPlanMode(receipt);
          if (enteredPlanReason) return <EnteredPlanModeRow key={receipt.id} reason={enteredPlanReason} />;
          if (collapsible && !open) return null;
          return (
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
          );
        })}
      </div>
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
  planActions?: CopilotPlanActions;
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
  planActions,
}: CopilotMessageStreamProps) {
  const entries = useMemo(() => buildCopilotStream(messages), [messages]);
  const previousPlans = useMemo(() => {
    const plans = new Map<string, SubmittedPlan>();
    for (const message of messages) {
      const plan = parseSubmittedPlan(message);
      if (plan && message.stepId) plans.set(message.stepId, plan);
    }
    return plans;
  }, [messages]);
  return (
    <div className="flex flex-col gap-5">
      {entries.map((entry) =>
        entry.kind === "tools" ? (
          <ToolProcessGroup
            key={entry.id}
            rows={entry.rows}
            showAvatar={entry.showAvatar}
            planActions={planActions}
            previousPlans={previousPlans}
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
