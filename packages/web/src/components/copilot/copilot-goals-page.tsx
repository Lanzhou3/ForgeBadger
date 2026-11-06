"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopilotEmptyState } from "./copilot-empty-state";
import { GoalStatusBadge } from "./goal-status-badge";
import { useGoalsCopy } from "./goals-copy";
import { useUiLocale } from "@/hooks/use-language";
import { listGoals, type CopilotGoalListItem } from "@/lib/copilot-api";
import { cn } from "@/lib/utils";

export const goalsQueryKey = ["copilot", "goals"] as const;

export function CopilotGoalsPage() {
  const copy = useGoalsCopy();
  // Poll only while at least one goal is still moving; settled lists are static.
  const goals = useQuery({
    queryKey: goalsQueryKey,
    queryFn: () => listGoals(),
    refetchInterval: (query) =>
      (query.state.data?.goals.some((goal) => goal.status === "active") ?? false) ? 8000 : false,
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 pt-16 md:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Target className="size-5 shrink-0 text-brand" />
            {copy.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
        </div>
        <Link
          href="/copilot"
          className="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copy.backToCopilot}
        </Link>
      </header>

      <Card className="forgebadger-animate-in">
        <CardContent className="space-y-2">
          {goals.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">{copy.loading}</p>
          ) : goals.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <p>{copy.loadFailed}</p>
              <Button size="sm" variant="outline" onClick={() => void goals.refetch()}>
                {copy.retry}
              </Button>
            </div>
          ) : goals.data.goals.length === 0 ? (
            <CopilotEmptyState icon={Target} title={copy.empty} />
          ) : (
            goals.data.goals.map((goal) => <GoalRow key={goal.id} goal={goal} />)
          )}
        </CardContent>
      </Card>
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
      className="block rounded-md border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/40"
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
            className={cn("h-full rounded-full transition-[width] duration-700 ease-out", percent >= 100 ? "bg-emerald-500" : "bg-brand")}
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
