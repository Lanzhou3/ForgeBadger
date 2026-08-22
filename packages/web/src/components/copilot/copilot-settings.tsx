"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
import { GatewayApiError, listModelProviders } from "@/lib/api";
import {
  dshConfigQueryKey,
  getDshConfig,
  updateDshConfig,
  type DshConfig,
  type DshRuntimeStatus,
  type UpdateDshConfigInput,
} from "@/lib/copilot-api";
import {
  getPortfolioHeartbeat,
  portfolioQueryKeys,
  updatePortfolioHeartbeat,
} from "@/lib/portfolio-api";

const SYSTEM_DEFAULT_MODEL = "__system_default__";

/**
 * Copilot settings popover. Hosts the operations heartbeat control migrated
 * from the retired Portfolio Operations page: the toggle drives the Gateway's
 * proactive portfolio scheduler (which also triggers Copilot's reactive loop),
 * plus the dsh kernel configuration (default model + plugin switches).
 */
export function CopilotSettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heartbeat = useQuery({
    queryKey: portfolioQueryKeys.heartbeat,
    queryFn: getPortfolioHeartbeat,
    enabled: open,
  });

  const heartbeatMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      updatePortfolioHeartbeat({ enabled }, { idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: portfolioQueryKeys.heartbeat });
    },
    onError: () => setError(t("copilot.heartbeatError")),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("copilot.settings")}>
          <Settings className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <p className="text-sm font-semibold">{t("copilot.settings")}</p>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <Label htmlFor="copilot-heartbeat" className="text-sm font-normal">
                {t("copilot.heartbeat")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("copilot.heartbeatDescription")}
              </p>
            </div>
            <Switch
              id="copilot-heartbeat"
              size="sm"
              className="mt-1"
              disabled={!heartbeat.data || heartbeatMutation.isPending}
              checked={heartbeat.data?.enabled ?? false}
              onCheckedChange={(checked) => heartbeatMutation.mutate(checked)}
            />
          </div>
          {heartbeat.data?.enabled && heartbeat.data.cadenceMinutes ? (
            <p className="text-xs text-muted-foreground">
              {t("copilot.heartbeatCadence").replace("{minutes}", String(heartbeat.data.cadenceMinutes))}
            </p>
          ) : null}
          <Separator />
          <DshKernelSection open={open} onError={setError} />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface DshKernelSectionProps {
  open: boolean;
  onError: (message: string | null) => void;
}

function DshKernelSection({ open, onError }: DshKernelSectionProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const dshConfig = useQuery({
    queryKey: dshConfigQueryKey,
    queryFn: getDshConfig,
    enabled: open,
    retry: false,
  });

  const modelProviders = useQuery({
    queryKey: ["model-providers"],
    queryFn: listModelProviders,
    enabled: open,
  });

  const dshMutation = useMutation({
    mutationFn: (input: UpdateDshConfigInput) => updateDshConfig(input),
    onSuccess: () => {
      onError(null);
      void queryClient.invalidateQueries({ queryKey: dshConfigQueryKey });
    },
    onError: () => onError(t("copilot.dshSaveError")),
  });

  // The Gateway returns 404 when OPENFORGE_DSH_COPILOT_ENABLED is off; treat it
  // as "feature unavailable" instead of an error.
  const unavailable =
    dshConfig.error instanceof GatewayApiError && dshConfig.error.status === 404;
  const config = dshConfig.data;
  const models = (modelProviders.data?.models ?? []).filter((model) => model.status !== "disabled");

  const selectModel = (value: string) => {
    dshMutation.mutate({ defaultModelId: value === SYSTEM_DEFAULT_MODEL ? null : value });
  };

  const togglePlugin = (pluginId: string, enabled: boolean) => {
    if (!config) return;
    dshMutation.mutate({ plugins: { ...config.plugins, [pluginId]: enabled } });
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t("copilot.dshKernel")}</p>
        {config ? <RuntimeBadge status={config.runtime.status} /> : null}
      </div>
      {dshConfig.isPending ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : unavailable ? (
        <p className="text-xs text-muted-foreground">{t("copilot.dshNotEnabled")}</p>
      ) : dshConfig.isError || !config ? (
        <p className="text-xs text-destructive">{t("copilot.dshLoadError")}</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("copilot.dshDefaultModel")}
            </Label>
            <Select
              value={config.defaultModelId ?? SYSTEM_DEFAULT_MODEL}
              onValueChange={selectModel}
              disabled={dshMutation.isPending}
            >
              <SelectTrigger aria-label={t("copilot.dshDefaultModel")} className="h-8 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SYSTEM_DEFAULT_MODEL}>
                  {t("copilot.dshFollowSystemDefault")}
                </SelectItem>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.providerName} / {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-normal text-muted-foreground">
              {t("copilot.dshPlugins")}
            </Label>
            {config.availablePlugins.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("copilot.dshNoPlugins")}</p>
            ) : (
              config.availablePlugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2"
                >
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium">{plugin.label}</p>
                    <p className="text-xs text-muted-foreground">{plugin.description}</p>
                  </div>
                  <Switch
                    aria-label={plugin.label}
                    size="sm"
                    className="mt-0.5"
                    disabled={dshMutation.isPending}
                    checked={config.plugins[plugin.id] ?? false}
                    onCheckedChange={(checked) => togglePlugin(plugin.id, checked)}
                  />
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

function RuntimeBadge({ status }: { status: DshRuntimeStatus }) {
  const { t } = useLanguage();
  const dotClass =
    status === "running"
      ? "bg-emerald-500"
      : status === "idle"
        ? "bg-amber-500"
        : "bg-zinc-500";
  const labelKey =
    status === "running"
      ? "copilot.dshRuntimeRunning"
      : status === "idle"
        ? "copilot.dshRuntimeIdle"
        : "copilot.dshRuntimeOff";
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span className={`size-1.5 rounded-full ${dotClass}`} />
      {t(labelKey)}
    </Badge>
  );
}
