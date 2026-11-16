"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, GitMerge, KeyRound, Pause, Play, Ship } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fleetKeys, getFleet, getFleetDiff, getFleetTeam, mergeFleet, pauseFleet, resumeFleet, type FleetDetail, type FleetTeam } from "@/lib/fleet-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { DiffReviewCard } from "../copilot/copilot-goal-detail-page";
import { GoalTaskFlow } from "../copilot/goal-task-flow";
import { GoalTeamStrip } from "../copilot/goal-team-strip";
import { useGoalsCopy } from "../copilot/goals-copy";
import { FleetActivity } from "./fleet-activity";
import { FleetBoard } from "./fleet-board";
import { deriveBoard, deriveCard } from "./fleet-board-model";
import { taskSentence, useFleetCopy } from "./fleet-copy";
import { AddTaskDialog, InstructionsCard, MessageFlagshipBox } from "./fleet-forms";
import { FleetTaskDrawer } from "./fleet-task-drawer";

type View = "board" | "flow";

const POLL_MS = 8000;

function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return narrow;
}

const shell = "mx-auto flex h-full w-full max-w-[1500px] flex-col gap-4 overflow-y-auto p-4 pt-16 md:p-6";

export function FleetPage({ fleetId }: { fleetId: string }) {
  const copy = useFleetCopy();
  const detail = useQuery({
    queryKey: fleetKeys.detail(fleetId),
    queryFn: () => getFleet(fleetId),
    refetchInterval: (query) => (query.state.data?.fleet.status === "active" ? POLL_MS : false),
  });
  // Worker, worktree and review state per task; it runs git on the server, so the page still renders when it fails.
  const team = useQuery({
    queryKey: fleetKeys.team(fleetId),
    queryFn: () => getFleetTeam(fleetId),
    refetchInterval: () => (detail.data?.fleet.status === "active" ? POLL_MS : false),
    retry: false,
  });

  if (detail.isPending) {
    return (
      <div className={shell}>
        <p role="status" className="text-xs text-muted-foreground">{copy.loading}</p>
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className={shell}>
        <BackLink />
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <p>{copy.loadFailed}</p>
          <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>{copy.retry}</Button>
        </div>
      </div>
    );
  }
  return <FleetBody fleetId={fleetId} data={detail.data} team={team.data} teamFailed={team.isError} />;
}

function FleetBody({ fleetId, data, team, teamFailed }: {
  fleetId: string; data: FleetDetail; team: FleetTeam | undefined; teamFailed: boolean;
}) {
  const copy = useFleetCopy();
  const goals = useGoalsCopy();
  const queryClient = useQueryClient();
  const narrow = useNarrowScreen();
  const [pickedView, setPickedView] = useState<View | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const { fleet, tasks, journal, timers, pendingEvents, leadActive } = data;
  const live = fleet.status === "active";
  const view: View = pickedView ?? (narrow ? "flow" : "board");

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => a.seq - b.seq), [tasks]);
  const board = useMemo(() => deriveBoard(sortedTasks, team?.tasks), [sortedTasks, team]);
  const selectedTask = selectedId ? sortedTasks.find((task) => task.id === selectedId) : undefined;
  const selected = selectedTask ? deriveCard(selectedTask, team?.tasks.find((entry) => entry.taskId === selectedTask.id)) : null;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: fleetKeys.all });
  const pauseMutation = useMutation({ mutationFn: () => pauseFleet(fleetId), onSuccess: refresh });
  const resumeMutation = useMutation({ mutationFn: () => resumeFleet(fleetId), onSuccess: refresh });
  const diffQuery = useQuery({ queryKey: fleetKeys.diff(fleetId), queryFn: () => getFleetDiff(fleetId), enabled: diffOpen || mergeOpen });
  const mergeMutation = useMutation({
    mutationFn: () => mergeFleet(fleetId),
    onSuccess: ({ merged, deleted, kept, commit, cleanedTaskWorktrees }) => {
      setMergeOpen(false);
      const summary = copy.mergeSucceeded(merged.length, deleted.length, kept.length, cleanedTaskWorktrees ?? 0);
      toast.success(commit ? `${summary} ${copy.mergeCommit(commit.slice(0, 12))}` : summary);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : copy.mergeFailed),
  });

  const sharedWriting = tasks.some((task) => task.dispatchStatus === "running" && team?.tasks.find((entry) => entry.taskId === task.id)?.workspace === "shared");
  const mergeBlock = leadActive ? copy.mergeLeadBusy : sharedWriting ? copy.mergeSharedBusy : fleet.workspace ? null : copy.mergeNoChanges;
  const openMerge = async () => {
    try {
      const diff = await queryClient.fetchQuery({ queryKey: fleetKeys.diff(fleetId), queryFn: () => getFleetDiff(fleetId), staleTime: 0 });
      if (diff.files.length === 0) toast.info(copy.mergeNoChanges);
      else setMergeOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.mergeFailed);
    }
  };

  const held = board.owner.length;
  const done = board.done.filter((card) => !card.cancelled).length;
  const actionPending = pauseMutation.isPending || resumeMutation.isPending;
  const actionError = pauseMutation.error ?? resumeMutation.error;
  const diffData = diffQuery.data;
  const waiting = diffData?.unintegratedTasks?.length ?? 0;
  const mergeBody = fleet.workspace?.branch && fleet.workspace.targetBranch
    ? copy.mergeConfirm(diffData?.files.length ?? 0, fleet.workspace.branch, fleet.workspace.targetBranch)
    : copy.mergeConfirmNoBranch(diffData?.files.length ?? 0);

  return (
    <div className={shell}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <BackLink />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
              <Ship className="size-5 shrink-0 text-brand" aria-hidden />
              <span className="truncate" title={fleet.title}>{fleet.title}</span>
            </h1>
            <StatusPill status={fleet.status} />
            <span className="text-xs text-muted-foreground">{fleet.projectName}</span>
            {fleet.workspace?.branch ? (
              <span title={fleet.workspace.baseCommit ?? undefined} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <GitBranch className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{copy.workspaceBranch(fleet.workspace.branch)}</span>
              </span>
            ) : null}
            {fleet.grants.map((grant) => (
              <span key={grant} title={goals.grantTooltips[grant] ?? grant} className="inline-flex items-center gap-1 rounded-full bg-hue-sky/12 px-2 py-0.5 text-[11px] font-medium text-hue-sky">
                <KeyRound className="size-3" aria-hidden />
                {goals.grantLabels[grant] ?? grant}
              </span>
            ))}
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-full", leadActive ? "bg-brand-accent motion-safe:animate-[forgebadger-pulse-dot_1.4s_ease-in-out_infinite]" : "bg-muted-foreground/40")} />
              {leadActive ? copy.leadRunning : copy.leadIdle}
            </span>
            {pendingEvents > 0 ? <span>{copy.pendingEvents(pendingEvents)}</span> : null}
            <span>{copy.listCounts(tasks.filter((task) => task.status !== "cancelled").length, done)}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {live ? (
            <Button size="sm" variant="outline" disabled={actionPending} onClick={() => pauseMutation.mutate()}>
              <Pause className="size-4" />{copy.pause}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={actionPending} onClick={() => resumeMutation.mutate()}>
              <Play className="size-4" />{copy.resume}
            </Button>
          )}
          <Button size="sm" disabled={mergeMutation.isPending || mergeBlock != null} title={mergeBlock ?? undefined} onClick={() => void openMerge()}>
            <GitMerge className="size-4" />{copy.merge}
          </Button>
        </div>
      </header>

      {fleet.status === "paused" && fleet.pausedReason ? (
        <p role="status" className="rounded-md border border-hue-gold/40 bg-hue-gold/10 px-3 py-2 text-sm">
          <span className="font-medium">{copy.pausedReason}</span> {copy.pausedReasons[fleet.pausedReason] ?? fleet.pausedReason}
        </p>
      ) : null}
      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError instanceof Error ? actionError.message : copy.actionFailed}</p> : null}
      {teamFailed ? <p role="status" className="text-xs text-muted-foreground">{copy.teamLoadFailed}</p> : null}

      {team ? <GoalTeamStrip team={team} tasks={sortedTasks} title={copy.rosterTitle} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label={copy.viewSwitch} className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          {(["board", "flow"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setPickedView(id)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
                view === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {id === "board" ? copy.viewBoard : copy.viewFlow}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {held > 0 ? <span role="status" className="rounded-full bg-brand-accent/12 px-2.5 py-0.5 text-xs font-medium text-brand-accent">{copy.listHeld(held)}</span> : null}
          <AddTaskDialog fleetId={fleetId} />
        </div>
      </div>

      <MessageFlagshipBox fleetId={fleetId} />

      {sortedTasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{copy.noTasks}</p>
      ) : view === "board" ? (
        <FleetBoard board={board} roster={team} live={live} selectedId={selectedId} onOpen={setSelectedId} />
      ) : (
        <GoalTaskFlow
          live={live}
          projectId={fleet.projectId}
          tasks={sortedTasks}
          team={team}
          onOpenTask={(task) => setSelectedId(task.id)}
          labels={{ lead: copy.workerFlagship, leadBucket: copy.bucketFlagship, workspaceIntegrated: copy.workspaceOwnIntegrated, workspacePending: copy.workspaceOwnPending }}
          headline={(task, flow) => {
            const full = sortedTasks.find((entry) => entry.id === task.id);
            return full ? taskSentence(copy, full, flow) : null;
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <FleetActivity journal={journal} timers={timers} tasks={sortedTasks} />
        <div className="flex flex-col gap-4">
          <InstructionsCard fleetId={fleetId} instructions={fleet.instructions} />
          <DiffReviewCard open={diffOpen} onToggle={() => setDiffOpen((value) => !value)} query={diffQuery} />
        </div>
      </div>

      <FleetTaskDrawer fleetId={fleetId} projectId={fleet.projectId} card={selected} roster={team} live={live} onClose={() => setSelectedId(null)} />

      <ConfirmDialog
        open={mergeOpen}
        title={copy.mergeConfirmTitle}
        description={waiting > 0 ? `${mergeBody} ${copy.mergeNotIntegrated(waiting)}` : mergeBody}
        confirmLabel={copy.merge}
        pending={mergeMutation.isPending}
        onOpenChange={setMergeOpen}
        onConfirm={() => mergeMutation.mutate()}
      />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const copy = useFleetCopy();
  const active = status === "active";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", active ? "bg-hue-mint/12 text-hue-mint" : "bg-hue-gold/12 text-hue-gold")}>
      {active ? copy.statusActive : status === "paused" ? copy.statusPaused : status}
    </span>
  );
}

function BackLink() {
  const copy = useFleetCopy();
  return (
    <Link href="/fleet" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
      <ArrowLeft className="size-3.5" />
      {copy.backToList}
    </Link>
  );
}
