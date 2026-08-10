"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyTemplateSync,
  getTemplateUsage,
  previewTemplateSync,
  type TemplateSyncPreview,
  type TemplateUsageProject,
} from "@/lib/api";

const statusLabel: Record<TemplateUsageProject["configStatus"], string> = {
  compliant: "In sync",
  stale: "Stale",
  missing: "Missing config"
};

const statusBadgeClass: Record<TemplateUsageProject["configStatus"], string> = {
  compliant: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  stale: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  missing: "border-destructive/40 bg-destructive/10 text-destructive"
};

export function TemplateSyncPanel({ templateId }: { templateId: string }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<TemplateSyncPreview | null>(null);
  const [overwriteProjectIds, setOverwriteProjectIds] = useState<Set<string>>(new Set());

  const { data: usage, isLoading } = useQuery({
    queryKey: ["template-usage", templateId],
    queryFn: () => getTemplateUsage(templateId)
  });

  const previewMutation = useMutation({
    mutationFn: () => previewTemplateSync(templateId),
    onSuccess: (result) => {
      setPreview(result);
      setOverwriteProjectIds(new Set());
    }
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Preview first");
      const decisions: Record<string, Record<string, "skip" | "overwrite">> = {};
      for (const entry of preview.projects) {
        if (!overwriteProjectIds.has(entry.projectId) || entry.summary.requiresDecision.length === 0) {
          continue;
        }
        decisions[entry.projectId] = Object.fromEntries(
          entry.summary.requiresDecision.map((relativePath) => [relativePath, "overwrite"])
        );
      }
      return applyTemplateSync(templateId, {
        projectIds: preview.projects.map((entry) => entry.projectId),
        decisions
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-usage", templateId] });
    }
  });

  const statusCounts = useMemo(() => {
    if (!usage) return { compliant: 0, stale: 0, missing: 0 };
    return usage.projects.reduce(
      (counts, project) => {
        counts[project.configStatus] += 1;
        return counts;
      },
      { compliant: 0, stale: 0, missing: 0 }
    );
  }, [usage]);

  function toggleOverwrite(projectId: string) {
    setOverwriteProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="size-4" />
          Sync to projects
        </CardTitle>
        <CardDescription>
          {isLoading || !usage
            ? "Loading usage…"
            : `${usage.usageCount} project${usage.usageCount === 1 ? "" : "s"} use this template`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {usage && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{statusCounts.compliant} in sync</Badge>
            <Badge variant="secondary">{statusCounts.stale} stale</Badge>
            <Badge variant="secondary">{statusCounts.missing} missing config</Badge>
          </div>
        )}

        <div className="space-y-2">
          {!usage || usage.projects.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No projects use this template yet.
            </p>
          ) : (
            usage.projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{project.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{project.path}</div>
                </div>
                <Badge className={statusBadgeClass[project.configStatus]}>
                  {statusLabel[project.configStatus]}
                </Badge>
              </div>
            ))
          )}
        </div>

        {preview && (
          <div className="space-y-2 rounded-md border bg-background p-3">
            <div className="text-sm font-medium">Preview</div>
            {preview.projects.map((entry) => {
              const needsDecision = entry.summary.requiresDecision.length > 0;
              return (
                <div key={entry.projectId} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{entry.projectName}</span>
                    {needsDecision && (
                      <label className="flex shrink-0 items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={overwriteProjectIds.has(entry.projectId)}
                          onChange={() => toggleOverwrite(entry.projectId)}
                        />
                        overwrite modified files
                      </label>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {entry.summary.missingFiles.length} files to create
                    {entry.summary.requiresDecision.length > 0 && (
                      <> · {entry.summary.requiresDecision.length} files need a decision</>
                    )}
                    {entry.summary.modifiedFiles.length > 0 && (
                      <span className="ml-2 font-mono">
                        {entry.summary.modifiedFiles.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {previewMutation.isError && (
          <p className="text-sm text-destructive">
            {previewMutation.error instanceof Error ? previewMutation.error.message : "Preview failed"}
          </p>
        )}
        {applyMutation.isError && (
          <p className="text-sm text-destructive">
            {applyMutation.error instanceof Error ? applyMutation.error.message : "Sync failed"}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!usage || usage.projects.length === 0 || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Previewing…" : "Preview changes"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!preview || preview.projects.length === 0 || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            <Play className="size-4" />
            {applyMutation.isPending ? "Syncing…" : `Apply to ${preview?.projects.length ?? 0} projects`}
          </Button>
        </div>

        {applyMutation.data && (
          <div className="space-y-1.5 text-xs">
            {applyMutation.data.projects.map((entry) => (
              <div key={entry.projectId} className="flex items-center justify-between gap-2">
                <span className="truncate">{entry.projectName}</span>
                {entry.error ? (
                  <span className="shrink-0 text-destructive">{entry.error}</span>
                ) : (
                  <span className="shrink-0 text-muted-foreground">
                    {entry.result?.outcome} · {entry.result?.writtenFiles.length} written ·{" "}
                    {entry.result?.skippedFiles.length} skipped
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}