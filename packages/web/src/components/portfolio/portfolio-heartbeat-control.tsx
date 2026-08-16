"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePortfolioHeartbeatUpdate } from "@/hooks/use-portfolio";
import type { PortfolioHeartbeat } from "@/lib/portfolio-api";
import { formatPortfolioTime, usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioHeartbeatControlProps {
  heartbeat: PortfolioHeartbeat | null;
}

/** Exposes only the bounded, opt-in observation setting; it cannot start execution. */
export function PortfolioHeartbeatControl({ heartbeat }: PortfolioHeartbeatControlProps) {
  const { copy, language } = usePortfolioCopy();
  const mutation = usePortfolioHeartbeatUpdate();
  const [enabled, setEnabled] = useState(heartbeat?.enabled ?? false);
  const [cadenceMinutes, setCadenceMinutes] = useState(String(heartbeat?.cadenceMinutes ?? 60));

  useEffect(() => {
    setEnabled(heartbeat?.enabled ?? false);
    setCadenceMinutes(String(heartbeat?.cadenceMinutes ?? 60));
  }, [heartbeat?.cadenceMinutes, heartbeat?.enabled]);

  const cadence = Number(cadenceMinutes);
  const cadenceValid = Number.isInteger(cadence) && cadence >= 5 && cadence <= 1_440;
  const canSave = !mutation.isPending && (!enabled || cadenceValid);

  function save() {
    mutation.mutate({ enabled, ...(enabled ? { cadenceMinutes: cadence } : {}) });
  }

  return (
    <section className="rounded-lg border border-border bg-card" aria-labelledby="portfolio-heartbeat-title">
      <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Activity className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="portfolio-heartbeat-title" className="text-sm font-semibold">{copy.heartbeat}</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{copy.heartbeatDescription}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={mutation.isPending} aria-label={copy.enableHeartbeat} />
      </div>
      <div className="space-y-3 p-4">
        <label className="block space-y-2" htmlFor="portfolio-heartbeat-cadence">
          <span className="text-sm font-medium">{copy.cadence}</span>
          <Input
            id="portfolio-heartbeat-cadence"
            type="number"
            min={5}
            max={1_440}
            value={cadenceMinutes}
            onChange={(event) => setCadenceMinutes(event.target.value)}
            disabled={!enabled || mutation.isPending}
            aria-invalid={enabled && !cadenceValid}
          />
        </label>
        {enabled && !cadenceValid ? <p className="text-xs text-destructive" role="alert">{copy.cadenceError}</p> : null}
        {mutation.error ? <p className="text-xs text-destructive" role="alert">{copy.errorDescription}</p> : null}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{copy.lastObserved}: {heartbeat?.lastObservedAt ? formatPortfolioTime(heartbeat.lastObservedAt, language, copy.timeUnavailable) : copy.never}</p>
          <Button type="button" size="sm" variant="outline" disabled={!canSave} onClick={save}>
            {mutation.isPending ? copy.saving : copy.saveHeartbeat}
          </Button>
        </div>
      </div>
    </section>
  );
}
