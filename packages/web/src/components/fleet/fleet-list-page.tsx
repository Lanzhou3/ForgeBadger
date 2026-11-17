"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Ship } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fleetKeys, listFleets, type FleetListItem } from "@/lib/fleet-api";
import { cn } from "@/lib/utils";
import { CopilotEmptyState } from "../copilot/copilot-empty-state";
import { FleetCreateDialog } from "./fleet-create-dialog";
import { useFleetCopy } from "./fleet-copy";

export function FleetListPage() {
  const copy = useFleetCopy();
  const [createOpen, setCreateOpen] = useState(false);
  // Poll only while some fleet is running; paused lists are static.
  const fleets = useQuery({
    queryKey: fleetKeys.list,
    queryFn: listFleets,
    refetchInterval: (query) => (query.state.data?.fleets.some((fleet) => fleet.status === "active") ? 8000 : false),
  });
  const items = fleets.data?.fleets ?? [];
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Ship className="size-5 shrink-0 text-brand" aria-hidden />
            {copy.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
        </div>
        <Button size="sm" variant="brand" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />{copy.createFleet}
        </Button>
      </header>

      {fleets.isPending ? (
        <p role="status" className="text-xs text-muted-foreground">{copy.loading}</p>
      ) : fleets.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <p>{copy.loadFailed}</p>
          <Button size="sm" variant="outline" onClick={() => void fleets.refetch()}>{copy.retry}</Button>
        </div>
      ) : items.length === 0 ? (
        <CopilotEmptyState icon={Ship} title={copy.emptyTitle} description={copy.emptyBody} />
      ) : (
        <ul className="space-y-2">
          {items.map((fleet) => <FleetRow key={fleet.id} fleet={fleet} />)}
        </ul>
      )}

      <FleetCreateDialog open={createOpen} onOpenChange={setCreateOpen} takenProjectIds={items.map((fleet) => fleet.projectId)} />
    </div>
  );
}

function FleetRow({ fleet }: { fleet: FleetListItem }) {
  const copy = useFleetCopy();
  const active = fleet.status === "active";
  const total = fleet.taskTotal;
  const done = Math.min(fleet.taskDone, total);
  return (
    <li>
      <Link
        href={`/fleet/${encodeURIComponent(fleet.id)}`}
        className="block rounded-lg border border-border bg-card px-4 py-3 shadow-card forgebadger-motion-surface hover:-translate-y-px hover:border-border/90 hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={fleet.title}>{fleet.title}</span>
          {fleet.taskHeld > 0 ? (
            <span className="rounded-full bg-brand-accent/12 px-2 py-0.5 text-[11px] font-medium text-brand-accent">{copy.listHeld(fleet.taskHeld)}</span>
          ) : null}
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", active ? "bg-hue-mint/12 text-hue-mint" : "bg-hue-gold/12 text-hue-gold")}>
            {active ? copy.statusActive : copy.statusPaused}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{fleet.projectName}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-hue-mint transition-[width] duration-500" style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }} />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{total === 0 ? copy.noTasksYet : copy.listCounts(total, done)}</span>
          {fleet.taskRunning > 0 ? <span className="shrink-0 text-xs text-brand">{copy.listRunning(fleet.taskRunning)}</span> : null}
        </div>
      </Link>
    </li>
  );
}
