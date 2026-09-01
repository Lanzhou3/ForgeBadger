"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/hooks/use-language";
import {
  applyCliConfigToAdapter,
  previewCliConfigApply,
  type ModelProfile,
  type ProviderCredentialSummary,
  type ProviderProfile,
  type ProviderSupportedAdapter,
} from "@/lib/api";

interface ApplyToCliDialogProps {
  provider: ProviderProfile;
  models: ModelProfile[];
  credentials: ProviderCredentialSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApplyToCliDialog({ provider, models, credentials, open, onOpenChange }: ApplyToCliDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const targets = useMemo(() => [...provider.supportedAdapters], [provider.supportedAdapters]);
  const activeModels = useMemo(() => models.filter((model) => model.status === "active"), [models]);
  const activeCredentials = useMemo(() => credentials.filter((credential) => credential.status === "active"), [credentials]);
  const defaultModel = activeModels.find((model) => model.isDefault) ?? activeModels[0];

  const [adapter, setAdapter] = useState<ProviderSupportedAdapter>(targets[0] ?? "claude");
  const [modelProfileId, setModelProfileId] = useState("");
  const [credentialId, setCredentialId] = useState("");

  useEffect(() => {
    if (!open) return;
    setAdapter((current) => targets.includes(current) ? current : targets[0] ?? "claude");
    setModelProfileId(defaultModel?.id ?? "");
    setCredentialId(activeCredentials[0]?.id ?? "");
  }, [open, targets, defaultModel?.id, activeCredentials]);

  const previewInput = useMemo(
    () => ({
      providerProfileId: provider.id,
      ...(modelProfileId ? { modelProfileId } : {}),
      ...(credentialId ? { credentialId } : {}),
    }),
    [credentialId, modelProfileId, provider.id]
  );
  const previewQuery = useQuery({
    queryKey: ["cli-config-apply-preview", adapter, previewInput],
    queryFn: () => previewCliConfigApply(adapter, previewInput),
    enabled: open && targets.length > 0,
    retry: false,
    staleTime: 0,
  });

  const applyMutation = useMutation({
    mutationFn: () => applyCliConfigToAdapter(adapter, previewInput),
    onSuccess: async (result) => {
      const targetPath = result.files?.[0]?.targetPath ?? "—";
      toast.success(t("models.applyToCliSuccess").replace("{targetPath}", targetPath));
      if (result.backupId) {
        toast.info(t("models.applyToCliRollbackHint"));
      }
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["cli-config"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("models.applyToCliFailed"));
    },
  });

  const preview = previewQuery.data;
  const previewFiles = preview?.files ?? [];
  const warnings = preview?.warnings ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!applyMutation.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("models.applyToCli")}</DialogTitle>
          <DialogDescription>{t("models.applyToCliDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="apply-cli-adapter">{t("common.aiTool")}</Label>
            <select
              id="apply-cli-adapter"
              aria-label={t("common.aiTool")}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={adapter}
              onChange={(event) => setAdapter(event.target.value as ProviderSupportedAdapter)}
            >
              {targets.map((target) => <option key={target} value={target}>{target}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-cli-model">{t("projects.model")}</Label>
            <select
              id="apply-cli-model"
              aria-label={t("projects.model")}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={modelProfileId}
              onChange={(event) => setModelProfileId(event.target.value)}
            >
              {activeModels.length === 0 ? <option value="">{t("models.noModelsAvailable")}</option> : null}
              {activeModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apply-cli-credential">{t("models.credentials")}</Label>
            <select
              id="apply-cli-credential"
              aria-label={t("models.credentials")}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={credentialId}
              onChange={(event) => setCredentialId(event.target.value)}
            >
              <option value="">{t("models.applyToCliNoCredential")}</option>
              {activeCredentials.map((credential) => (
                <option key={credential.id} value={credential.id}>{credential.label ?? t("models.unnamedCredential")}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
          {previewQuery.isLoading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : previewQuery.error ? (
            <p className="text-destructive">{previewQuery.error instanceof Error ? previewQuery.error.message : t("models.applyPreviewFailed")}</p>
          ) : preview ? (
            <>
              {previewFiles.map((file) => (
                <div key={file.targetPath} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">{t("models.applyTargetPath")}:</span>
                    <span className="break-all font-mono">{file.targetPath || "—"}</span>
                    <Badge variant="outline">{file.operation}</Badge>
                  </div>
                  {file.proposed ? (
                    <pre className="max-h-48 overflow-auto rounded-md border border-border/70 bg-background/60 p-2 font-mono whitespace-pre-wrap">{maskSecrets(file.proposed)}</pre>
                  ) : null}
                </div>
              ))}
              {warnings.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-amber-700 dark:text-amber-300">
                  {warnings.map((warning) => <li key={warning}>{maskSecrets(warning)}</li>)}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={applyMutation.isPending} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!preview || previewQuery.isLoading || applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
          >
            <ShieldCheck className="size-4" />
            {applyMutation.isPending ? t("models.applyingToCli") : t("models.applyConfig")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Defensive masking: the preview should already be redacted server-side, but
// never echo token-looking values back to the UI if they slip through.
function maskSecrets(text: string): string {
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{2})[A-Za-z0-9_-]+/g, "$1…")
    .replace(/((?:api[-_]?key|auth[-_]?token|token|secret)["'\s]*[:=]["'\s]*)([^\s,"']{4})[^\s,"']*/giu, "$1$2…");
}
