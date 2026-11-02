"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Route, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
import { SettingsCardHeader } from "@/components/settings/ui";
import {
  getClaudeRoute,
  listModelProviders,
  setClaudeRoute,
  setClaudeRouteAssignments,
} from "@/lib/api";

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

  const { data: catalog } = useQuery({
    queryKey: ["model-providers"],
    queryFn: listModelProviders,
    retry: false,
  });

  const [selectedProvider, setSelectedProvider] = useState("");

  const applyState = (state: NonNullable<typeof routeState>) => {
    queryClient.setQueryData(["claude-route"], state);
  };

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => setClaudeRoute(enabled),
    onSuccess: applyState,
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("settings.claudeRouteUpdateFailed"));
    },
  });

  const assignments = routeState?.assignments ?? [];

  const orderMutation = useMutation({
    mutationFn: (next: Array<{ providerProfileId: string; credentialId?: string }>) =>
      setClaudeRouteAssignments(next),
    onSuccess: applyState,
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("settings.claudeRouteFailoverUpdateFailed"));
    },
  });

  const currentOrder = () =>
    assignments.map((entry) => ({ providerProfileId: entry.providerProfileId }));

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= assignments.length) return;
    const next = currentOrder();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    orderMutation.mutate(next);
  };

  const remove = (index: number) => {
    if (assignments.length <= 1) return;
    orderMutation.mutate(
      assignments
        .filter((_, i) => i !== index)
        .map((entry) => ({ providerProfileId: entry.providerProfileId })),
    );
  };

  const addableProviders = useMemo(() => {
    const assigned = new Set(assignments.map((entry) => entry.providerProfileId));
    return (catalog?.providers ?? []).filter(
      (provider) =>
        provider.status === "active" &&
        provider.supportedAdapters.includes("claude") &&
        !assigned.has(provider.id),
    );
  }, [catalog?.providers, assignments]);

  const add = () => {
    if (!selectedProvider) return;
    orderMutation.mutate([...currentOrder(), { providerProfileId: selectedProvider }]);
    setSelectedProvider("");
  };

  const enabled = routeState?.enabled === true;
  const busy = orderMutation.isPending;

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

            <div className="space-y-1.5">
              <div className="text-xs font-medium">{t("settings.claudeRouteFailover")}</div>
              <p className="text-xs text-muted-foreground">
                {t("settings.claudeRouteFailoverDescription")}
              </p>
              {assignments.length === 0 ? (
                <p className="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground">
                  {t("settings.claudeRouteFailoverEmpty")}
                </p>
              ) : (
                <div className="space-y-1">
                  {assignments.map((entry, index) => (
                    <div
                      key={entry.providerProfileId}
                      className="flex items-center gap-1.5 rounded-md border px-2 py-1.5"
                    >
                      <span className="w-4 text-center font-mono text-xs text-muted-foreground">
                        {entry.position}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium">
                          {entry.providerName ?? entry.providerProfileId}
                        </span>
                        {index === 0 && (
                          <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                            {t("settings.claudeRouteFailoverPrimary")}
                          </Badge>
                        )}
                        {entry.providerStatus !== null && entry.providerStatus !== "active" && (
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">
                            {t("settings.claudeRouteFailoverInactive")}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {t("settings.claudeRouteFailoverModelsCount").replace(
                            "{count}",
                            String(entry.modelIds.length),
                          )}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={index === 0 || busy}
                        onClick={() => move(index, -1)}
                        aria-label={t("settings.claudeRouteFailoverUp")}
                      >
                        <ArrowUp className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={index === assignments.length - 1 || busy}
                        onClick={() => move(index, 1)}
                        aria-label={t("settings.claudeRouteFailoverDown")}
                      >
                        <ArrowDown className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={assignments.length <= 1 || busy}
                        onClick={() => remove(index)}
                        aria-label={t("settings.claudeRouteFailoverRemove")}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {addableProviders.length > 0 && (
                <div className="flex gap-2">
                  <select
                    value={selectedProvider}
                    onChange={(event) => setSelectedProvider(event.target.value)}
                    className="h-7 flex-1 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-label={t("settings.claudeRouteFailoverAdd")}
                  >
                    <option value="">{t("settings.claudeRouteFailoverAdd")}</option>
                    {addableProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={!selectedProvider || busy}
                    onClick={add}
                    aria-label={t("settings.claudeRouteFailoverAdd")}
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>
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
