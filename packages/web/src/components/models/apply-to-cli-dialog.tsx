"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AdapterSelect, ADAPTER_DISCOVERY_QUERY_KEY, chooseDefaultAdapter, isAdapterSelectable } from "@/components/adapter-select";
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
  discoverAdapters,
  getClaudeRoute,
  previewCliConfigApply,
  setClaudeRoute,
  type AdapterDiscovery,
  type ClaudeModelSlot,
  type CodexReasoningEffort,
  type ModelProfile,
  type ProviderCredentialSummary,
  type ProviderProfile,
  type ProviderSupportedAdapter,
} from "@/lib/api";

const CLAUDE_PRIMARY_SLOTS: Array<{ slot: ClaudeModelSlot; label: string }> = [
  { slot: "opus", label: "Opus" },
  { slot: "sonnet", label: "Sonnet" },
  { slot: "haiku", label: "Haiku" },
];

const CLAUDE_ADVANCED_SLOTS: Array<{ slot: ClaudeModelSlot; label: string }> = [
  { slot: "fable", label: "Fable" },
  { slot: "subagent", label: "Subagent" },
];

const CODEX_REASONING_EFFORTS: CodexReasoningEffort[] = ["minimal", "low", "medium", "high"];
const EMPTY_ADAPTERS: AdapterDiscovery[] = [];

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
  // Claude Code only speaks the Anthropic protocol directly; OpenAI-protocol
  // providers must be applied through the Gateway route endpoint.
  const needsRoute = adapter === "claude" && provider.apiFormat !== "anthropic";
  const routeSupported = needsRoute && (provider.apiFormat === "openai" || provider.apiFormat === "openai-compatible");
  const routeUnsupported = needsRoute && !routeSupported;
  const routeQuery = useQuery({
    queryKey: ["claude-route"],
    queryFn: getClaudeRoute,
    enabled: open && needsRoute,
    retry: false,
    staleTime: 30_000,
  });
  const routeEnabled = routeQuery.data?.enabled === true;

  const [modelProfileId, setModelProfileId] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [modelMapping, setModelMapping] = useState<Partial<Record<ClaudeModelSlot, string>>>({});
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort | "">("");
  const adaptersQuery = useQuery({
    queryKey: ADAPTER_DISCOVERY_QUERY_KEY,
    queryFn: discoverAdapters,
    enabled: open,
    staleTime: 30_000,
  });
  const detectedAdapters = useMemo(
    () => adaptersQuery.data?.adapters ?? EMPTY_ADAPTERS,
    [adaptersQuery.data]
  );
  // Gate the preview query until the open-effect has applied the defaults;
  // otherwise the query fires twice on open (empty ids, then defaults).
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    // Default to a locally installed, provider-supported CLI when possible;
    // fall back to the first supported CLI so the preview still renders.
    const fallback = chooseDefaultAdapter(detectedAdapters, targets) ?? targets[0] ?? "claude";
    const detected = new Map(detectedAdapters.map((adapter) => [adapter.id, adapter]));
    setAdapter((current) =>
      targets.includes(current) && (detected.get(current) ? isAdapterSelectable(detected.get(current)!, targets) : true)
        ? current
        : fallback
    );
    setModelProfileId(defaultModel?.id ?? "");
    setCredentialId(activeCredentials[0]?.id ?? "");
    setModelMapping({});
    setReasoningEffort("");
    setReady(true);
  }, [open, targets, defaultModel?.id, activeCredentials, detectedAdapters]);

  const previewInput = useMemo(
    () => {
      const mapping = Object.fromEntries(
        Object.entries(modelMapping).filter(([, value]) => Boolean(value))
      ) as Partial<Record<ClaudeModelSlot, string>>;
      return {
        providerProfileId: provider.id,
        // OpenCode apply is additive and carries no single model selection.
        ...(adapter !== "opencode" && modelProfileId ? { modelProfileId } : {}),
        ...(credentialId ? { credentialId } : {}),
        ...(adapter === "claude" && Object.keys(mapping).length > 0 ? { modelMapping: mapping } : {}),
        ...(adapter === "codex" && reasoningEffort ? { reasoningEffort } : {}),
        // Preview the routed document (Gateway URL + masked token) so the diff
        // matches what "enable route and apply" will write.
        ...(needsRoute ? { routeThroughGateway: true } : {}),
      };
    },
    [adapter, credentialId, modelMapping, modelProfileId, needsRoute, provider.id, reasoningEffort]
  );
  const previewQuery = useQuery({
    queryKey: ["cli-config-apply-preview", adapter, previewInput],
    queryFn: () => previewCliConfigApply(adapter, previewInput),
    enabled: open && ready && targets.length > 0,
    retry: false,
    staleTime: 0,
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      // One-tap path: enable the route first, then apply through it.
      if (needsRoute && !routeEnabled) {
        await setClaudeRoute(true);
      }
      return applyCliConfigToAdapter(adapter, {
        ...previewInput,
        ...(needsRoute ? { routeThroughGateway: true } : {}),
      });
    },
    onSuccess: async (result) => {
      const targetPath = result.files?.[0]?.targetPath ?? "—";
      toast.success(t("models.applyToCliSuccess").replace("{targetPath}", targetPath));
      if (result.backupId) {
        toast.info(t("models.applyToCliRollbackHint"));
      }
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["cli-config"] });
      if (needsRoute) {
        await queryClient.invalidateQueries({ queryKey: ["claude-route"] });
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("models.applyToCliFailed"));
    },
  });

  const preview = previewQuery.data;
  const previewFiles = preview?.files ?? [];
  // Machine-readable route marker; the localized banner above carries the UX.
  const warnings = (preview?.warnings ?? []).filter((warning) => warning !== "OPENAI_PROTOCOL_REQUIRES_ROUTE");

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
            <AdapterSelect
              id="apply-cli-adapter"
              ariaLabel={t("common.aiTool")}
              className="h-9 w-full"
              value={adapter}
              onValueChange={setAdapter}
              supported={targets}
              placeholder={t("common.loading")}
            />
          </div>
          {adapter !== "opencode" && (
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
          )}
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

        {adapter === "claude" && (
          <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">{t("models.roleMapping")}</span>
              <p className="text-xs text-muted-foreground">{t("models.roleMappingDescription")}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[...CLAUDE_PRIMARY_SLOTS, ...CLAUDE_ADVANCED_SLOTS].map(({ slot, label }) => (
                <div key={slot} className="space-y-1">
                  <Label htmlFor={`apply-cli-slot-${slot}`} className="text-xs">{label}</Label>
                  <select
                    id={`apply-cli-slot-${slot}`}
                    aria-label={label}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={modelMapping[slot] ?? ""}
                    onChange={(event) =>
                      setModelMapping((current) => ({ ...current, [slot]: event.target.value }))
                    }
                  >
                    <option value="">{t("models.followPrimaryModel")}</option>
                    {activeModels.map((model) => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {adapter === "codex" && (
          <div className="space-y-2">
            <Label htmlFor="apply-cli-effort">{t("models.reasoningEffort")}</Label>
            <select
              id="apply-cli-effort"
              aria-label={t("models.reasoningEffort")}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm md:max-w-xs"
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value as CodexReasoningEffort | "")}
            >
              <option value="">{t("models.reasoningEffortDefault")}</option>
              {CODEX_REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>{effort}</option>
              ))}
            </select>
          </div>
        )}

        {adapter === "opencode" && (
          <p className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {t("models.opencodeApplyHint")}
          </p>
        )}

        {routeUnsupported && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {t("models.claudeRouteUnsupported")}
          </p>
        )}
        {routeSupported && (
          <div
            className={
              routeEnabled
                ? "space-y-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs"
                : "space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
            }
          >
            <p className={routeEnabled ? "font-medium text-emerald-700 dark:text-emerald-300" : "font-medium text-amber-700 dark:text-amber-300"}>
              {routeEnabled
                ? t("models.claudeRouteEnabledHint").replace("{gatewayUrl}", routeQuery.data?.gatewayUrl ?? "—")
                : t("models.claudeRouteBanner")}
            </p>
            {!routeEnabled && (
              <p className="text-muted-foreground">{t("models.claudeRouteBannerDescription")}</p>
            )}
          </div>
        )}

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
            disabled={
              !preview ||
              previewQuery.isLoading ||
              applyMutation.isPending ||
              routeUnsupported ||
              (needsRoute && routeQuery.isLoading)
            }
            onClick={() => applyMutation.mutate()}
          >
            <ShieldCheck className="size-4" />
            {applyMutation.isPending
              ? t("models.applyingToCli")
              : routeEnabled && needsRoute
                ? t("models.claudeRouteApply")
                : needsRoute
                  ? t("models.claudeRouteEnableAndApply")
                  : t("models.applyConfig")}
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
