"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Wrench } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { GatewayApiError, listModelProviders } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import {
  dshConfigQueryKey,
  getCopilotCapabilities,
  getDshConfig,
  setCopilotToolEnabled,
  updateDshConfig,
  type CopilotToolInfo,
  type DshRuntimeStatus,
  type UpdateDshConfigInput,
} from "@/lib/copilot-api";

const SYSTEM_DEFAULT_MODEL = "__system_default__";

export const modelProvidersQueryKey = ["model-providers"] as const;
export const copilotCapabilitiesQueryKey = ["copilot", "capabilities"] as const;

/**
 * Copilot kernel/status primitives shared by the console and the full
 * settings page (/copilot/settings): the thin status strip above the chat
 * stream (CopilotStatusBar), the dsh kernel configuration section
 * (DshKernelSection: default model + plugin switches + runtime badge), the
 * capability tool list (CapabilitiesSection), and the runtime badge. When the
 * Gateway reports 404 for dsh-config (FORGEBADGER_DSH_COPILOT_ENABLED off) the
 * kernel section degrades to a not-enabled placeholder; the rest of the chat
 * stays unaffected.
 */

/** Thin status strip above the message stream: current model + dsh runtime. */
export function CopilotStatusBar() {
  const { t } = useLanguage();
  const dshConfig = useQuery({
    queryKey: dshConfigQueryKey,
    queryFn: getDshConfig,
    retry: false,
  });
  const modelProviders = useQuery({
    queryKey: modelProvidersQueryKey,
    queryFn: listModelProviders,
    enabled: Boolean(dshConfig.data),
  });

  // 404 (flag off) or any load failure: hide the strip entirely so the chat
  // surface is unaffected.
  const config = dshConfig.data;
  if (!config) return null;

  const models = (modelProviders.data?.models ?? []).filter((model) => model.status !== "disabled");
  const selected = config.defaultModelId
    ? models.find((model) => model.id === config.defaultModelId)
    : undefined;
  const modelLabel = config.defaultModelId
    ? selected
      ? `${selected.providerName} / ${selected.name}`
      : config.defaultModelId
    : t("copilot.dshFollowSystemDefault");

  return (
    <div
      className="flex items-center gap-2 border-b px-4 py-1.5 text-xs text-muted-foreground"
      data-testid="copilot-status-bar"
    >
      <span className="shrink-0">{t("copilot.currentModel")}</span>
      <span className="truncate">{modelLabel}</span>
      <DshRuntimeBadge status={config.runtime.status} />
    </div>
  );
}

interface DshKernelSectionProps {
  active: boolean;
  onError: (message: string | null) => void;
}

/** dsh kernel configuration: default model select + plugin switches + badge. */
export function DshKernelSection({ active, onError }: DshKernelSectionProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const dshConfig = useQuery({
    queryKey: dshConfigQueryKey,
    queryFn: getDshConfig,
    enabled: active,
    retry: false,
  });

  const modelProviders = useQuery({
    queryKey: modelProvidersQueryKey,
    queryFn: listModelProviders,
    enabled: active,
  });

  const dshMutation = useMutation({
    mutationFn: (input: UpdateDshConfigInput) => updateDshConfig(input),
    onSuccess: () => {
      onError(null);
      void queryClient.invalidateQueries({ queryKey: dshConfigQueryKey });
    },
    onError: () => onError(t("copilot.dshSaveError")),
  });

  // The Gateway returns 404 when FORGEBADGER_DSH_COPILOT_ENABLED is off; treat it
  // as "feature unavailable" instead of an error.
  const unavailable =
    dshConfig.error instanceof GatewayApiError && dshConfig.error.status === 404;
  const config = dshConfig.data;
  const models = (modelProviders.data?.models ?? []).filter((model) => model.status !== "disabled");

  const selectModel = (value: string) => {
    dshMutation.mutate({ defaultModelId: value === SYSTEM_DEFAULT_MODEL ? null : value });
  };

  const togglePlugin = (pluginId: string, enabled: boolean) => {
    if (!config) return;
    dshMutation.mutate({ plugins: { ...config.plugins, [pluginId]: enabled } });
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("copilot.dshKernel")}</p>
        {config ? <DshRuntimeBadge status={config.runtime.status} /> : null}
      </div>
      {dshConfig.isPending ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : unavailable ? (
        <p className="text-xs text-muted-foreground">{t("copilot.dshNotEnabled")}</p>
      ) : dshConfig.isError || !config ? (
        <p className="text-xs text-destructive">{t("copilot.dshLoadError")}</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("copilot.dshDefaultModel")}
            </Label>
            <Select
              value={config.defaultModelId ?? SYSTEM_DEFAULT_MODEL}
              onValueChange={selectModel}
              disabled={dshMutation.isPending}
            >
              <SelectTrigger aria-label={t("copilot.dshDefaultModel")} className="h-8 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SYSTEM_DEFAULT_MODEL}>
                  {t("copilot.dshFollowSystemDefault")}
                </SelectItem>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.providerName} / {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("copilot.dshPlugins")}
            </Label>
            {config.availablePlugins.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("copilot.dshNoPlugins")}</p>
            ) : (
              config.availablePlugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2"
                >
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium">{plugin.label}</p>
                    <p className="text-xs text-muted-foreground">{plugin.description}</p>
                  </div>
                  <Switch
                    aria-label={plugin.label}
                    size="sm"
                    className="mt-0.5"
                    disabled={dshMutation.isPending}
                    checked={config.plugins[plugin.id] ?? false}
                    onCheckedChange={(checked) => togglePlugin(plugin.id, checked)}
                  />
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Capability tool list: one row per tool with its name, description, and an
 * owner enable/disable switch (copilot_tool_preferences). Disabling hides the
 * tool from the model and refuses execution on both the in-process and dsh
 * paths.
 */
export function CapabilitiesSection({ active }: { active: boolean }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const capabilities = useQuery({
    queryKey: copilotCapabilitiesQueryKey,
    queryFn: getCopilotCapabilities,
    enabled: active,
    retry: false,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      setCopilotToolEnabled(name, enabled),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: copilotCapabilitiesQueryKey });
    },
    onError: () => setError(t("copilot.capabilitiesToggleError")),
  });

  const tools = capabilities.data?.tools ?? [];

  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-sm font-medium">{t("copilot.capabilities")}</p>
      {capabilities.isPending ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : capabilities.isError ? (
        <p className="text-xs text-destructive">{t("copilot.capabilitiesLoadError")}</p>
      ) : tools.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("copilot.capabilitiesEmpty")}</p>
      ) : (
        <div className="space-y-1.5">
          {tools.map((tool) => (
            <ToolRow
              key={tool.name}
              tool={tool}
              pending={toggleMutation.isPending}
              onToggle={(enabled) => toggleMutation.mutate({ name: tool.name, enabled })}
            />
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

function ToolRow({
  tool,
  pending,
  onToggle,
}: {
  tool: CopilotToolInfo;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useLanguage();
  // Localized description per tool name; unknown/new tools fall back to the
  // server-provided (English) description instead of rendering a raw key.
  const descriptionKey = `copilot.toolDesc.${tool.name}` as TranslationKey;
  const translated = t(descriptionKey);
  const description = translated === descriptionKey ? tool.description : translated;

  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2 transition-opacity ${
        tool.enabled ? "" : "opacity-60"
      }`}
      data-testid={`tool-row-${tool.name}`}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
          <Wrench className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono">{tool.name}</span>
          {tool.risk === "operate" ? (
            <Badge variant="outline" className="border-amber-500/50 px-1 py-0 text-[10px] text-amber-500">
              operate
            </Badge>
          ) : null}
          {tool.requiresApproval ? (
            <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
              approval
            </Badge>
          ) : null}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={tool.name}
        size="sm"
        className="mt-0.5 shrink-0"
        disabled={pending}
        checked={tool.enabled}
        onCheckedChange={onToggle}
      />
    </div>
  );
}

export function DshRuntimeBadge({ status }: { status: DshRuntimeStatus }) {
  const { t } = useLanguage();
  const dotClass =
    status === "running"
      ? "bg-emerald-500"
      : status === "idle"
        ? "bg-amber-500"
        : "bg-zinc-500";
  const labelKey =
    status === "running"
      ? "copilot.dshRuntimeRunning"
      : status === "idle"
        ? "copilot.dshRuntimeIdle"
        : "copilot.dshRuntimeOff";
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span className={`size-1.5 rounded-full ${dotClass}`} />
      {t(labelKey)}
    </Badge>
  );
}
