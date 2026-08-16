import { Braces, Play, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ModelProfile,
  ProviderApplyAdapter,
  ProviderApplyPreview,
  ProviderCredentialSummary,
  ProviderProfile,
} from "@/lib/api";

import {
  EmptyLine,
  adapterLabel,
  applyTargetsForProvider,
  getApplyBlockedReason,
  type Translate,
} from "./shared";

interface ApplyTabProps {
  provider: ProviderProfile | undefined;
  models: ModelProfile[];
  credentials: ProviderCredentialSummary[];
  projectRoot: string;
  applyScope: "project" | "user-global";
  selectedModelId: string;
  selectedCredentialId: string;
  selectedAdapter: ProviderApplyAdapter;
  preview: ProviderApplyPreview | null;
  isPreviewing: boolean;
  isApplying: boolean;
  onProjectRootChange: (projectRoot: string) => void;
  onScopeChange: (scope: "project" | "user-global") => void;
  onModelChange: (modelId: string) => void;
  onCredentialChange: (credentialId: string) => void;
  onAdapterChange: (adapter: ProviderApplyAdapter) => void;
  onPreview: () => void;
  onApply: () => void;
  t: Translate;
}

export function ApplyTab({
  provider,
  models,
  credentials,
  projectRoot,
  applyScope,
  selectedModelId,
  selectedCredentialId,
  selectedAdapter,
  preview,
  isPreviewing,
  isApplying,
  onProjectRootChange,
  onScopeChange,
  onModelChange,
  onCredentialChange,
  onAdapterChange,
  onPreview,
  onApply,
  t,
}: ApplyTabProps) {
  const supportedAdapters = applyTargetsForProvider(provider);
  const previewBlockedReason = getApplyBlockedReason({
    provider,
    supportedAdapters,
    selectedAdapter,
    selectedModelId,
    projectRoot,
    scope: applyScope,
    needsPreview: false,
    preview,
    t,
  });
  const applyBlockedReason = getApplyBlockedReason({
    provider,
    supportedAdapters,
    selectedAdapter,
    selectedModelId,
    projectRoot,
    scope: applyScope,
    needsPreview: true,
    preview,
    t,
  });
  const previewDisabled = Boolean(previewBlockedReason);
  const applyDisabled = Boolean(applyBlockedReason);
  const selectedCredentialMissing = provider?.authType !== "none" && !selectedCredentialId;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Play className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{t("models.applyWorkspace")}</CardTitle>
            <CardDescription className="mt-1">{t("models.applyWorkspaceDescription")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="apply-adapter">{t("models.applyScope")}</Label>
            <select
              id="apply-adapter"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedAdapter}
              onChange={(event) => onAdapterChange(event.target.value as ProviderApplyAdapter)}
              disabled={!provider || supportedAdapters.length <= 1}
            >
              {supportedAdapters.map((adapter) => (
                <option key={adapter} value={adapter}>{adapterLabel(adapter)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-scope">{t("models.applyScopeMode")}</Label>
            <select
              id="apply-scope"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={applyScope}
              onChange={(event) => onScopeChange(event.target.value as "project" | "user-global")}
            >
              <option value="project">{t("models.scopeProject")}</option>
              <option value="user-global">{t("models.scopeUserGlobal")}</option>
            </select>
          </div>
        </div>
        {applyScope === "project" && (
          <div className="space-y-2">
            <Label htmlFor="apply-root">{t("models.projectPath")}</Label>
            <Input
              id="apply-root"
              value={projectRoot}
              onChange={(event) => onProjectRootChange(event.target.value)}
              placeholder="/path/to/project"
            />
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="apply-model">{t("projects.model")}</Label>
            <select
              id="apply-model"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedModelId}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={!provider || models.length === 0}
            >
              {models.length === 0 ? (
                <option value="">{t("models.noModelsAvailable")}</option>
              ) : (
                models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))
              )}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-credential">{t("models.credentials")}</Label>
            <select
              id="apply-credential"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedCredentialId}
              onChange={(event) => onCredentialChange(event.target.value)}
              disabled={!provider || provider.authType === "none"}
            >
              <option value="">{provider?.authType === "none" ? t("models.noCredentialRequired") : t("projects.hostEnvironment")}</option>
              {credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.label ?? t("models.unnamedCredential")}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(previewBlockedReason || applyBlockedReason || selectedCredentialMissing) && (
          <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {previewBlockedReason ?? applyBlockedReason ?? t("models.hostCredentialHint")}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={previewDisabled || isPreviewing} onClick={onPreview}>
            <Braces className="size-4" />
            {t("models.previewApply")}
          </Button>
          <Button
            type="button"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            disabled={applyDisabled || isApplying}
            onClick={onApply}
          >
            <ShieldCheck className="size-4" />
            {t("models.applyConfig")}
          </Button>
        </div>

        <div className="space-y-3 border-t border-border/70 pt-3">
          <div className="text-xs font-medium text-muted-foreground">{t("models.applyPreview")}</div>
          {!preview ? (
            <EmptyLine text={t("models.noPreview")} />
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-1">
                {preview.changedFiles.map((file) => (
                  <Badge key={file.relativePath} variant="outline">
                    {file.operation}: {file.relativePath}
                  </Badge>
                ))}
              </div>
              <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify({ env: preview.env, secretEnvNames: preview.secretEnvNames }, null, 2)}
              </pre>
              {preview.backupPath && (
                <div className="text-xs text-muted-foreground">{preview.backupPath}</div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
