"use client";

import { useEffect, useState } from "react";
import { Activity, Check, ChevronDown, CircleDashed, Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChannelDiagnosticCheck } from "@/lib/api";
import { CopilotStatusBadge } from "./copilot-status-badge";
import { useSettingsCopy } from "./settings-copy";

interface Props {
  channelName: string;
  isPending: boolean;
  isError: boolean;
  checks: ChannelDiagnosticCheck[] | undefined;
  onFailedCountChange: (count: number) => void;
}

export function ChannelDiagnostics({ channelName, isPending, isError, checks, onFailedCountChange }: Props) {
  const copy = useSettingsCopy();
  const [expanded, setExpanded] = useState(false);
  const failedCount = (checks ?? []).filter((check) => !check.ok && check.status !== "untested" && check.status !== "pending").length;

  useEffect(() => {
    onFailedCountChange(failedCount);
  }, [failedCount, onFailedCountChange]);

  return (
    <Card id="channel-diagnostics" className="forgebadger-animate-in gap-0 overflow-hidden py-0 shadow-none">
      <header className="flex min-h-13 items-center gap-3 px-4 py-3 sm:px-5">
        <Activity className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-sm font-medium">{copy.diagnosticsTitle(channelName)}</h2>
        {failedCount > 0 && <Badge variant="secondary" className="bg-destructive/12 text-destructive">{failedCount}</Badge>}
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? copy.diagnosticsCollapse : copy.diagnosticsExpand}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </Button>
      </header>
      <div className="forgebadger-collapse-grid" data-open={expanded ? "true" : "false"}>
        <div className="overflow-hidden">
          {expanded && (
            <div className="space-y-2 border-t border-border/70 px-4 py-4 sm:px-5">
              {isPending && <p role="status" className="text-sm text-muted-foreground">{copy.diagnosticsChecking}</p>}
              {isError && <p role="alert" className="text-sm text-destructive">{copy.diagnosticsLoadError}</p>}
              {!isPending && !isError && !checks?.length && <p className="text-sm text-muted-foreground">{copy.diagnosticsEmpty}</p>}
              {checks?.map((check) => {
                const status = check.ok ? "ok" : check.status === "untested" ? "untested" : check.status === "pending" ? "pending" : "failed";
                return (
                  <div key={check.key} className="flex items-start gap-2.5 rounded-md bg-muted/20 p-3 text-sm">
                    {status === "ok" ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : status === "pending" ? (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-warning" />
                    ) : status === "untested" ? (
                      <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        {check.detail}
                        {status === "untested" && <CopilotStatusBadge tone="muted">{copy.diagnosticsStatusUntested}</CopilotStatusBadge>}
                        {status === "pending" && <CopilotStatusBadge tone="warning">{copy.diagnosticsStatusPending}</CopilotStatusBadge>}
                        {status === "failed" && <CopilotStatusBadge tone="destructive">{copy.diagnosticsStatusFailed}</CopilotStatusBadge>}
                      </p>
                      {status === "failed" && check.fixHint && <p className="mt-1 text-xs text-muted-foreground">{copy.diagnosticsFixHint(check.fixHint)}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
