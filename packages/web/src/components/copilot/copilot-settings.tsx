"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
import {
  getPortfolioHeartbeat,
  portfolioQueryKeys,
  updatePortfolioHeartbeat,
} from "@/lib/portfolio-api";

/**
 * Copilot settings popover. Hosts the operations heartbeat control migrated
 * from the retired Portfolio Operations page: the toggle drives the Gateway's
 * proactive portfolio scheduler (which also triggers Copilot's reactive loop).
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
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
