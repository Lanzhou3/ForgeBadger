"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
import { SettingsCardHeader } from "@/components/settings/ui";
import { getClaudeRoute, setClaudeRoute } from "@/lib/api";

export function ClaudeRouteSettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const {
    data: routeState,
    isLoading: routeLoading,
    isError: routeError,
  } = useQuery({
    queryKey: ["claude-route"],
    queryFn: getClaudeRoute,
    retry: false,
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => setClaudeRoute(enabled),
    onSuccess: (state) => {
      queryClient.setQueryData(["claude-route"], state);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("settings.claudeRouteUpdateFailed"));
    },
  });

  const enabled = routeState?.enabled === true;

  return (
    <Card className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<Route className="size-4" />}
        title={t("settings.claudeRoute")}
        description={t("settings.claudeRouteDescription")}
        action={
          <Switch
            checked={enabled}
            disabled={routeLoading || routeError || toggleMutation.isPending}
            onCheckedChange={(next) => toggleMutation.mutate(next)}
            aria-label={t("settings.claudeRoute")}
          />
        }
      />
      <CardContent className="space-y-3">
        {routeError ? (
          <p className="text-xs text-destructive">{t("settings.claudeRouteLoadFailed")}</p>
        ) : routeState ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={enabled ? "secondary" : "outline"}>
                {enabled ? t("settings.claudeRouteStateEnabled") : t("settings.claudeRouteStateDisabled")}
              </Badge>
              <span className="break-all font-mono text-xs text-muted-foreground">
                {routeState.gatewayUrl}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("settings.claudeRouteAssignmentLabel")}:{" "}
              {routeState.assignment ? (
                <span className="font-medium text-foreground">{routeState.assignment.providerName}</span>
              ) : (
                t("settings.claudeRouteNoAssignment")
              )}
            </div>
            {enabled && (
              <p className="text-xs text-muted-foreground">{t("settings.claudeRouteGatewayDown")}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        )}
      </CardContent>
    </Card>
  );
}
