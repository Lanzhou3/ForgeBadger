"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Cpu, Search, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/hooks/use-language";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { listModelProviders } from "@/lib/api";
import {
  getCopilotCapabilities,
  getCopilotPreferences,
  setCopilotToolEnabled,
  updateCopilotPreferences,
  type CopilotThinkingEffort,
  type CopilotToolInfo,
} from "@/lib/copilot-api";
import { copilotSkillsKey } from "@/lib/copilot-extensions-api";
import type { TranslationKey } from "@/lib/i18n";

export const modelProvidersQueryKey = ["model-providers"] as const;
export const copilotCapabilitiesQueryKey = ["copilot", "capabilities"] as const;
export const copilotPreferencesQueryKey = ["copilot", "preferences"] as const;

export const copilotContextTriggerClassName = "data-[size=sm]:h-7 sm:data-[size=sm]:h-6 gap-1.5 rounded-md border-border/70 bg-muted/30 px-2 py-0 text-[11px] font-medium text-muted-foreground shadow-none hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/20 [&_svg]:size-3";

const THINKING_EFFORT_OPTIONS: CopilotThinkingEffort[] = ["off", "low", "medium", "high"];

// Radix Select items cannot use an empty value; this sentinel maps back to
// "follow the system default model" in onValueChange.
const DEFAULT_MODEL_VALUE = "__default_model__";

/**
 * Status controls for Copilot's model and thinking effort preferences.
 * The server-side preference (per user) is the source of truth: reads go through
 * the preferences query and both pickers write back with a mutation. The
 * parent's modelId mirror stays in sync via onModelChange.
 */
export function CopilotStatusBar({
  onModelChange,
  controlsDisabled,
  onSavingChange,
  onModelPicked,
  modelOverrideId,
  showLabels = false,
}: {
  /** When provided, the model label becomes a picker. */
  onModelChange?: (modelId: string | null) => void;
  /** Disables both pickers, e.g. while a run is in flight. */
  controlsDisabled?: boolean;
  onSavingChange?: (saving: boolean) => void;
  /** Fired only when the user explicitly picks a model (not on preference sync). */
  onModelPicked?: (modelId: string | null) => void;
  /** Model shown in place of the stored preference, e.g. the plan model in Plan Mode. */
  modelOverrideId?: string | null;
  /** Render labelled form controls (Settings page) instead of compact composer pills. */
  showLabels?: boolean;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const modelProviders = useQuery({
    queryKey: modelProvidersQueryKey,
    queryFn: listModelProviders,
  });
  const preferences = useQuery({
    queryKey: copilotPreferencesQueryKey,
    queryFn: getCopilotPreferences,
    retry: false,
  });
  const models = (modelProviders.data?.models ?? []).filter((model) => model.status !== "disabled");
  const preferencesReady = preferences.isSuccess;
  const defaultModel = models.find((model) => model.isDefault) ?? models[0];
  const storedModelId = preferences.data?.modelId ?? null;
  const shownModelId = models.some(model => model.id === modelOverrideId && model.status === "active")
    ? modelOverrideId
    : storedModelId;
  const storedModel = shownModelId ? models.find((model) => model.id === shownModelId) : undefined;
  const effectiveModel = storedModel ?? defaultModel;
  const modelLabel = effectiveModel
    ? `${effectiveModel.providerName} / ${effectiveModel.name}`
    : t("copilot.followSystemDefault");
  const defaultLabel = defaultModel ? `${defaultModel.providerName} / ${defaultModel.name}` : null;

  const preferencesMutation = useMutation({
    mutationFn: updateCopilotPreferences,
    onSuccess: (saved) => {
      queryClient.setQueryData(copilotPreferencesQueryKey, saved);
      onModelChange?.(saved.modelId);
      void queryClient.invalidateQueries({ queryKey: copilotPreferencesQueryKey });
    },
    onError: () => toast.error(t("copilot.preferencesFailed")),
  });

  // Surface a failed preference load once per error episode instead of an
  // inline red line inside the status strip.
  const preferencesErrorToastRef = useRef(false);
  useEffect(() => {
    if (preferences.isError && !preferencesErrorToastRef.current) {
      preferencesErrorToastRef.current = true;
      toast.error(t("copilot.loadError"));
    }
    if (!preferences.isError) preferencesErrorToastRef.current = false;
  }, [preferences.isError, t]);

  useEffect(() => {
    if (preferencesReady) onModelChange?.(storedModelId);
  }, [preferencesReady, storedModelId, onModelChange]);
  useEffect(() => { onSavingChange?.(preferencesMutation.isPending); }, [preferencesMutation.isPending, onSavingChange]);

  // Self-heal a stored selection whose profile was deleted or disabled:
  // clear the parent's mirror and write modelId: null to the server. The ref
  // avoids hammering the server while the write keeps failing.
  const healAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    // Wait for the model list to load; healing against an empty (still
    // loading) list would wrongly clear a valid preference.
    if (!modelProviders.data || !storedModelId || !onModelChange) return;
    if (models.some((model) => model.id === storedModelId)) {
      healAttemptedRef.current = null;
      return;
    }
    if (healAttemptedRef.current === storedModelId) return;
    healAttemptedRef.current = storedModelId;
    onModelChange(null);
    void preferencesMutation.mutate({ modelId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelProviders.data, storedModelId, onModelChange]);

  const modelPicker = onModelChange ? (
    <Select
      value={shownModelId ?? DEFAULT_MODEL_VALUE}
      disabled={!preferencesReady || preferencesMutation.isPending || controlsDisabled}
      onValueChange={(next) => {
        const picked = next === DEFAULT_MODEL_VALUE ? null : next;
        preferencesMutation.mutate({ modelId: picked }, { onSuccess: () => onModelPicked?.(picked) });
      }}
    >
      <SelectTrigger
        id={showLabels ? "copilot-default-model" : undefined}
        aria-label={t("copilot.currentModel")}
        title={modelLabel}
        size="sm"
        className={
          showLabels
            ? "h-9 w-full text-xs"
            : cn(copilotContextTriggerClassName, "min-w-0 max-w-32")
        }
      >
        <Cpu aria-hidden="true" className={showLabels ? "size-3.5 text-muted-foreground" : "size-3"} />
        <SelectValue className="min-w-0 truncate">
          {showLabels ? undefined : (storedModel?.name ?? t("copilot.followSystemDefault"))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        side={showLabels ? "bottom" : "top"}
        align="start"
        className={showLabels ? undefined : "max-w-[calc(100vw-1.5rem)]"}
      >
        <SelectGroup>
          <SelectItem value={DEFAULT_MODEL_VALUE}>
            {t("copilot.followSystemDefault")}
            {defaultLabel ? `（${defaultLabel}）` : ""}
          </SelectItem>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.providerName} / {model.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  ) : (
    <span className={showLabels ? "block truncate rounded-md border border-border/70 px-3 py-2 text-xs" : "truncate"}>
      {modelLabel}
    </span>
  );

  const thinkingPicker = (
    <Select
      value={preferences.data?.thinkingEffort ?? "off"}
      disabled={!preferencesReady || preferencesMutation.isPending || controlsDisabled}
      onValueChange={(next) => {
        void preferencesMutation.mutate({ thinkingEffort: next as CopilotThinkingEffort });
      }}
    >
      <SelectTrigger
        id={showLabels ? "copilot-thinking-effort" : undefined}
        aria-label={t("copilot.thinkingEffort")}
        size="sm"
        title={t("copilot.thinkingEffort")}
        className={showLabels ? "h-9 w-full text-xs" : cn(copilotContextTriggerClassName, "shrink-0")}
      >
        <Brain aria-hidden="true" className={showLabels ? "size-3.5 text-muted-foreground" : "size-3"} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent side={showLabels ? "bottom" : "top"} align="start">
        <SelectGroup>
          {THINKING_EFFORT_OPTIONS.map((effort) => (
            <SelectItem key={effort} value={effort}>
              {t(`copilot.thinking${effort.charAt(0).toUpperCase()}${effort.slice(1)}` as TranslationKey)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <div
      className={showLabels ? "grid gap-3 sm:grid-cols-2" : "contents"}
      data-testid="copilot-status-bar"
    >
      {showLabels ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="copilot-default-model" className="text-xs font-medium text-muted-foreground">
              {t("copilot.currentModel")}
            </Label>
            {modelPicker}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="copilot-thinking-effort" className="text-xs font-medium text-muted-foreground">
              {t("copilot.thinkingEffort")}
            </Label>
            {thinkingPicker}
          </div>
          {([
            ["planModelId", "copilot-plan-model", "copilot.planModel", "copilot.planModelHint"],
            ["subagentModelId", "copilot-subagent-model", "copilot.subagentModel", "copilot.subagentModelHint"],
          ] as const).map(([field, id, label, hint]) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{t(label)}</Label>
              <Select
                value={preferences.data?.[field] ?? DEFAULT_MODEL_VALUE}
                disabled={!preferencesReady || preferencesMutation.isPending || controlsDisabled}
                onValueChange={(next) => {
                  void preferencesMutation.mutate({ [field]: next === DEFAULT_MODEL_VALUE ? null : next });
                }}
              >
                <SelectTrigger id={id} aria-label={t(label)} size="sm" className="h-9 w-full text-xs">
                  <Cpu aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="bottom" align="start">
                  <SelectGroup>
                    <SelectItem value={DEFAULT_MODEL_VALUE}>{t("copilot.sameAsCopilotModel")}</SelectItem>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>{model.providerName} / {model.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t(hint)}</p>
            </div>
          ))}
        </>
      ) : (
        <>
          <span className="sr-only">{t("copilot.currentModel")}</span>
          {modelPicker}
          <span className="sr-only">{t("copilot.thinkingEffort")}</span>
          {thinkingPicker}
        </>
      )}
    </div>
  );
}

/** User-scoped switches for tools exposed to the Gateway-native orchestrator. */
export function CapabilitiesSection({ active }: { active: boolean }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
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
      void queryClient.invalidateQueries({ queryKey: copilotCapabilitiesQueryKey });
      void queryClient.invalidateQueries({ queryKey: copilotSkillsKey });
    },
    onError: () => toast.error(t("copilot.capabilitiesToggleError")),
  });

  // Toast once per load-error episode instead of a persistent inline red line.
  const capabilitiesErrorToastRef = useRef(false);
  useEffect(() => {
    if (capabilities.isError && !capabilitiesErrorToastRef.current) {
      capabilitiesErrorToastRef.current = true;
      toast.error(t("copilot.capabilitiesLoadError"));
    }
    if (!capabilities.isError) capabilitiesErrorToastRef.current = false;
  }, [capabilities.isError, t]);

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
        <div className="space-y-2" aria-busy="true" aria-label={t("common.loading")}>
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-14 animate-pulse rounded-md border border-border/50 bg-muted/40" />
          ))}
        </div>
      ) : capabilities.isError ? null : tools.length === 0 ? (
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
        tool.enabled && tool.available ? "" : "opacity-60"
      }`}
      data-testid={`tool-row-${tool.name}`}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
          <Wrench className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono">{tool.name}</span>
          {tool.risk === "operate" ? (
            <Badge variant="outline" className="border-warning/40 bg-warning/10 px-1 py-0 text-[10px] text-warning">
              {t("copilot.toolRiskOperate")}
            </Badge>
          ) : null}
          {tool.requiresApproval && tool.available ? (
            <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
              {t("copilot.toolAuthorization")}
            </Badge>
          ) : null}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        {!tool.available ? (
          <p className="text-xs text-warning">
            {t("copilot.toolUnavailable")}: {tool.unavailableReason ?? t("copilot.toolUnavailable")}
          </p>
        ) : null}
      </div>
      <Switch
        aria-label={tool.name}
        size="sm"
        className="mt-0.5 shrink-0"
        disabled={pending || !tool.available}
        checked={tool.enabled}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
