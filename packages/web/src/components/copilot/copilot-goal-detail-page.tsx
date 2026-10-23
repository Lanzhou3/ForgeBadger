"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleHelp,
  FileDiff,
  GitBranch,
  GitMerge,
  KeyRound,
  Loader2,
  Pause,
  Play,
  KanbanSquare,
  Send,
  ShieldCheck,
  Target,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { GoalStatusBadge } from "./goal-status-badge";
import { useGoalsCopy } from "./goals-copy";
import { useUiLocale } from "@/hooks/use-language";
import {
  answerGoal,
  cancelGoal,
  getGoal,
  getGoalDiff,
  mergeGoal,
  pauseGoal,
  resumeGoal,
  type CopilotGoalDiffFile,
  type CopilotGoalTaskStatus,
} from "@/lib/copilot-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const TASK_META: Record<CopilotGoalTaskStatus, { icon: LucideIcon; className: string; key: "taskPending" | "taskInProgress" | "taskPasses" | "taskFailed" | "taskCancelled" }> = {
  pending: { icon: Circle, className: "text-muted-foreground", key: "taskPending" },
  in_progress: { icon: Loader2, className: "animate-spin text-brand", key: "taskInProgress" },
  passes: { icon: CheckCircle2, className: "text-emerald-500", key: "taskPasses" },
  failed: { icon: XCircle, className: "text-destructive", key: "taskFailed" },
  cancelled: { icon: Ban, className: "text-muted-foreground", key: "taskCancelled" },
};

export function CopilotGoalDetailPage({ goalId }: { goalId: string }) {
  const copy = useGoalsCopy();
  const locale = useUiLocale();
  const queryClient = useQueryClient();
  const queryKey = ["copilot", "goals", "detail", goalId] as const;
  // Active goals move (driver re-evaluates, tasks flip): poll while active
  // only; settled goals are static.
  const goalQuery = useQuery({
    queryKey,
    queryFn: () => getGoal(goalId),
    refetchInterval: (query) => query.state.data?.goal.status === "active" ? 8000 : false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["copilot", "goals"] });

  const pauseMutation = useMutation({
    mutationFn: () => pauseGoal(goalId),
    onSuccess: () => void invalidate(),
  });
  const resumeMutation = useMutation({
    mutationFn: () => resumeGoal(goalId),
    onSuccess: () => void invalidate(),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelGoal(goalId),
    onSuccess: () => void invalidate(),
  });
  const answerMutation = useMutation({
    mutationFn: (answer: string) => answerGoal(goalId, answer),
    onSuccess: () => {
      setAnswerText("");
      void invalidate();
    },
  });
  const mergeMutation = useMutation({
    mutationFn: () => mergeGoal(goalId),
    onSuccess: ({ merged, deleted, kept, commit }) => {
      setMergeOpen(false);
      const summary = copy.mergeSucceeded(merged.length, deleted.length, kept.length);
      toast.success(commit ? `${summary} ${copy.mergeCommit(commit.slice(0, 12))}` : summary);
      void invalidate();
      // Merge writes back into the project tree; refresh project-scoped data.
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : copy.mergeFailed),
  });

  const [answerText, setAnswerText] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const diffQuery = useQuery({
    queryKey: ["copilot", "goals", "diff", goalId] as const,
    queryFn: () => getGoalDiff(goalId),
    enabled: diffOpen || mergeOpen,
  });
  const ensureDiff = async () => {
    await queryClient.ensureQueryData({
      queryKey: ["copilot", "goals", "diff", goalId] as const,
      queryFn: () => getGoalDiff(goalId),
    });
  };

  if (goalQuery.isPending) {
    return (
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 pt-16 md:p-6">
        <p role="status" className="text-xs text-muted-foreground">{copy.loading}</p>
      </div>
    );
  }
  if (goalQuery.isError) {
    return (
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 pt-16 md:p-6">
        <BackLink />
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <p>{copy.loadFailed}</p>
          <Button size="sm" variant="outline" onClick={() => void goalQuery.refetch()}>
            {copy.retry}
          </Button>
        </div>
      </div>
    );
  }

  const { goal, tasks, journal, pendingQuestion } = goalQuery.data;
  const sortedTasks = [...tasks].sort((a, b) => a.seq - b.seq);
  // createdAt is epoch ms; numeric sort (localeCompare would TypeError).
  const sortedJournal = [...journal].sort((a, b) => b.createdAt - a.createdAt);
  const actionPending = pauseMutation.isPending || resumeMutation.isPending || cancelMutation.isPending || answerMutation.isPending;
  const actionError = pauseMutation.error ?? resumeMutation.error ?? cancelMutation.error;
  const awaitingUser = Boolean(pendingQuestion);
  const mergeable = goal.status === "completed" || goal.status === "blocked";

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 pt-16 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <BackLink />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
              <Target className="size-5 shrink-0 text-brand" />
              <span className="truncate" title={goal.title}>{goal.title}</span>
            </h1>
            <GoalStatusBadge status={goal.status} />
            {goal.workspace ? (
              <span
                title={goal.workspace.baseCommit ?? undefined}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                <GitBranch className="size-3" aria-hidden />
                {goal.workspace.kind === "worktree" && goal.workspace.branch
                  ? copy.workspaceWorktree(goal.workspace.branch)
                  : copy.workspaceCopy}
              </span>
            ) : null}
            {goal.grants.map((grant) => (
              <span
                key={grant}
                title={copy.grantTooltips[grant] ?? grant}
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400"
              >
                <KeyRound className="size-3" aria-hidden />
                {copy.grantLabels[grant] ?? grant}
              </span>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy.createdAt} {new Date(goal.createdAt).toLocaleString(locale)}
            {goal.completedAt ? ` · ${new Date(goal.completedAt).toLocaleString(locale)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {awaitingUser ? null : goal.status === "active" ? (
            <Button size="sm" variant="outline" disabled={actionPending} onClick={() => pauseMutation.mutate()}>
              <Pause className="size-4" />{copy.pause}
            </Button>
          ) : goal.status === "paused" ? (
            <Button size="sm" variant="outline" disabled={actionPending} onClick={() => resumeMutation.mutate()}>
              <Play className="size-4" />{copy.resume}
            </Button>
          ) : null}
          {mergeable ? (
            <Button
              size="sm"
              disabled={mergeMutation.isPending}
              onClick={() => {
                void ensureDiff().then(() => setMergeOpen(true));
              }}
            >
              <GitMerge className="size-4" />{copy.merge}
            </Button>
          ) : null}
          {goal.status !== "cancelled" && goal.status !== "completed" ? (
            <CancelButton
              pending={actionPending}
              onConfirm={() => cancelMutation.mutate()}
            />
          ) : null}
        </div>
      </header>

      {awaitingUser ? (
        <Card className="border-brand/40 forgebadger-animate-in">
          <CardContent className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CircleHelp className="size-4 shrink-0 text-brand" />
              {copy.questionTitle}
            </h2>
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm">{pendingQuestion}</p>
            <Textarea
              value={answerText}
              onChange={(event) => setAnswerText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (answerText.trim()) answerMutation.mutate(answerText.trim());
                }
              }}
              placeholder={copy.answerPlaceholder}
              aria-label={copy.answerPlaceholder}
              rows={3}
            />
            {answerMutation.isError ? (
              <p role="alert" className="text-sm text-destructive">{copy.answerFailed}</p>
            ) : null}
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={answerMutation.isPending || !answerText.trim()}
                onClick={() => answerMutation.mutate(answerText.trim())}
              >
                {answerMutation.isPending ? copy.loading : copy.answerSubmit}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={mergeOpen}
        title={copy.mergeConfirmTitle}
        description={goal.workspace?.kind === "worktree" && goal.workspace.branch && goal.workspace.targetBranch
          ? copy.mergeConfirmWorktree(diffQuery.data?.files.length ?? 0, goal.workspace.branch, goal.workspace.targetBranch)
          : copy.mergeConfirm(diffQuery.data?.files.length ?? 0)}
        confirmLabel={copy.merge}
        pending={mergeMutation.isPending}
        onOpenChange={setMergeOpen}
        onConfirm={() => mergeMutation.mutate()}
      />

      {goal.blockedReason && !awaitingUser ? (
        <p role="status" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {copy.blockedReason}: {copy.blockedReasons[goal.blockedReason] ?? goal.blockedReason}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError instanceof Error ? actionError.message : copy.loadFailed}
        </p>
      ) : null}

      <Card className="forgebadger-animate-in">
        <CardContent className="space-y-1.5">
          <h2 className="text-sm font-semibold">{copy.spec}</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{goal.spec}</p>
        </CardContent>
      </Card>

      <Card className="forgebadger-animate-in">
        <CardContent className="space-y-2">
          <h2 className="text-sm font-semibold">{copy.tasks}</h2>
          {sortedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.noTasks}</p>
          ) : (
            sortedTasks.map((task) => {
              const meta = TASK_META[task.status];
              const Icon = meta.icon;
              return (
                <div key={task.id} className="rounded-md border border-border/70 bg-card px-3 py-2">
                  <div className="flex items-start gap-2">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", meta.className)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">#{task.seq}</span>
                        {task.description}
                      </p>
                      {task.verifyCommand ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" title={task.verifyCommand}>
                            {copy.verifyCommand}: {task.verifyCommand}
                          </code>
                          {task.verifiedAt != null && task.verifyExitCode === 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                              <ShieldCheck className="size-3" />
                              {copy.verified}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              <ShieldCheck className="size-3" />
                              {copy.unverified}
                            </span>
                          )}
                        </div>
                      ) : null}
                      {task.workItemId && goal.projectId ? (
                        <Link
                          href={`/projects/${encodeURIComponent(goal.projectId)}`}
                          className="mt-1 mr-1 inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-foreground"
                          title={task.workItemId}
                        >
                          <KanbanSquare className="size-3" aria-hidden />
                          {copy.boardLinked(task.boardStatus ? (copy.boardStatus[task.boardStatus] ?? task.boardStatus) : copy.boardMissing)}
                        </Link>
                      ) : null}
                      {task.dispatchedSessionId ? (
                        <Link
                          href={`/sessions/${encodeURIComponent(task.dispatchedSessionId)}`}
                          className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-foreground"
                          title={task.dispatchedSessionId}
                        >
                          <Send className="size-3" aria-hidden />
                          {task.dispatchStatus ? (copy.dispatchStatus[task.dispatchStatus] ?? copy.dispatched) : copy.dispatched}
                        </Link>
                      ) : null}
                      {task.status === "passes" && task.evidence ? (
                        <div className="mt-1.5 rounded bg-muted/40 p-2">
                          <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">{copy.evidence}</p>
                          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                            {task.evidence}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{copy[meta.key]}</span>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <DiffReviewCard
        open={diffOpen}
        onToggle={() => setDiffOpen((v) => !v)}
        query={diffQuery}
      />

      <Card className="forgebadger-animate-in">
        <CardContent className="space-y-2">
          <h2 className="text-sm font-semibold">{copy.journal}</h2>
          {sortedJournal.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.noJournal}</p>
          ) : (
            sortedJournal.map((entry, index) => (
              <div key={entry.id}>
                {index > 0 ? <Separator className="my-2 bg-border/70" /> : null}
                <div className="flex items-start gap-2">
                  <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-sm">{entry.note}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
                      {new Date(entry.createdAt).toLocaleString(locale)}
                      {entry.runId ? ` · ${entry.runId}` : ""}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  const copy = useGoalsCopy();
  return (
    <Link
      href="/copilot/goals"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      {copy.backToList}
    </Link>
  );
}

function CancelButton({ pending, onConfirm }: { pending: boolean; onConfirm: () => void }) {
  const copy = useGoalsCopy();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setOpen(true)}>
        <Ban className="size-4" />{copy.cancel}
      </Button>
      <ConfirmDialog
        open={open}
        title={copy.cancelConfirm}
        description={copy.cancelConfirm}
        confirmLabel={copy.confirm}
        destructive
        pending={pending}
        onOpenChange={setOpen}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </>
  );
}

const DIFF_STATUS_META: Record<CopilotGoalDiffFile["status"], { key: "diffFileAdded" | "diffFileModified" | "diffFileDeleted"; className: string }> = {
  added: { key: "diffFileAdded", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  modified: { key: "diffFileModified", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  deleted: { key: "diffFileDeleted", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

interface DiffQueryState {
  data?: { files: CopilotGoalDiffFile[]; truncated?: boolean };
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

function DiffReviewCard({ open, onToggle, query }: { open: boolean; onToggle: () => void; query: DiffQueryState }) {
  const copy = useGoalsCopy();
  const files = query.data?.files;
  return (
    <Card className="forgebadger-animate-in">
      <CardContent className="space-y-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center gap-1.5 rounded-md text-sm font-semibold hover:text-brand"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <FileDiff className="size-4 shrink-0" />
          {copy.diff}
        </button>
        {open ? (
          query.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <p>{copy.diffLoadFailed}</p>
              <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                {copy.diffRetry}
              </Button>
            </div>
          ) : query.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">{copy.loading}</p>
          ) : (
            <>
              {query.data?.truncated ? (
                <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                  {copy.diffTruncatedBanner}
                </p>
              ) : null}
              {files && files.length > 0 ? (
                files.map((file) => <DiffFileRow key={file.path} file={file} />)
              ) : (
                <p className="text-sm text-muted-foreground">{copy.diffEmpty}</p>
              )}
            </>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function DiffFileRow({ file }: { file: CopilotGoalDiffFile }) {
  const copy = useGoalsCopy();
  const [open, setOpen] = useState(false);
  const meta = DIFF_STATUS_META[file.status];
  return (
    <div className="rounded-md border border-border/70 bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/40"
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>{file.path}</span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.className)}>
          {copy[meta.key]}
        </span>
        {file.truncated ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {copy.diffTruncated}
          </span>
        ) : null}
      </button>
      {open ? <DiffView diff={file.diff} /> : null}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-b-md border-t border-border/70 bg-muted/20 p-2 font-mono text-[11px] leading-relaxed">
      {diff.split("\n").map((line, index) => (
        <div
          key={index}
          className={
            line.startsWith("+") && !line.startsWith("+++")
              ? "whitespace-pre bg-emerald-500/10 px-1"
              : line.startsWith("-") && !line.startsWith("---")
                ? "whitespace-pre bg-red-500/10 px-1"
                : line.startsWith("@@")
                  ? "whitespace-pre bg-muted/40 px-1 text-muted-foreground"
                  : "whitespace-pre px-1"
          }
        >
          {line}
        </div>
      ))}
    </pre>
  );
}
