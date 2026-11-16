"use client";

import { AlertCircle, ArrowRight, CheckCircle2, CircleDashed, PauseCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChannelPlatform } from "@/lib/api";
import type { ChannelOverallState, SetupBlocker } from "./channel-setup";
import { useSettingsCopy } from "./settings-copy";

interface Props {
  channel: ChannelPlatform;
  busy: boolean;
  onSwitch: (channel: ChannelPlatform) => void;
  state: ChannelOverallState;
  statusText: string;
  blocker?: SetupBlocker;
  failedChecks: number;
}

const stateIcon = {
  running: CheckCircle2,
  stopped: PauseCircle,
  unknown: AlertCircle,
  pairing: CircleDashed,
  authorization: CircleDashed,
  not_connected: CircleDashed,
};

export function ChannelStatusBanner({ channel, busy, onSwitch, state, statusText, blocker, failedChecks }: Props) {
  const copy = useSettingsCopy();
  const Icon = stateIcon[state];
  return (
    <div className="rounded-lg border bg-card p-3 shadow-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label={copy.channelPlatformLabel} className="flex w-fit rounded-md bg-muted/60 p-1">
          {(["feishu", "telegram"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={channel === value ? "secondary" : "ghost"}
              aria-pressed={channel === value}
              disabled={busy}
              className={cn("min-w-24", channel === value && "bg-background shadow-sm")}
              onClick={() => onSwitch(value)}
            >
              {value === "feishu" ? copy.channelNameFeishu : copy.channelNameTelegram}
            </Button>
          ))}
        </div>
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <Icon className={cn("size-4 shrink-0", state === "running" ? "text-emerald-400" : state === "stopped" || state === "unknown" ? "text-destructive" : "text-muted-foreground")} />
          <span className="min-w-0 font-medium">{statusText}</span>
          {blocker && state !== "running" && (
            <a className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`#channel-${blocker.step}`}>
              {blocker.action}<ArrowRight className="size-3" />
            </a>
          )}
        </div>
      </div>
      {failedChecks > 0 && (
        <a href="#channel-diagnostics" className="mt-3 flex items-center gap-2 border-t border-border/70 pt-3 text-xs text-destructive">
          <AlertCircle className="size-3.5" />{copy.diagnosticsFailedNotice(failedChecks)}
        </a>
      )}
    </div>
  );
}
