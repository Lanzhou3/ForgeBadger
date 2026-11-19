"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Target, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopilotEmptyState } from "./copilot-empty-state";
import { GoalCreateDialog } from "./goal-create-dialog";
import { GoalStatusBadge } from "./goal-status-badge";
import { useGoalsCopy } from "./goals-copy";
import { useUiLocale } from "@/hooks/use-language";
import { listGoals, type CopilotGoalListItem } from "@/lib/copilot-api";
import { cn } from "@/lib/utils";

export const goalsQueryKey = ["copilot", "goals"] as const;

type GoalFilterKey = "all" | "active" | "attention" | "done";

function matchesGoalFilter(goal: CopilotGoalListItem, filter: GoalFilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "active") return goal.status === "active";
  if (filter === "attention") return goal.status === "blocked" || goal.status === "paused";
  return goal.status === "completed" || goal.status === "cancelled";
}

export function CopilotGoalsPage() {
  const copy = useGoalsCopy();
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<GoalFilterKey>("all");
  // Poll only while at least one goal is still moving; settled lists are static.
  const goals = useQuery({
    queryKey: goalsQueryKey,
    queryFn: () => listGoals(),
    refetchInterval: (query) =>
      (query.state.data?.goals.some((goal) => goal.status === "active") ?? false) ? 8000 : false,
  });

  const allGoals = goals.data?.goals ?? [];
  const filterOptions: { key: GoalFilterKey; label: string; count: number }[] = [
    { key: "all", label: copy.filterAll, count: allGoals.length },
    { key: "active", label: copy.filterActive, count: allGoals.filter((g) => matchesGoalFilter(g, "active")).length },
    { key: "attention", label: copy.filterAttention, count: allGoals.filter((g) => matchesGoalFilter(g, "attention")).length },
    { key: "done", label: copy.filterDone, count: allGoals.filter((g) => matchesGoalFilter(g, "done")).length },
  ];
  const filteredGoals = allGoals.filter((goal) => matchesGoalFilter(goal, filter));

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Target className="size-5 shrink-0 text-brand" />
            {copy.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/copilot/settings#copilot-team"
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Users className="size-3.5" aria-hidden />
            {copy.manageTeam}
          </Link>
          <Link
            href="/copilot"
            className="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {copy.backToCopilot}
          </Link>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {copy.create}
          </Button>
        </div>
      </header>

      <GoalCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Card className="forgebadger-animate-in">
        <CardContent className="space-y-3">
          {goals.isPending ? (
            <GoalListSkeleton label={copy.loading} />
          ) : goals.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <p>{copy.loadFailed}</p>
              <Button size="sm" variant="outline" onClick={() => void goals.refetch()}>
                {copy.retry}
              </Button>
            </div>
          ) : allGoals.length === 0 ? (
            <CopilotEmptyState icon={Target} title={copy.empty} />
          ) : (
            <>
              <div role="group" aria-label={copy.title} className="flex flex-wrap items-center gap-1.5">
                {filterOptions.map((option) => {
                  const active = filter === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(option.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium forgebadger-tabular-nums forgebadger-motion-surface",
                        active
                          ? "bg-brand/12 text-brand"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {`${option.label} (${option.count})`}
                    </button>
                  );
                })}
              </div>
              {filteredGoals.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{copy.filterEmpty}</p>
              ) : (
                <div className="space-y-2">
                  {filteredGoals.map((goal) => <GoalRow key={goal.id} goal={goal} />)}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GoalListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-2">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-md border border-border/70 bg-card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
            <div className="h-3.5 w-8 animate-pulse rounded bg-muted" />
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 animate-pulse rounded-full bg-muted/70" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GoalRow({ goal }: { goal: CopilotGoalListItem }) {
  const copy = useGoalsCopy();
  const locale = useUiLocale();
  const total = goal.taskTotal;
  const passes = Math.min(goal.taskPasses, total);
  const percent = total > 0 ? Math.round((passes / total) * 100) : 0;
  return (
    <Link
      href={`/copilot/goals/${encodeURIComponent(goal.id)}`}
      className="block rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-card forgebadger-motion-surface hover:-translate-y-px hover:border-border hover:shadow-raised"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={goal.title}>
          {goal.title}
        </span>
        <GoalStatusBadge status={goal.status} />
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {passes}/{total}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/60"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${goal.title} ${passes}/${total}`}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-700 ease-out", percent >= 100 ? "bg-success" : "bg-brand")}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {copy.createdAt} {new Date(goal.createdAt).toLocaleString(locale)}
        </span>
      </div>
    </Link>
  );
}
