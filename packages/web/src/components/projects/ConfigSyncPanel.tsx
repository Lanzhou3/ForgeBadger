"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileCode2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyConfigSync,
  defaultConfigConflictDecisions,
  getConfigCompliance,
  previewConfigSync,
  type ConfigComplianceReport,
  type ConfigConflict,
  type ConfigDecision,
  type CredentialMode,
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

export interface ConfigSyncPanelHandle {
  preview: () => void;
  checkCompliance: () => void;
}

interface ConfigSyncPanelProps {
  projectId: string;
  templateId: string;
  credentialMode: CredentialMode;
  onPendingChange?: (pending: { preview: boolean; compliance: boolean }) => void;
}

function shortHash(value: string): string {
  return value.slice(0, 10);
}

function ComplianceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

export const ConfigSyncPanel = forwardRef<ConfigSyncPanelHandle, ConfigSyncPanelProps>(function ConfigSyncPanel(
  { projectId, templateId, credentialMode, onPendingChange },
  ref
) {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [configConflicts, setConfigConflicts] = useState<ConfigConflict[]>([]);
  const [configDecisions, setConfigDecisions] = useState<Record<string, ConfigDecision>>({});

  const previewConfigMutation = useMutation({
    mutationFn: () => previewConfigSync(projectId, templateId, credentialMode),
    onSuccess: (preview) => {
      setConfigConflicts(preview.conflicts ?? []);
      setConfigDecisions(defaultConfigConflictDecisions(preview.conflicts ?? []));
    },
  });

  const applyConfigMutation = useMutation({
    mutationFn: () => {
      return applyConfigSync(projectId, configDecisions, templateId, credentialMode);
    },
    onSuccess: () => {
      setConfigConflicts([]);
      setConfigDecisions({});
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });

  const complianceMutation = useMutation<ConfigComplianceReport>({
    mutationFn: () => getConfigCompliance(projectId, {
      templateId,
      credentialMode,
    }),
  });

  useImperativeHandle(ref, () => ({
    preview: () => previewConfigMutation.mutate(),
    checkCompliance: () => complianceMutation.mutate(),
  }));

  useEffect(() => {
    setConfigConflicts([]);
    setConfigDecisions({});
  }, [templateId, credentialMode]);

  useEffect(() => {
    onPendingChange?.({
      preview: previewConfigMutation.isPending,
      compliance: complianceMutation.isPending,
    });
  }, [onPendingChange, previewConfigMutation.isPending, complianceMutation.isPending]);

  const hasBlockedConflicts = configConflicts.some((conflict) => conflict.allowedActions.length === 0);

  return (
    <>
      {(previewConfigMutation.data || configConflicts.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("projects.configPreview")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1 text-sm text-muted-foreground">
              <div>{t("projects.previewFiles")}: {previewConfigMutation.data?.plan.files.length ?? 0}</div>
              <p>{t("projects.configPreviewDescription")}</p>
            </div>
            {configConflicts.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">{t("projects.conflicts")}</div>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {configConflicts.map((conflict) => (
                    <li
                      key={conflict.relativePath}
                      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-foreground">{conflict.relativePath}</span>
                          <Badge variant={conflict.conflictType === "modified" ? "destructive" : "secondary"}>
                            {conflict.conflictType}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs">
                          {conflict.existingSha256 && (
                            <span>{t("projects.existingHash")}: {shortHash(conflict.existingSha256)}</span>
                          )}
                          {conflict.incomingSha256 && (
                            <span>{t("projects.incomingHash")}: {shortHash(conflict.incomingSha256)}</span>
                          )}
                        </div>
                        {conflict.diffPreview && conflict.diffPreview.length > 0 && (
                          <div className="overflow-hidden rounded-md border border-border bg-muted/40">
                            {conflict.diffPreview.map((line) => (
                              <div key={line.line} className="grid gap-0 border-b border-border/60 last:border-b-0 md:grid-cols-[72px_1fr_1fr]">
                                <div className="bg-background/70 px-2 py-1 font-mono text-[11px] text-muted-foreground">L{line.line}</div>
                                <div className="min-w-0 border-border px-2 py-1 font-mono text-[11px] text-destructive md:border-l">
                                  <span className="mr-1 select-none">-</span>{line.existing}
                                </div>
                                <div className="min-w-0 border-border px-2 py-1 font-mono text-[11px] text-emerald-600 md:border-l dark:text-emerald-400">
                                  <span className="mr-1 select-none">+</span>{line.incoming}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {conflict.allowedActions.length > 0 ? (
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          value={configDecisions[conflict.relativePath] ?? "skip"}
                          onChange={(event) =>
                            setConfigDecisions((current) => ({
                              ...current,
                              [conflict.relativePath]: event.target.value as ConfigDecision,
                            }))
                          }
                          aria-label={`${t("projects.conflictDecision")} ${conflict.relativePath}`}
                        >
                          {conflict.allowedActions.map((action) => (
                            <option key={action} value={action}>
                              {action === "overwrite"
                                ? t("projects.overwrite")
                                : t("projects.skip")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge variant="destructive">{t("projects.blocked")}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">{t("projects.noConflicts")}</div>
            )}
            <Button
              onClick={() => applyConfigMutation.mutate()}
              disabled={
                applyConfigMutation.isPending ||
                hasBlockedConflicts
              }
            >
              <FileCode2 className="mr-2 size-4" />
              {applyConfigMutation.isPending ? t("projects.generating") : t("projects.applyConfig")}
            </Button>
          </CardContent>
        </Card>
      )}

      {complianceMutation.data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>{t("projects.configCompliance")}</span>
              <Badge
                variant={
                  complianceMutation.data.compliance.status === "compliant"
                    ? "default"
                    : "secondary"
                }
              >
                {complianceMutation.data.compliance.status === "compliant"
                  ? t("projects.compliant")
                  : t("projects.needsAttention")}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 text-sm md:grid-cols-5">
              <ComplianceMetric
                label={t("projects.totalFiles")}
                value={complianceMutation.data.compliance.totalFiles}
              />
              <ComplianceMetric
                label={t("projects.missingFiles")}
                value={complianceMutation.data.compliance.missingFiles.length}
              />
              <ComplianceMetric
                label={t("projects.identicalFiles")}
                value={complianceMutation.data.compliance.identicalFiles.length}
              />
              <ComplianceMetric
                label={t("projects.staleFiles")}
                value={complianceMutation.data.compliance.staleFiles.length}
              />
              <ComplianceMetric
                label={t("projects.unsafeFiles")}
                value={complianceMutation.data.compliance.unsafeFiles.length}
              />
            </div>
            {complianceMutation.data.compliance.requiresDecision.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">{t("projects.requiresDecision")}</div>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {complianceMutation.data.compliance.requiresDecision.map((relativePath) => (
                    <li key={relativePath}>{relativePath}</li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => previewConfigMutation.mutate()}
                  disabled={previewConfigMutation.isPending}
                >
                  <FileCode2 className="mr-2 size-4" />
                  {t("projects.reviewConfig")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {previewConfigMutation.isError && (
        <p className="text-sm text-destructive">
          {previewConfigMutation.error instanceof Error
            ? previewConfigMutation.error.message
            : t("projects.failedGenerateConfig")}
        </p>
      )}

      {complianceMutation.isError && (
        <p className="text-sm text-destructive">
          {complianceMutation.error instanceof Error
            ? complianceMutation.error.message
            : t("projects.failedCompliance")}
        </p>
      )}

      {applyConfigMutation.isError && (
        <p className="text-sm text-destructive">
          {applyConfigMutation.error instanceof Error
            ? applyConfigMutation.error.message
            : t("projects.failedGenerateConfig")}
        </p>
      )}
    </>
  );
});