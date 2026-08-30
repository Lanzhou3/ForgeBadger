"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CapabilitiesSection, DshKernelSection } from "@/components/copilot/copilot-kernel-panel";
import { FeishuSettingsSection } from "@/components/copilot/feishu-settings-section";
import { useLanguage } from "@/hooks/use-language";
import {
  getPortfolioHeartbeat,
  portfolioQueryKeys,
  updatePortfolioHeartbeat,
} from "@/lib/portfolio-api";

/**
 * Full Copilot settings page (/copilot/settings), opened from the console's
 * top-right gear button. Consolidates every Copilot preference in one place:
 * the proactive-heartbeat toggle (migrated from the old header popover), the
 * dsh kernel configuration (default model + plugin switches + runtime badge),
 * and the capability tool list (migrated from the retired right-hand kernel
 * panel). Sections degrade independently when their Gateway flag is off.
 */
export function CopilotSettingsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [dshError, setDshError] = useState<string | null>(null);

  const heartbeat = useQuery({
    queryKey: portfolioQueryKeys.heartbeat,
    queryFn: getPortfolioHeartbeat,
  });

  const heartbeatMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      updatePortfolioHeartbeat({ enabled }, { idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => {
      setHeartbeatError(null);
      void queryClient.invalidateQueries({ queryKey: portfolioQueryKeys.heartbeat });
    },
    onError: () => setHeartbeatError(t("copilot.heartbeatError")),
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("copilot.settingsBack")}
          title={t("copilot.settingsBack")}
          onClick={() => router.push("/copilot")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{t("copilot.settings")}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("copilot.settingsDescription")}</p>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="copilot-heartbeat" className="text-sm font-medium">
              {t("copilot.heartbeat")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("copilot.heartbeatDescription")}</p>
            {heartbeat.data?.enabled && heartbeat.data.cadenceMinutes ? (
              <p className="text-xs text-muted-foreground/80">
                {t("copilot.heartbeatCadence").replace("{minutes}", String(heartbeat.data.cadenceMinutes))}
              </p>
            ) : null}
            {heartbeatError && <p className="text-xs text-destructive">{heartbeatError}</p>}
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
      </section>

      <DshKernelSection active onError={setDshError} />
      {dshError && <p className="text-xs text-destructive">{dshError}</p>}

      <FeishuSettingsSection />

      <CapabilitiesSection active />
    </div>
  );
}
