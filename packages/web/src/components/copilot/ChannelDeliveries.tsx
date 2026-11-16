"use client";

import { useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { useUiLocale } from "@/hooks/use-language";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChannelDelivery } from "@/lib/copilot-channels-api";
import { useSettingsCopy } from "./settings-copy";

function deliveryBadgeClass(status: string): string {
  if (status === "delivered") return "bg-emerald-500/10 text-emerald-400";
  if (status === "failed") return "bg-destructive/10 text-destructive";
  if (status === "unknown" || status === "sending" || status === "pending") return "bg-amber-500/10 text-amber-400";
  return "text-muted-foreground";
}

interface Props {
  deliveries: ChannelDelivery[];
}

export function ChannelDeliveries({ deliveries }: Props) {
  const copy = useSettingsCopy();
  const locale = useUiLocale();
  const [expanded, setExpanded] = useState(false);
  return (
    <Card id="channel-deliveries" className="forgebadger-animate-in gap-0 py-0 shadow-none">
      <header className="flex min-h-13 items-center gap-3 px-4 py-3 sm:px-5">
        <History className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-sm font-medium">{copy.deliveriesTitle}</h2>
        {deliveries.length > 0 && <Badge variant="secondary">{deliveries.length}</Badge>}
        <Button type="button" variant="ghost" size="icon" aria-label={expanded ? copy.deliveriesCollapse : copy.deliveriesExpand} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </Button>
      </header>
      {expanded && (
        <div className="space-y-1 border-t border-border/70 px-4 py-3 text-sm sm:px-5">
          {!deliveries.length && <p className="py-2 text-muted-foreground">{copy.deliveriesEmpty}</p>}
          {deliveries.map((delivery) => (
            <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2.5 hover:bg-muted/20">
              <span className="flex flex-wrap items-center gap-2">
                {delivery.phase === "terminal" ? copy.deliveryPhaseTerminal : copy.deliveryPhaseStatus}
                <Badge variant="secondary" className={deliveryBadgeClass(delivery.status)}>{copy.channelStates[delivery.status] ?? delivery.status}</Badge>
              </span>
              <time className="text-xs text-muted-foreground">{new Date(delivery.createdAt).toLocaleString(locale)}</time>
            </div>
          ))}
          <p className="px-2 pb-1 pt-2 text-xs leading-relaxed text-muted-foreground">{copy.deliveriesDescription}</p>
        </div>
      )}
    </Card>
  );
}
