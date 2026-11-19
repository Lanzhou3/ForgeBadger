"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Lock } from "lucide-react";

import { SettingsCardHeader, SettingRow } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import {
  getRuntimeSettings,
  updateRuntimeSettings,
  runtimeSettingsMeta,
  runtimeSettingsValue,
  type RuntimeSettingsState,
} from "@/lib/api";
import { runtimeSettingsQueryKey } from "@/components/settings/InstanceRuntimeSettings";
import { toast } from "@/lib/toast";
import { useSettingsCopy } from "./settings-copy";

/**
 * Dispatch behavior card (retained standalone export): whether confirmed CLI
 * completion evidence auto-advances linked work items. Saves immediately on
 * toggle. Admin-only (the API enforces the same boundary).
 */
export function CopilotAutonomyPanel() {
  const { user } = useAuth();
  const copy = useSettingsCopy();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: runtimeSettingsQueryKey,
    queryFn: getRuntimeSettings,
    retry: false,
    enabled: user?.role === "admin",
  });

  const save = useMutation({
    mutationFn: (enabled: boolean) => updateRuntimeSettings({ pm_auto_dispatch: enabled }),
    onSuccess: (state: RuntimeSettingsState) => {
      queryClient.setQueryData(runtimeSettingsQueryKey, state);
      toast.success(copy.autonomySaved);
    },
    onError: () => toast.error(copy.autonomySaveError),
  });

  if (user?.role !== "admin") return null;

  const readonly = settings.data?.readonly ?? false;
  const autoDispatch = settings.data
    ? runtimeSettingsValue<boolean>(settings.data, "pm_auto_dispatch") ?? false
    : false;
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
          <div className="h-16 animate-pulse rounded-md border border-border/50 bg-muted/40" />
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
              disabled={readonly || save.isPending}
              onCheckedChange={(value) => save.mutate(value)}
            />
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
