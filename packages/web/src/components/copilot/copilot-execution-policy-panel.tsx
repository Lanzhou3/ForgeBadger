"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Lock, ShieldCheck } from "lucide-react";

import { runtimeSettingsQueryKey } from "@/components/settings/InstanceRuntimeSettings";
import { SettingsCardHeader, SettingRow } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import {
  getRuntimeSettings,
  runtimeSettingsValue,
  updateRuntimeSettings,
  type RuntimeSettingsState,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { useSettingsCopy } from "./settings-copy";

/**
 * Unified Execution & Safety Policy card (Copilot settings -> general):
 * merges `pm_auto_dispatch` and `goal_check_sandbox` into one cohesive
 * instant-save card. Admin-only (the API enforces the same boundary).
 */
export function CopilotExecutionPolicyPanel() {
  const { user } = useAuth();
  const copy = useSettingsCopy();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: runtimeSettingsQueryKey,
    queryFn: getRuntimeSettings,
    retry: false,
    enabled: user?.role === "admin",
  });

  const saveAutoDispatch = useMutation({
    mutationFn: (enabled: boolean) => updateRuntimeSettings({ pm_auto_dispatch: enabled }),
    onSuccess: (state: RuntimeSettingsState) => {
      queryClient.setQueryData(runtimeSettingsQueryKey, state);
      toast.success(copy.autonomySaved);
    },
    onError: () => toast.error(copy.autonomySaveError),
  });

  const saveSandbox = useMutation({
    mutationFn: (enabled: boolean) => updateRuntimeSettings({ goal_check_sandbox: enabled }),
    onSuccess: (state: RuntimeSettingsState, enabled) => {
      queryClient.setQueryData(runtimeSettingsQueryKey, state);
      toast.success(enabled ? copy.sandboxEnabled : copy.sandboxDisabled);
    },
    onError: () => toast.error(copy.autonomySaveError),
  });

  if (user?.role !== "admin") return null;

  const readonly = settings.data?.readonly ?? false;
  const autoDispatch = settings.data
    ? runtimeSettingsValue<boolean>(settings.data, "pm_auto_dispatch") ?? false
    : false;
  const sandboxEnabled = settings.data
    ? runtimeSettingsValue<boolean>(settings.data, "goal_check_sandbox") ?? false
    : false;
  const support = settings.data?.capabilities?.goalCheckSandbox;
  const unavailable = support !== undefined && !support.available;
  // Turning it off stays possible on a host that lost support.
  const sandboxDisabled = readonly || saveSandbox.isPending || (unavailable && !sandboxEnabled);

  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "120ms" }}>
      <SettingsCardHeader
        icon={<ShieldCheck className="size-4" />}
        title={copy.executionPolicyTitle}
        description={copy.executionPolicyDescription}
        action={
          readonly ? (
            <Badge variant="outline" className="gap-1">
              <Lock className="size-3" />
              {copy.autonomySourceEnv}
            </Badge>
          ) : null
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
          <div className="space-y-2" aria-busy="true">
            <div className="h-16 animate-pulse rounded-md border border-border/50 bg-muted/40" />
            <div className="h-16 animate-pulse rounded-md border border-border/50 bg-muted/40" />
          </div>
        ) : (
          <>
            {readonly && (
              <p className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
                {copy.autonomyReadonly}
              </p>
            )}
            <SettingRow
              icon={<Bot className="size-4 text-muted-foreground" />}
              title={copy.autonomyAutoDispatch}
              description={copy.autonomyAutoDispatchDescription}
              checked={autoDispatch}
              disabled={readonly || saveAutoDispatch.isPending}
              onCheckedChange={(value) => saveAutoDispatch.mutate(value)}
            />
            <SettingRow
              icon={<ShieldCheck className="size-4 text-muted-foreground" />}
              title={copy.sandboxToggle}
              description={copy.sandboxToggleDescription}
              checked={sandboxEnabled}
              disabled={sandboxDisabled}
              onCheckedChange={(value) => saveSandbox.mutate(value)}
            />
            {unavailable && (
              <p role="note" className="text-xs text-muted-foreground">
                {copy.sandboxUnavailable(support.reason ?? "")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
