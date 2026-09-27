"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, Lock } from "lucide-react";

import { SettingsCardHeader, SettingRow } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <Card className="forgebadger-animate-in" style={{ animationDelay: "150ms" }}>
      <SettingsCardHeader
        icon={<Bot className="size-4" />}
        title={copy.autonomyTitle}
        description={copy.autonomyDescription}
        action={
          <>
            {readonly && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                {copy.autonomySourceEnv}
              </Badge>
            )}
            <SourceBadge source={adaptersSource} labelEnv={copy.autonomySourceEnv} labelSettings={copy.autonomySourceSettings} />
          </>
        }
      />
      <CardContent className="space-y-3">
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
          <>
            {readonly && (
              <p className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
                {copy.autonomyReadonly}
              </p>
            )}
            <div className="space-y-2">
              {AUTONOMY_ADAPTER_IDS.map((id) => {
                const adapter = availability.get(id);
                return (
                  <SettingRow
                    key={id}
                    title={id}
                    description={adapter ? (adapter.available ? copy.autonomyInstalled : copy.autonomyMissing) : ""}
                    checked={enabledAdapters.includes(id)}
                    disabled={readonly}
                    onCheckedChange={() => toggleAdapter(id)}
                  />
                );
              })}
            </div>
            {enabledAdapters.length === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{copy.autonomyEmptyNote}</span>
              </div>
            )}
            <SettingRow
              title={copy.autonomyAutoDispatch}
              description={enabledAdapters.length === 0 ? copy.autonomyAutoDispatchBlocked : copy.autonomyAutoDispatchDescription}
              checked={autoDispatch}
              disabled={readonly || enabledAdapters.length === 0}
              onCheckedChange={(value) => {
                setAutoDispatch(value);
                setDirty(true);
              }}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-8"
                disabled={readonly || !dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? copy.autonomySaving : t("common.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
