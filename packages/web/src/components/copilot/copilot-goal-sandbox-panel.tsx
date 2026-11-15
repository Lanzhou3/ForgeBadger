"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, ShieldCheck } from "lucide-react";

import { SettingsCardHeader, SettingRow } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { runtimeSettingsQueryKey } from "@/components/settings/InstanceRuntimeSettings";
import { useAuth } from "@/hooks/use-auth";
import { getRuntimeSettings, runtimeSettingsValue, updateRuntimeSettings, type RuntimeSettingsState } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useSettingsCopy } from "./settings-copy";

/**
 * Goal check isolation switch (Copilot settings → general). Applies to the
 * whole Gateway immediately; the switch is disabled when the host cannot
 * isolate, because isolation never falls back to the host. Admin-only (the
 * API enforces the same boundary).
 */
export function CopilotGoalSandboxPanel() {
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
    mutationFn: (enabled: boolean) => updateRuntimeSettings({ goal_check_sandbox: enabled }),
    onSuccess: (state: RuntimeSettingsState, enabled) => {
      queryClient.setQueryData(runtimeSettingsQueryKey, state);
      toast.success(enabled ? copy.sandboxEnabled : copy.sandboxDisabled);
    },
    onError: () => toast.error(copy.autonomySaveError),
  });

  if (user?.role !== "admin") return null;

  const readonly = settings.data?.readonly ?? false;
  const enabled = settings.data ? runtimeSettingsValue<boolean>(settings.data, "goal_check_sandbox") ?? false : false;
  const support = settings.data?.capabilities?.goalCheckSandbox;
  const unavailable = support !== undefined && !support.available;
  // Turning it off stays possible on a host that lost support.
  const disabled = readonly || save.isPending || (unavailable && !enabled);

  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "180ms" }}>
      <SettingsCardHeader
        icon={<ShieldCheck className="size-4" />}
        title={copy.sandboxTitle}
        description={copy.sandboxDescription}
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
          <p className="text-xs text-muted-foreground">…</p>
        ) : (
          <>
            {readonly && (
              <p className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
                {copy.autonomyReadonly}
              </p>
            )}
            <SettingRow
              title={copy.sandboxToggle}
              description={copy.sandboxToggleDescription}
              checked={enabled}
              disabled={disabled}
              onCheckedChange={(value) => save.mutate(value)}
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
