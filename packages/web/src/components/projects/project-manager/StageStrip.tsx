"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitCommitHorizontal, Kanban, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { seedProjectManagerStageTemplate, type ProjectManagerStage, type ProjectManagerWorkItem } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Translate } from "./types";
import { projectManagerMutationMessage } from "./utils";

interface ProjectManagerStageStripProps {
  projectId: string;
  stages: ProjectManagerStage[];
  workItems: ProjectManagerWorkItem[];
  activeStageId: string | null;
  onSelectStageId: (stageId: string | null) => void;
  onOpenStagesView: () => void;
  canEdit: boolean;
  t: Translate;
}

/**
 * Compact single-row delivery stage bar replacing the stacked second Kanban on
 * the default Dev Tasks screen. Lets users filter the board/table/queue by
 * stage or jump into the full stage management lane view.
 */
export function ProjectManagerStageStrip({
  projectId,
  stages,
  workItems,
  activeStageId,
  onSelectStageId,
  onOpenStagesView,
  canEdit,
  t,
}: ProjectManagerStageStripProps) {
  const queryClient = useQueryClient();

  const seedMutation = useMutation({
    mutationFn: () => seedProjectManagerStageTemplate(projectId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "stages"] }),
        queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
      ]);
    },
    onError: (err) => {
      toast.error(projectManagerMutationMessage(err, t("projects.projectManagerStageMutationError")));
    },
  });

  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let backlogCount = 0;
    for (const item of workItems) {
      if (item.stageId) {
        counts.set(item.stageId, (counts.get(item.stageId) ?? 0) + 1);
      } else {
        backlogCount += 1;
      }
    }
    return { counts, backlogCount };
  }, [workItems]);

  return (
    <div
      data-testid="project-manager-stage-strip"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-2.5"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <GitCommitHorizontal className="size-3.5 text-brand" />
          {t("projects.projectManagerStageStripLabel")}
        </span>

        {stages.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("projects.projectManagerStageEmptyTitle")}
            </span>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                disabled={seedMutation.isPending}
                onClick={() => seedMutation.mutate()}
              >
                <Sparkles className="size-3.5" />
                {t("projects.projectManagerStageSeedTemplate")}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onSelectStageId(null)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                activeStageId === null
                  ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                  : "border-transparent bg-muted/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {t("projects.filterAll")}
              <span className="font-mono text-[10px] tabular-nums">{workItems.length}</span>
            </button>
            {stages.map((stage) => {
              const count = stageCounts.counts.get(stage.id) ?? 0;
              const selected = activeStageId === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => onSelectStageId(selected ? null : stage.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                      : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="max-w-[140px] truncate">{stage.name}</span>
                  <span className="font-mono text-[10px] tabular-nums">{count}</span>
                </button>
              );
            })}
            {stageCounts.backlogCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  onSelectStageId(activeStageId === "__backlog__" ? null : "__backlog__")
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  activeStageId === "__backlog__"
                    ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                    : "border-transparent bg-muted/40 text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{t("projects.projectManagerStageBacklog")}</span>
                <span className="font-mono text-[10px] tabular-nums">
                  {stageCounts.backlogCount}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 px-2.5 text-xs"
        onClick={onOpenStagesView}
      >
        <Kanban className="size-3.5" />
        {t("projects.projectManagerViewStages")}
      </Button>
    </div>
  );
}
