"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Bot,
  Check,
  ChevronDown,
  Flag,
  GitFork,
  GitMerge,
  KanbanSquare,
  PenLine,
  ScanSearch,
  Send,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";

import type {
  CopilotGoal,
  CopilotGoalReviewAttempt,
  CopilotGoalReviewSeverity,
  CopilotGoalTask,
  CopilotGoalTaskTeam,
  CopilotGoalTeam,
} from "@/lib/copilot-api";
import { HUE_CLASSES, type HueId } from "@/lib/hues";
import { cn } from "@/lib/utils";
import {
  bucketOf,
  currentStageIndex,
  deriveTaskFlow,
  type FlowBucket,
  type FlowStage,
  type FlowStageId,
  type TaskFlow,
} from "./goal-task-flow-model";
import { MemberAvatar, memberHue } from "./goal-team-strip";
import { useGoalsCopy } from "./goals-copy";
import "./goal-task-flow.css";

const STAGE_META: Record<FlowStageId, { icon: LucideIcon; hue: HueId }> = {
  write: { icon: PenLine, hue: "sky" },
  verify: { icon: ShieldCheck, hue: "mint" },
  review: { icon: ScanSearch, hue: "iris" },
  integrate: { icon: GitMerge, hue: "gold" },
  pass: { icon: Flag, hue: "mint" },
};

const BUCKET_ORDER: FlowBucket[] = ["done", "team", "lead", "owner", "queued", "stopped"];
const BUCKET_CLASS: Record<FlowBucket, string> = {
  done: "bg-hue-mint",
  team: "bg-brand",
  lead: "bg-hue-iris",
  owner: "bg-brand-accent",
  queued: "bg-muted-foreground/35",
  stopped: "bg-muted-foreground/20",
};

const HOLDER_CLASS: Record<TaskFlow["holder"], string> = {
  member: "bg-brand/12 text-brand",
  reviewer: "bg-hue-iris/12 text-hue-iris",
  lead: "bg-muted text-foreground",
  owner: "bg-brand-accent/12 text-brand-accent",
  queued: "bg-muted text-muted-foreground",
  done: "bg-hue-mint/12 text-hue-mint",
  stopped: "bg-muted text-muted-foreground",
};

const SEVERITY_CLASS: Record<CopilotGoalReviewSeverity, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-hue-coral/15 text-hue-coral",
  medium: "bg-hue-gold/15 text-hue-gold",
  low: "bg-muted text-muted-foreground",
};

interface Props {
  /** The goal this list belongs to; other owners (the fleet board) pass `live` and `projectId` instead. */
  goal?: Pick<CopilotGoal, "status" | "projectId">;
  live?: boolean;
  projectId?: string | null;
  tasks: CopilotGoalTask[];
  team?: CopilotGoalTeam | undefined;
  /** Makes the task description a button, e.g. to open a drawer. */
  onOpenTask?: (task: CopilotGoalTask) => void;
  /** Replaces the "who acts next" sentence (and its colour) for a task. */
  headline?: (task: CopilotGoalTask, flow: TaskFlow) => { text: string; holder?: TaskFlow["holder"] } | null;
  /** Wording overrides for owners whose lead and integration branch have other names (the fleet board). */
  labels?: FlowLabels;
}

export interface FlowLabels {
  lead?: string;
  leadBucket?: string;
  workspaceIntegrated?: string;
  workspacePending?: string;
}

/** The goal's tasks as tracks: one row per task, one node per stage, and a plain sentence for who acts next. */
export function GoalTaskFlow({ goal, live: liveProp, projectId, tasks, team, onOpenTask, headline, labels }: Props) {
  const copy = useGoalsCopy();
  const teamByTask = new Map((team?.tasks ?? []).map((entry) => [entry.taskId, entry]));
  const rows = tasks.map((task) => ({ task, team: teamByTask.get(task.id), flow: deriveTaskFlow(task, teamByTask.get(task.id)) }));
  const live = liveProp ?? goal?.status === "active";
  const boardProjectId = projectId ?? goal?.projectId ?? null;
  return (
    <section aria-label={copy.flowTitle} className={cn("rounded-lg border border-border bg-card", live && "fb-flow-live")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/70 px-4 py-3">
        <h2 className="text-sm font-semibold">{copy.flowTitle}</h2>
        {rows.length > 0 ? <FlowSummary flows={rows.map((row) => row.flow)} leadLabel={labels?.leadBucket} /> : null}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{copy.noTasks}</p>
      ) : (
        <ol className="divide-y divide-border/70">
          {rows.map((row, index) => (
            <TaskRow key={row.task.id} projectId={boardProjectId} task={row.task} team={row.team} roster={team} flow={row.flow} index={index} onOpenTask={onOpenTask} headline={headline} labels={labels} />
          ))}
        </ol>
      )}
    </section>
  );
}

/** One stacked bar: how many tasks sit with whom. */
function FlowSummary({ flows, leadLabel }: { flows: TaskFlow[]; leadLabel?: string | undefined }) {
  const copy = useGoalsCopy();
  const counts = new Map<FlowBucket, number>();
  for (const flow of flows) counts.set(bucketOf(flow), (counts.get(bucketOf(flow)) ?? 0) + 1);
  const present = BUCKET_ORDER.filter((bucket) => counts.get(bucket));
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
      <div className="flex h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        {present.map((bucket) => (
          <span key={bucket} className={cn("h-full transition-[flex-grow] duration-500", BUCKET_CLASS[bucket])} style={{ flexGrow: counts.get(bucket) }} />
        ))}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {present.map((bucket) => (
          <li key={bucket} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn("size-2 rounded-full", BUCKET_CLASS[bucket])} aria-hidden />
            <span className="font-medium tabular-nums text-foreground">{counts.get(bucket)}</span>
            {bucket === "lead" && leadLabel ? leadLabel : copy.flowBuckets[bucket]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function headlineText(copy: ReturnType<typeof useGoalsCopy>, flow: TaskFlow): string {
  if (flow.headline === "writing") return copy.flowWriting(flow.actor ?? copy.workerCopilot);
  if (flow.headline === "reviewing") return copy.flowReviewing(flow.actor ?? "", flow.reviewRound ?? 1);
  return copy.flowHeadlines[flow.headline] ?? flow.headline;
}

function TaskRow({ projectId, task, team, roster, flow, index, onOpenTask, headline, labels }: {
  labels?: FlowLabels | undefined;
  projectId: string | null; task: CopilotGoalTask; team: CopilotGoalTaskTeam | undefined; roster: CopilotGoalTeam | undefined; flow: TaskFlow; index: number;
  onOpenTask: Props["onOpenTask"]; headline: Props["headline"];
}) {
  const copy = useGoalsCopy();
  const [reviewOpen, setReviewOpen] = useState(false);
  const stopped = task.status === "cancelled";
  const workerName = team?.worker ? (team.worker.memberName ?? team.worker.adapter) : null;
  const attempts = team?.review?.attempts ?? [];
  const custom = headline?.(task, flow) ?? null;
  const holder = custom?.holder ?? flow.holder;
  const findingCount = attempts.reduce((total, attempt) => total + attempt.findings.length, 0);
  return (
    <li className={cn("px-4 py-3", stopped && "opacity-60")} data-testid={`goal-task-${task.seq}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <p className="min-w-0 flex-1 basis-64 text-sm">
          <span className="mr-1.5 font-mono text-xs text-muted-foreground">#{task.seq}</span>
          {onOpenTask ? (
            <button type="button" onClick={() => onOpenTask(task)} className={cn("rounded text-left hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand", stopped && "line-through")}>
              {task.description}
            </button>
          ) : (
            <span className={cn(stopped && "line-through")}>{task.description}</span>
          )}
        </p>
        <span className={cn("inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium", HOLDER_CLASS[holder])}>
          {holder === "stopped" ? <Ban className="size-3 shrink-0" aria-hidden /> : null}
          {holder === "lead" ? <Bot className="size-3 shrink-0" aria-hidden /> : null}
          <span className="truncate">{custom?.text ?? headlineText(copy, flow)}</span>
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        {workerName ? (
          <span className="flex shrink-0 items-center gap-1.5 sm:w-28" title={team?.worker?.adapter}>
            <MemberAvatar name={workerName} hue={memberHue(roster, team?.worker?.memberId)} busy={flow.holder === "member"} />
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{workerName}</span>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 sm:w-28">
            <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground"><Bot className="size-3.5" /></span>
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{labels?.lead ?? copy.workerCopilot}</span>
          </span>
        )}
        <Track stages={flow.stages} rowIndex={index} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.verifyCommand ? (
          <>
            <code className="max-w-full truncate rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" title={task.verifyCommand}>
              {copy.verifyCommand}: {task.verifyCommand}
            </code>
            <Chip tone={task.verifiedAt != null && task.verifyExitCode === 0 ? "good" : "muted"} icon={ShieldCheck}>
              {task.verifiedAt != null && task.verifyExitCode === 0 ? copy.verified : copy.unverified}
            </Chip>
          </>
        ) : null}
        {team?.workspace === "own" ? (
          <Chip tone={team.integrated ? "good" : "warn"} icon={team.integrated ? GitMerge : GitFork}>
            {team.integrated ? (labels?.workspaceIntegrated ?? copy.workspaceOwnIntegrated) : (labels?.workspacePending ?? copy.workspaceOwnPending)}
          </Chip>
        ) : null}
        {task.workItemId && projectId ? (
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-foreground"
            title={task.workItemId}
          >
            <KanbanSquare className="size-3" aria-hidden />
            {copy.boardLinked(task.boardStatus ? (copy.boardStatus[task.boardStatus] ?? task.boardStatus) : copy.boardMissing)}
          </Link>
        ) : null}
        {task.dispatchedSessionId ? (
          <Link
            href={`/sessions/${encodeURIComponent(task.dispatchedSessionId)}`}
            className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-foreground"
            title={task.dispatchedSessionId}
          >
            <Send className="size-3" aria-hidden />
            {task.dispatchStatus ? (copy.dispatchStatus[task.dispatchStatus] ?? copy.dispatched) : copy.dispatched}
          </Link>
        ) : null}
        {attempts.length > 0 ? (
          <button
            type="button"
            aria-expanded={reviewOpen}
            onClick={() => setReviewOpen((value) => !value)}
            className="inline-flex items-center gap-1 rounded-full bg-hue-iris/12 px-2 py-0.5 text-[11px] font-medium text-hue-iris transition-colors hover:bg-hue-iris/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <ScanSearch className="size-3" aria-hidden />
            {reviewOpen ? copy.hideFindings : findingCount > 0 ? copy.showFindings(findingCount) : copy.showReview}
            <ChevronDown className={cn("size-3 transition-transform", reviewOpen && "rotate-180")} aria-hidden />
          </button>
        ) : null}
        {stopped ? <span className="text-[11px] text-muted-foreground">{copy.taskCancelled}</span> : null}
      </div>

      {attempts.length > 0 ? (
        <div className="fb-flow-details" data-open={reviewOpen}>
          <div>{reviewOpen ? <ReviewPanel attempts={attempts} roundsLeft={team?.review?.roundsLeft ?? 0} /> : null}</div>
        </div>
      ) : null}

      {task.status === "passes" && task.evidence ? (
        <div className="mt-2 rounded-md bg-muted/40 p-2">
          <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">{copy.evidence}</p>
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
            {task.evidence}
          </pre>
        </div>
      ) : null}
    </li>
  );
}

function Chip({ tone, icon: Icon, children }: { tone: "good" | "warn" | "muted"; icon: LucideIcon; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "good" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        tone === "warn" && "bg-hue-gold/15 text-hue-gold",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {children}
    </span>
  );
}

const TRACK_SLOTS: FlowStageId[] = ["write", "verify", "review", "integrate", "pass"];

/**
 * The stage track. Every row has the same five slots, so a stage sits in the
 * same column for every task and the list reads as a chart; a stage a task
 * does not have is a plain stretch of line. Links take the state of the stage
 * they lead into, so the moving link always points at the work in progress.
 */
export function Track({ stages, rowIndex }: { stages: FlowStage[]; rowIndex: number }) {
  const copy = useGoalsCopy();
  const current = currentStageIndex(stages);
  const linkStateInto = (stage: FlowStage) => (stage.state === "active" ? "active" : stage.state === "todo" ? "todo" : "done");
  return (
    <ol className="flex min-w-0 max-w-2xl flex-1 items-start" aria-label={copy.flowTitle}>
      {TRACK_SLOTS.map((slot, slotIndex) => {
        const index = stages.findIndex((stage) => stage.id === slot);
        if (index < 0) {
          // Pass-through: the line continues toward the next stage this task does have.
          const next = stages.find((stage) => TRACK_SLOTS.indexOf(stage.id) > slotIndex)!;
          return (
            <li key={slot} aria-hidden className="flex min-w-0 flex-1 items-start">
              <span className="fb-flow-link mt-[11px] flex-1" data-state={linkStateInto(next)} />
            </li>
          );
        }
        const stage = stages[index]!;
        const meta = STAGE_META[stage.id];
        const isCurrent = index === current;
        const Icon = stage.state === "failed" ? X : stage.state === "attention" ? AlertTriangle : stage.state === "done" && stage.id !== "pass" ? Check : meta.icon;
        return (
          <li
            key={slot}
            className={cn("fb-flow-enter flex min-w-0 items-start", slotIndex > 0 && "flex-1")}
            style={{ "--fb-flow-i": rowIndex + slotIndex } as CSSProperties}
            aria-current={isCurrent ? "step" : undefined}
          >
            {slotIndex > 0 ? <span className="fb-flow-link mt-[11px] min-w-2 flex-1" data-state={linkStateInto(stage)} aria-hidden /> : null}
            <span className="flex w-10 shrink-0 flex-col items-center gap-1">
              <span
                data-state={stage.state}
                className={cn(
                  "fb-flow-node inline-flex size-6 items-center justify-center rounded-full border",
                  stage.state === "done" && cn("border-transparent", HUE_CLASSES[meta.hue].tile),
                  stage.state === "active" && "border-brand bg-brand text-brand-foreground",
                  stage.state === "failed" && "border-transparent bg-destructive/15 text-destructive",
                  stage.state === "attention" && "border-transparent bg-hue-coral/15 text-hue-coral",
                  stage.state === "todo" && (isCurrent ? "border-foreground/40 bg-card text-foreground" : "border-dashed border-border bg-card text-muted-foreground/60"),
                )}
              >
                <Icon className="size-3" aria-hidden />
              </span>
              <span className={cn("whitespace-nowrap text-[11px] leading-none", stage.state === "todo" && !isCurrent ? "text-muted-foreground/70" : "text-foreground")}>
                {copy.stageLabels[stage.id]}
                <span className="sr-only">: {copy.stageStates[stage.state]}</span>
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ReviewPanel({ attempts, roundsLeft }: { attempts: CopilotGoalReviewAttempt[]; roundsLeft: number }) {
  const copy = useGoalsCopy();
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      {attempts.map((attempt) => (
        <div key={attempt.attempt} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium">{copy.reviewAttempt(attempt.attempt, attempt.reviewer.name)}</p>
            {attempt.verdict ? (
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
                attempt.verdict === "approve" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-hue-coral/15 text-hue-coral")}>
                {copy.reviewVerdicts[attempt.verdict] ?? attempt.verdict}
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {copy.reviewAttemptStatus[attempt.status] ?? attempt.status}
              </span>
            )}
          </div>
          {attempt.summary ? <p className="max-w-prose whitespace-pre-wrap break-words text-xs text-muted-foreground">{attempt.summary}</p> : null}
          {attempt.status === "reported" && attempt.findings.length === 0 ? <p className="text-xs text-muted-foreground">{copy.reviewNoFindings}</p> : null}
          {attempt.findings.length > 0 ? (
            <ul className="space-y-1">
              {attempt.findings.map((finding, index) => (
                <li key={index} className="flex items-start gap-2 rounded bg-card px-2 py-1.5">
                  <span className={cn("mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", SEVERITY_CLASS[finding.severity])}>
                    {copy.reviewSeverity[finding.severity] ?? finding.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    {finding.file ? (
                      <p className="truncate font-mono text-[11px] text-muted-foreground" title={finding.file}>
                        {finding.file}{finding.line != null ? `:${finding.line}` : ""}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words text-xs">{finding.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {attempt.droppedFindings > 0 ? <p className="text-[11px] text-muted-foreground">{copy.reviewDropped(attempt.droppedFindings)}</p> : null}
        </div>
      ))}
      <p className="border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
        {copy.reviewUnverified} {copy.reviewRoundsLeft(roundsLeft)}
      </p>
    </div>
  );
}
