"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
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
      <CardHeader className="flex flex-wrap items-center gap-3 space-y-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Route className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm font-semibold">{t("settings.claudeRoute")}</CardTitle>
          <CardDescription className="mt-1 text-xs">
            {t("settings.claudeRouteDescription")}
          </CardDescription>
        </div>
        <Switch
          checked={enabled}
          disabled={routeLoading || routeError || toggleMutation.isPending}
          onCheckedChange={(next) => toggleMutation.mutate(next)}
          aria-label={t("settings.claudeRoute")}
        />
      </CardHeader>
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
