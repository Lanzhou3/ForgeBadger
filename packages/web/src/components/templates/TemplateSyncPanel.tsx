"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/hooks/use-language";
import {
  applyTemplateSync,
  getTemplateUsage,
  previewTemplateSync,
  type TemplateSyncPreview,
  type TemplateUsageProject,
} from "@/lib/api";

const statusBadgeClass: Record<TemplateUsageProject["configStatus"], string> = {
  compliant: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  stale: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  missing: "border-destructive/40 bg-destructive/10 text-destructive"
};

const outcomeLabelKey = {
  applied: "templates.syncOutcomeApplied",
  rolled_back: "templates.syncOutcomeRolledBack",
  rollback_failed: "templates.syncOutcomeRollbackFailed",
} as const;

export function TemplateSyncPanel({ templateId }: { templateId: string }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<TemplateSyncPreview | null>(null);
  const [overwriteProjectIds, setOverwriteProjectIds] = useState<Set<string>>(new Set());
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);

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
      if (!preview) throw new Error(t("templates.syncPreviewFailed"));
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
      // Reset the preview and checkboxes so a repeat click has to preview again.
      setPreview(null);
      setOverwriteProjectIds(new Set());
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

  const statusLabel: Record<TemplateUsageProject["configStatus"], string> = {
    compliant: t("templates.syncStatusCompliant"),
    stale: t("templates.syncStatusStale"),
    missing: t("templates.syncStatusMissing")
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="size-4" />
          {t("templates.syncTitle")}
          {usage && usage.usageCount === 0 && (
            <Badge variant="outline" className="text-xs font-normal">
              {t("templates.syncSeedOnly")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {isLoading || !usage
            ? t("templates.syncLoadingUsage")
            : t("templates.syncUsageCount").replace("{count}", String(usage.usageCount))}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {usage && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">
              {t("templates.syncCountCompliant").replace("{count}", String(statusCounts.compliant))}
            </Badge>
            <Badge variant="secondary">
              {t("templates.syncCountStale").replace("{count}", String(statusCounts.stale))}
            </Badge>
            <Badge variant="secondary">
              {t("templates.syncCountMissing").replace("{count}", String(statusCounts.missing))}
            </Badge>
          </div>
        )}

        <div className="space-y-2">
          {!usage || usage.projects.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("templates.syncEmpty")}
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
            <div className="text-sm font-medium">{t("templates.syncPreview")}</div>
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
                        {t("templates.syncOverwriteModified")}
                      </label>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("templates.syncFilesToCreate").replace("{count}", String(entry.summary.missingFiles.length))}
                    {entry.summary.requiresDecision.length > 0 && (
                      <> · {t("templates.syncFilesNeedDecision").replace("{count}", String(entry.summary.requiresDecision.length))}</>
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
            <p className="text-xs text-muted-foreground">{t("templates.syncOverwriteHint")}</p>
          </div>
        )}

        {previewMutation.isError && (
          <p className="text-sm text-destructive">
            {previewMutation.error instanceof Error ? previewMutation.error.message : t("templates.syncPreviewFailed")}
          </p>
        )}
        {applyMutation.isError && (
          <p className="text-sm text-destructive">
            {applyMutation.error instanceof Error ? applyMutation.error.message : t("templates.syncApplyFailed")}
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
            {previewMutation.isPending ? t("templates.syncPreviewing") : t("templates.syncPreviewAction")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!preview || preview.projects.length === 0 || applyMutation.isPending}
            onClick={() => setApplyConfirmOpen(true)}
          >
            <Play className="size-4" />
            {applyMutation.isPending
              ? t("templates.syncApplying")
              : t("templates.syncApply").replace("{count}", String(preview?.projects.length ?? 0))}
          </Button>
        </div>

        {applyMutation.data && (
          <div className="space-y-1.5 text-xs">
            {applyMutation.data.projects.map((entry) => (
              <div key={entry.projectId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate">{entry.projectName}</span>
                {entry.error ? (
                  <span className="shrink-0 text-destructive">{entry.error}</span>
                ) : (
                  <span className="flex min-w-0 shrink-0 items-center gap-2 text-muted-foreground">
                    <span>
                      {entry.result
                        ? t(outcomeLabelKey[entry.result.outcome])
                        : ""}{" "}
                      ·{" "}
                      {t("templates.syncResultLine")
                        .replace("{written}", String(entry.result?.writtenFiles.length ?? 0))
                        .replace("{skipped}", String(entry.result?.skippedFiles.length ?? 0))}
                    </span>
                    {entry.result?.backupPath ? (
                      <span
                        className="max-w-48 truncate font-mono"
                        title={entry.result.backupPath}
                      >
                        {t("templates.syncBackup")}: {entry.result.backupPath}
                      </span>
                    ) : null}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={applyConfirmOpen}
        title={t("templates.syncApplyConfirmTitle")}
        description={t("templates.syncApplyConfirmDescription").replace("{count}", String(preview?.projects.length ?? 0))}
        confirmLabel={t("templates.syncApplyConfirm")}
        pending={applyMutation.isPending}
        onOpenChange={setApplyConfirmOpen}
        onConfirm={() => {
          setApplyConfirmOpen(false);
          applyMutation.mutate();
        }}
      />
    </Card>
  );
}
