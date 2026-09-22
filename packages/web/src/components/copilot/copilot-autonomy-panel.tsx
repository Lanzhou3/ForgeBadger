"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import {
  discoverAdapters,
  getRuntimeSettings,
  runtimeSettingsMeta,
  runtimeSettingsValue,
  updateRuntimeSettings,
} from "@/lib/api";
import { runtimeSettingsQueryKey } from "@/components/settings/InstanceRuntimeSettings";
import { toast } from "@/lib/toast";
import { useSettingsCopy } from "./settings-copy";

const AUTONOMY_ADAPTER_IDS = ["claude", "opencode", "codex", "kimi", "pi"] as const;

/**
 * Dispatch autonomy card (Copilot settings → general): operator opt-in for
 * programmatic CLI control. Adapters without autonomy are denied at dispatch
 * time with ADAPTER_AUTONOMY_UNVERIFIED; no approval or Grant can override.
 * Admin-only (the API enforces the same boundary).
 */
export function CopilotAutonomyPanel() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const copy = useSettingsCopy();
  const queryClient = useQueryClient();
  const [enabledAdapters, setEnabledAdapters] = useState<string[]>([]);
  const [autoDispatch, setAutoDispatch] = useState(false);
  const [dirty, setDirty] = useState(false);

  const settings = useQuery({
    queryKey: runtimeSettingsQueryKey,
    queryFn: getRuntimeSettings,
    retry: false,
    enabled: user?.role === "admin",
  });
  const discovery = useQuery({
    queryKey: ["adapters", "discovery", "autonomy-panel"],
    queryFn: discoverAdapters,
    retry: false,
    enabled: user?.role === "admin",
  });

  useEffect(() => {
    if (!settings.data) return;
    setEnabledAdapters(runtimeSettingsValue<string[]>(settings.data, "cli_autonomy_adapters") ?? []);
    setAutoDispatch(runtimeSettingsValue<boolean>(settings.data, "pm_auto_dispatch") ?? false);
    setDirty(false);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      updateRuntimeSettings({
        cli_autonomy_adapters: enabledAdapters,
        pm_auto_dispatch: autoDispatch
      }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey });
      toast.success(copy.autonomySaved);
    },
    onError: () => toast.error(copy.autonomySaveError),
  });

  if (user?.role !== "admin") return null;

  const readonly = settings.data?.readonly ?? false;
  const adaptersSource = settings.data ? runtimeSettingsMeta(settings.data, "cli_autonomy_adapters")?.source : undefined;
  const availability = new Map((discovery.data?.adapters ?? []).map((adapter) => [adapter.id, adapter]));

  function toggleAdapter(id: string) {
    setEnabledAdapters((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return AUTONOMY_ADAPTER_IDS.filter((known) => next.includes(known));
    });
    setDirty(true);
  }

  return (
    <section
      className="forgebadger-animate-in space-y-3 rounded-lg border border-border bg-card p-4"
      style={{ animationDelay: "150ms" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">{copy.autonomyTitle}</h2>
        {readonly && (
          <Badge variant="outline" className="gap-1">
            <Lock className="size-3" />
            {copy.autonomySourceEnv}
          </Badge>
        )}
        <SourceBadge source={adaptersSource} labelEnv={copy.autonomySourceEnv} labelSettings={copy.autonomySourceSettings} />
      </div>
      <p className="text-xs text-muted-foreground">{copy.autonomyDescription}</p>

      {settings.isError ? (
        <div className="flex items-center gap-3 text-xs text-destructive">
          {copy.autonomyLoadError}
          <Button type="button" variant="ghost" size="sm" className="h-6" onClick={() => void settings.refetch()}>
            {copy.autonomyRetry}
          </Button>
        </div>
      ) : settings.isLoading ? (
        <p className="text-xs text-muted-foreground">…</p>
      ) : (
        <div className="space-y-3">
          {readonly && (
            <p className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
              {copy.autonomyReadonly}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {AUTONOMY_ADAPTER_IDS.map((id) => {
              const adapter = availability.get(id);
              const checked = enabledAdapters.includes(id);
              return (
                <label
                  key={id}
                  className={`flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs ${
                    readonly ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleAdapter(id)}
                    disabled={readonly}
                    aria-label={id}
                  />
                  <span className="font-mono font-medium">{id}</span>
                  <span className="ml-auto text-muted-foreground">
                    {adapter ? (adapter.available ? copy.autonomyInstalled : copy.autonomyMissing) : ""}
                  </span>
                </label>
              );
            })}
          </div>
          {enabledAdapters.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{copy.autonomyEmptyNote}</p>
          )}
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-medium">{copy.autonomyAutoDispatch}</p>
              <p className="text-xs text-muted-foreground">
                {enabledAdapters.length === 0 ? copy.autonomyAutoDispatchBlocked : copy.autonomyAutoDispatchDescription}
              </p>
            </div>
            <Switch
              checked={autoDispatch}
              onCheckedChange={(value) => {
                setAutoDispatch(value);
                setDirty(true);
              }}
              disabled={readonly || enabledAdapters.length === 0}
            />
          </div>
          <div>
            <Button
              size="sm"
              className="h-8"
              disabled={readonly || !dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? copy.autonomySaving : t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SourceBadge({
  source,
  labelEnv,
  labelSettings
}: {
  source?: "env" | "settings";
  labelEnv: string;
  labelSettings: string;
}) {
  if (!source) return null;
  return (
    <Badge variant={source === "settings" ? "secondary" : "outline"} className="h-4 px-1.5 text-[10px]">
      {source === "settings" ? labelSettings : labelEnv}
    </Badge>
  );
}
