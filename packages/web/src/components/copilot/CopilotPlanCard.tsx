"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, ChevronRight, ClipboardList, GitCompare, MessageSquarePlus } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import { confirmCopilotPlan, type CopilotMessage, type CopilotModeReceipt, type CopilotPlanAction, type CopilotPlanConfirmation } from "@/lib/copilot-api";
import type { TranslationKey } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const todoSchema = z.object({
  title: z.string().trim().min(1).max(256),
  description: z.string().trim().min(1).max(2000).optional(),
  verifyCommand: z.string().trim().min(1).max(512).optional(),
  dependsOn: z.array(z.number().int().min(0)).max(10).optional(),
  files: z.array(z.string().trim().min(1).max(256)).max(20).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  parallelizable: z.boolean().optional(),
  executor: z.enum(["copilot", "delegate", "cli"]).optional(),
}).strict();

const planSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4000),
  constraints: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  todos: z.array(todoSchema).min(1).max(30),
}).strict();

export type SubmittedPlan = z.infer<typeof planSchema>;
type PlanTodo = SubmittedPlan["todos"][number];
const proposalSchema = z.object({ status: z.literal("plan_proposed"), plan: planSchema }).strict();

export function parseSubmittedPlan(message: CopilotMessage): SubmittedPlan | null {
  if (message.kind !== "tool_result" || message.toolName !== "submit_plan" || !message.planProposal) return null;
  try {
    const parsed = proposalSchema.safeParse(JSON.parse(message.content));
    return parsed.success ? parsed.data.plan : null;
  } catch {
    return null;
  }
}

export interface CopilotPlanActions {
  currentProjectId?: string | null;
  modelId?: string | null;
  busy?: boolean;
  onConfirmation?: (confirmation?: CopilotPlanConfirmation) => void;
  /** Send a plan-mode revision request through the normal send path. */
  onRequestChanges?: (feedback: string) => void;
  /** Called after a mode proposal card is accepted or dismissed. */
  onModeReceipt?: (receipt?: CopilotModeReceipt) => void;
}

export interface PlanDiff { added: string[]; removed: string[]; changed: string[] }

/** Compare two plans by TODO title; same-title TODOs with new details count as changed. */
export function diffPlans(previous: SubmittedPlan, next: SubmittedPlan): PlanDiff {
  const before = new Map(previous.todos.map(todo => [todo.title, todo]));
  const after = new Map(next.todos.map(todo => [todo.title, todo]));
  const detail = (todo: PlanTodo) => JSON.stringify([todo.description, todo.verifyCommand, todo.dependsOn, todo.files, todo.risk, todo.executor]);
  return {
    added: [...after.keys()].filter(title => !before.has(title)),
    removed: [...before.keys()].filter(title => !after.has(title)),
    changed: [...after.entries()].filter(([title, todo]) => before.has(title) && detail(before.get(title)!) !== detail(todo)).map(([title]) => title),
  };
}

const RISK_STYLES = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  high: "bg-destructive/10 text-destructive",
} as const;

const chipClass = "inline-flex max-w-full items-center rounded px-1.5 py-px text-[10.5px] leading-4 font-medium";

function TodoMeta({ todo }: { todo: PlanTodo }) {
  const { t } = useLanguage();
  const files = todo.files ?? [];
  const hasMeta = Boolean(todo.dependsOn?.length || files.length || todo.risk || todo.parallelizable || todo.executor);
  if (!hasMeta) return null;
  return (
    <span data-testid="copilot-plan-todo-meta" className="flex flex-wrap items-center gap-1">
      {todo.dependsOn && todo.dependsOn.length > 0 && (
        <span className={cn(chipClass, "bg-muted text-muted-foreground")}>
          {t("copilot.planDependsOn").replace("{n}", todo.dependsOn.map(index => index + 1).join(", #"))}
        </span>
      )}
      {todo.risk && (
        <span className={cn(chipClass, RISK_STYLES[todo.risk])}>
          {t("copilot.planRisk").replace("{level}", t(`copilot.planRisk${todo.risk.charAt(0).toUpperCase()}${todo.risk.slice(1)}` as TranslationKey))}
        </span>
      )}
      {todo.parallelizable && <span className={cn(chipClass, "bg-brand/10 text-brand")}>{t("copilot.planParallel")}</span>}
      {todo.executor && (
        <span className={cn(chipClass, "bg-muted text-muted-foreground")}>
          {t("copilot.planExecutor").replace("{executor}", t(`copilot.planExecutor${todo.executor.charAt(0).toUpperCase()}${todo.executor.slice(1)}` as TranslationKey))}
        </span>
      )}
      {files.slice(0, 2).map(file => (
        <code key={file} title={file} className={cn(chipClass, "max-w-48 truncate bg-muted/70 font-mono text-muted-foreground")}>{file}</code>
      ))}
      {files.length > 2 && (
        <span title={files.slice(2).join("\n")} className={cn(chipClass, "text-muted-foreground")}>
          {t("copilot.planFilesMore").replace("{count}", String(files.length - 2))}
        </span>
      )}
    </span>
  );
}

function RevisionDiff({ diff }: { diff: PlanDiff }) {
  const { t } = useLanguage();
  const groups = ([["copilot.planDiffAdded", diff.added, "+", "text-success"], ["copilot.planDiffRemoved", diff.removed, "−", "text-destructive"], ["copilot.planDiffChanged", diff.changed, "~", "text-amber-700 dark:text-amber-300"]] as const)
    .filter(([, titles]) => titles.length > 0);
  return (
    <div data-testid="copilot-plan-diff" className="space-y-1 border-t border-border/70 bg-muted/25 px-4 py-2.5 text-xs">
      {groups.length === 0 && <p className="text-muted-foreground">{t("copilot.planDiffNone")}</p>}
      {groups.map(([label, titles, mark, tone]) => (
        <div key={label}>
          <p className="text-[11px] font-medium text-muted-foreground">{t(label)}</p>
          <ul className="space-y-0.5">
            {titles.map(title => <li key={title} className="flex gap-1.5 break-words"><span aria-hidden="true" className={cn("font-mono", tone)}>{mark}</span>{title}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface CopilotPlanCardProps extends CopilotPlanActions {
  plan: SubmittedPlan;
  stepId: string;
  conversationId: string;
  proposal: NonNullable<CopilotMessage["planProposal"]>;
  /** The plan this one revises, when it is loaded in the transcript. */
  previousPlan?: SubmittedPlan | null;
}

export function CopilotPlanCard({ plan, stepId, conversationId, proposal, currentProjectId, modelId, busy, onConfirmation, onRequestChanges, previousPlan }: CopilotPlanCardProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const headingId = useId();
  const [unchecked, setUnchecked] = useState<Set<number>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [lastConfirmation, setLastConfirmation] = useState<CopilotPlanConfirmation>();
  const [showDiff, setShowDiff] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const inFlight = useRef(false);
  const outcome = proposal.confirmation ?? lastConfirmation;
  const { projectId } = proposal;
  const targetChanged = currentProjectId !== undefined && currentProjectId !== projectId;
  const selected = plan.todos.flatMap((_, index) => unchecked.has(index) ? [] : [index]);
  const actionsDisabled = Boolean(busy || pending || targetChanged || currentProjectId === undefined || selected.length === 0);

  async function confirm(action: CopilotPlanAction) {
    if (inFlight.current || outcome || actionsDisabled || (action === "save" && !projectId)) return;
    inFlight.current = true;
    setPending(true);
    let confirmed: CopilotPlanConfirmation | undefined;
    try {
      const { confirmation } = await confirmCopilotPlan(conversationId, stepId, {
        action, todoIndexes: selected, ...(modelId && action === "execute" ? { modelId } : {}),
      });
      confirmed = confirmation;
      setLastConfirmation(confirmation);
      if (projectId) void queryClient.invalidateQueries({ queryKey: ["project-manager", projectId] });
      if (confirmation.goalId) {
        void queryClient.invalidateQueries({ queryKey: ["copilot", "goals"] });
        void queryClient.invalidateQueries({ queryKey: ["copilot-goals"] });
      }
    } catch (error) {
      const code = error instanceof GatewayApiError ? error.details?.code : undefined;
      toast.error(t(code === "COPILOT_PLAN_TOO_LONG" ? "copilot.planTooLong"
        : code === "COPILOT_PLAN_SUPERSEDED" ? "copilot.planSupersededToast"
        : code === "COPILOT_PLAN_PROJECT_CHANGED" ? "copilot.planProjectChanged" : "copilot.planActionFailed"));
    } finally {
      inFlight.current = false;
      setPending(false);
      onConfirmation?.(confirmed);
    }
  }

  const superseded = Boolean(proposal.supersededBy) && !outcome;
  const diff = previousPlan ? diffPlans(previousPlan, plan) : null;

  function sendFeedback() {
    const text = feedback.trim();
    if (!text || !onRequestChanges || busy || pending || currentProjectId !== projectId || outcome || superseded) return;
    onRequestChanges(text);
    setFeedback("");
    setRevising(false);
  }

  if (superseded && !expanded) return (
    <section data-testid="copilot-plan-card" data-superseded="true" aria-label={plan.title} className="my-2 min-w-0 rounded-lg border border-border/70 bg-card/50 opacity-70">
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setExpanded(true)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <ClipboardList className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate font-medium text-muted-foreground line-through decoration-muted-foreground/40">{plan.title}</span>
        <span className="ms-auto shrink-0 rounded bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground">{t("copilot.planSuperseded")}</span>
      </button>
    </section>
  );

  return (
    <section
      data-testid="copilot-plan-card"
      data-superseded={superseded ? "true" : undefined}
      aria-labelledby={headingId}
      aria-busy={Boolean(pending)}
      className={cn("my-2 min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm", superseded && "opacity-70")}
    >
      <header className="space-y-2 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-300">
            <ClipboardList className="size-3.5" aria-hidden="true" /> {t("copilot.planCardBadge")}
          </span>
          {proposal.previousStepId && (diff ? (
            <button
              type="button"
              aria-expanded={showDiff}
              onClick={() => setShowDiff(value => !value)}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <GitCompare className="size-3" aria-hidden="true" /> {t("copilot.planRevised")}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <GitCompare className="size-3" aria-hidden="true" /> {t("copilot.planRevised")}
            </span>
          ))}
          {superseded && <span className="rounded bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground">{t("copilot.planSuperseded")}</span>}
        </div>
        <h3 id={headingId} className="text-sm font-semibold break-words">{plan.title}</h3>
        <p className="whitespace-pre-wrap text-xs/relaxed break-words text-muted-foreground">{plan.summary}</p>
      </header>

      {showDiff && diff && <RevisionDiff diff={diff} />}

      {(plan.constraints.length > 0 || plan.acceptanceCriteria.length > 0) && (
        <dl className="grid gap-3 border-t border-border/70 px-4 py-3 text-xs">
          {([
            ["projects.projectManagerConstraints", plan.constraints],
            ["projects.projectManagerAcceptanceCriteria", plan.acceptanceCriteria],
          ] as const).map(([label, values]) => values.length > 0 && (
            <div key={label} className="space-y-1">
              <dt className="font-medium">{t(label)}</dt>
              <dd>
                <ul className="list-disc space-y-0.5 ps-4 break-words text-muted-foreground">
                  {values.map((value, index) => <li key={index}>{value}</li>)}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <ol className="divide-y divide-border/70 border-t border-border/70">
        {plan.todos.map((todo, index) => (
          <li key={index}>
            <label className="flex min-h-11 cursor-pointer items-start gap-2.5 px-4 py-2.5 hover:bg-muted/35 has-disabled:cursor-default">
              <input
                type="checkbox"
                aria-labelledby={`${headingId}-todo-${index}`}
                checked={outcome ? outcome.todoIndexes.includes(index) : !unchecked.has(index)}
                disabled={Boolean(pending || outcome || targetChanged || superseded)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setUnchecked(previous => {
                    const next = new Set(previous);
                    if (checked) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}
                className="mt-0.5 size-4 shrink-0 accent-amber-600 disabled:opacity-60"
              />
              <span className="min-w-0 space-y-1 break-words">
                <span id={`${headingId}-todo-${index}`} className="block text-xs font-medium">{todo.title}</span>
                {todo.description && <span className="block whitespace-pre-wrap text-xs text-muted-foreground">{todo.description}</span>}
                <TodoMeta todo={todo} />
                {todo.verifyCommand && <code className="inline-block max-w-full rounded bg-muted px-1.5 py-0.5 text-[11px] break-all">{todo.verifyCommand}</code>}
              </span>
            </label>
          </li>
        ))}
      </ol>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-3">
        {outcome ? (
          <>
            <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="size-3.5 text-success" aria-hidden="true" />
              {t(outcome.action === "goal" ? "copilot.planGoalCreated" : outcome.action === "execute" ? "copilot.planExecutionStarted" : "copilot.planTasksSaved")}
            </span>
            {outcome.goalId && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/copilot/goals/${encodeURIComponent(outcome.goalId)}`}>
                  {t("copilot.planOpenGoal")} <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            )}
            {outcome.action === "execute" && outcome.goalId && (
              <p className="basis-full text-[11px] text-muted-foreground">{t("copilot.planIsolatedNotice")}</p>
            )}
          </>
        ) : superseded ? (
          <span role="status" className="text-xs text-muted-foreground">{t("copilot.planSuperseded")}</span>
        ) : targetChanged ? (
          <span role="status" className="text-xs text-muted-foreground">{t("copilot.planProjectChanged")}</span>
        ) : (
          <>
            <Button type="button" size="sm" variant="brand" disabled={actionsDisabled} onClick={() => void confirm("execute")}>
              {t("copilot.planActionExecuteNow")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={actionsDisabled} onClick={() => void confirm("goal")}>
              {t("copilot.planActionCreateGoal")}
            </Button>
            <Button type="button" size="sm" variant="ghost" title={!projectId ? t("copilot.planSelectProjectHint") : undefined} disabled={actionsDisabled || !projectId} onClick={() => void confirm("save")}>
              {t("copilot.planActionSaveTasksOnly")}
            </Button>
            {onRequestChanges && (
              <Button type="button" size="sm" variant="ghost" aria-expanded={revising} disabled={Boolean(busy || pending)} onClick={() => setRevising(value => !value)}>
                <MessageSquarePlus className="size-3.5" aria-hidden="true" /> {t("copilot.planRequestChanges")}
              </Button>
            )}
          </>
        )}
      </footer>
      {revising && !outcome && !superseded && currentProjectId === projectId && (
        <div className="space-y-2 border-t border-border/70 px-4 py-3">
          <Textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendFeedback();
              }
            }}
            rows={3}
            maxLength={2000}
            aria-label={t("copilot.planRequestChanges")}
            placeholder={t("copilot.planRequestChangesPlaceholder")}
            className="min-h-16 text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setRevising(false); setFeedback(""); }}>
              {t("copilot.planRequestChangesCancel")}
            </Button>
            <Button type="button" size="sm" variant="brand" disabled={!feedback.trim() || Boolean(busy || pending)} onClick={sendFeedback}>
              {t("copilot.planRequestChangesSend")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
