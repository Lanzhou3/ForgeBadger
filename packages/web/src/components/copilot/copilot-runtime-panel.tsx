"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  const [query, setQuery] = useState("");

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
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(normalized))
    : tools;
  const operateTools = filtered.filter((tool) => tool.risk === "operate");
  const readTools = filtered.filter((tool) => tool.risk !== "operate");

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("copilot.capabilities")}</p>
        {!capabilities.isPending && !capabilities.isError && tools.length > 0 ? (
          <div className="relative w-48 max-w-full">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("copilot.toolsSearch")}
              className="h-8 pl-8 text-xs"
            />
          </div>
        ) : null}
      </div>
      {capabilities.isPending ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : capabilities.isError ? (
        <p className="text-xs text-destructive">{t("copilot.capabilitiesLoadError")}</p>
      ) : tools.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("copilot.capabilitiesEmpty")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("copilot.toolsSearchEmpty")}</p>
      ) : (
        <div className="space-y-3">
          {operateTools.length > 0 ? (
            <ToolGroup
              title={t("copilot.toolGroupOperate")}
              tools={operateTools}
              pending={toggleMutation.isPending}
              onToggle={(name, enabled) => toggleMutation.mutate({ name, enabled })}
            />
          ) : null}
          {readTools.length > 0 ? (
            <ToolGroup
              title={t("copilot.toolGroupRead")}
              tools={readTools}
              pending={toggleMutation.isPending}
              onToggle={(name, enabled) => toggleMutation.mutate({ name, enabled })}
            />
          ) : null}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

function ToolGroup({
  title,
  tools,
  pending,
  onToggle,
}: {
  title: string;
  tools: CopilotToolInfo[];
  pending: boolean;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
        {title}
      </p>
      {tools.map((tool) => (
        <ToolRow key={tool.name} tool={tool} pending={pending} onToggle={(enabled) => onToggle(tool.name, enabled)} />
      ))}
    </div>
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
