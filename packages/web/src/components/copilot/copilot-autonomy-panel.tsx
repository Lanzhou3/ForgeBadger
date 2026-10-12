"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Lock } from "lucide-react";

import { SettingsCardHeader, SettingRow } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import {
  getRuntimeSettings,
  updateRuntimeSettings,
  runtimeSettingsMeta,
  runtimeSettingsValue,
} from "@/lib/api";
import { runtimeSettingsQueryKey } from "@/components/settings/InstanceRuntimeSettings";
import { toast } from "@/lib/toast";
import { useSettingsCopy } from "./settings-copy";

/**
 * Dispatch behavior card (Copilot settings → general): whether confirmed CLI
 * completion evidence auto-advances linked work items. Programmatic dispatch
 * is open to every project by default — there is deliberately no per-adapter
 * allowlist, so every code CLI is equal. Admin-only (the API enforces the
 * same boundary).
 */
export function CopilotAutonomyPanel() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const copy = useSettingsCopy();
  const queryClient = useQueryClient();
  const [autoDispatch, setAutoDispatch] = useState(false);
  const [dirty, setDirty] = useState(false);

  const settings = useQuery({
    queryKey: runtimeSettingsQueryKey,
    queryFn: getRuntimeSettings,
    retry: false,
    enabled: user?.role === "admin",
  });

  useEffect(() => {
    if (!settings.data) return;
    setAutoDispatch(runtimeSettingsValue<boolean>(settings.data, "pm_auto_dispatch") ?? false);
    setDirty(false);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => updateRuntimeSettings({ pm_auto_dispatch: autoDispatch }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey });
      toast.success(copy.autonomySaved);
    },
    onError: () => toast.error(copy.autonomySaveError),
  });

  if (user?.role !== "admin") return null;

  const readonly = settings.data?.readonly ?? false;
  const source = settings.data ? runtimeSettingsMeta(settings.data, "pm_auto_dispatch")?.source : undefined;

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
            <SourceBadge source={source} labelEnv={copy.autonomySourceEnv} labelSettings={copy.autonomySourceSettings} />
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
            <SettingRow
              title={copy.autonomyAutoDispatch}
              description={copy.autonomyAutoDispatchDescription}
              checked={autoDispatch}
              disabled={readonly}
              onCheckedChange={(value) => {
                setAutoDispatch(value);
                setDirty(true);
              }}
            />
            {/* Sticky so the save action stays visible at the bottom of the
                settings scroll container instead of being clipped below the
                first viewport. -bottom-6 matches the Card's py-6 bottom
                padding so the row settles into its natural rest position
                without a jump when the scroll reaches the end. */}
            <div className="sticky -bottom-6 z-10 -mx-6 flex justify-end border-t border-border/70 bg-card/95 px-6 py-2.5 backdrop-blur-sm">
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
