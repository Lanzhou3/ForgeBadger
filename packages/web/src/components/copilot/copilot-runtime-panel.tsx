"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
import { listModelProviders } from "@/lib/api";
import {
  getCopilotCapabilities,
  setCopilotToolEnabled,
  type CopilotToolInfo,
} from "@/lib/copilot-api";
import type { TranslationKey } from "@/lib/i18n";

export const modelProvidersQueryKey = ["model-providers"] as const;
export const copilotCapabilitiesQueryKey = ["copilot", "capabilities"] as const;

/** Thin status strip for the self-owned Gateway runtime and its default model. */
export function CopilotStatusBar() {
  const { t } = useLanguage();
  const modelProviders = useQuery({
    queryKey: modelProvidersQueryKey,
    queryFn: listModelProviders,
  });
  const models = (modelProviders.data?.models ?? []).filter((model) => model.status !== "disabled");
  const selected = models.find((model) => model.isDefault) ?? models[0];
  const modelLabel = selected
    ? `${selected.providerName} / ${selected.name}`
    : t("copilot.followSystemDefault");

  return (
    <div
      className="flex items-center gap-2 border-b px-4 py-1.5 text-xs text-muted-foreground"
      data-testid="copilot-status-bar"
    >
      <span className="shrink-0">{t("copilot.currentModel")}</span>
      <span className="truncate">{modelLabel}</span>
      <Badge variant="secondary" className="ml-auto gap-1.5 whitespace-nowrap">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {t("copilot.nativeRuntime")}
      </Badge>
    </div>
  );
}

/** User-scoped switches for tools exposed to the Gateway-native orchestrator. */
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
