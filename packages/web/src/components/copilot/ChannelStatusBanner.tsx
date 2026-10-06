"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  /** Number of failed diagnostic checks; surfaces a hint line when > 0. */
  failedChecks: number;
}

const stateBadge: Record<ChannelOverallState, { variant: "secondary" | "outline" | "destructive"; className: string }> = {
  running: { variant: "secondary", className: "bg-emerald-500/15 text-emerald-400" },
  pairing: { variant: "secondary", className: "bg-amber-500/15 text-amber-400" },
  authorization: { variant: "secondary", className: "bg-amber-500/15 text-amber-400" },
  unknown: { variant: "secondary", className: "bg-amber-500/15 text-amber-400" },
  stopped: { variant: "destructive", className: "" },
  not_connected: { variant: "outline", className: "text-muted-foreground" },
};

/** Channel platform switch plus the compact overall-status strip. */
export function ChannelStatusBanner({ channel, busy, onSwitch, state, statusText, blocker, failedChecks }: Props) {
  const copy = useSettingsCopy();
  const labels: Record<ChannelOverallState, string> = {
    not_connected: copy.channelStateNotConnected,
    pairing: copy.channelStatePairing,
    authorization: copy.channelStateAuthorization,
    running: copy.channelStateRunning,
    stopped: copy.channelStateStopped,
    unknown: copy.channelStateUnknown,
  };
  const badge = stateBadge[state];
  return (
    <div className="space-y-3">
      <div role="group" aria-label={copy.channelPlatformLabel} className="flex w-fit rounded-md border border-border/70 p-0.5">
        {(["feishu", "telegram"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={channel === value ? "default" : "ghost"}
            aria-pressed={channel === value}
            disabled={busy}
            onClick={() => onSwitch(value)}
          >
            {value === "feishu" ? copy.channelNameFeishu : copy.channelNameTelegram}
          </Button>
        ))}
      </div>
      <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-border/70 bg-muted/20 px-3 py-2.5 text-sm">
        <Badge variant={badge.variant} className={cn(badge.className)}>{labels[state]}</Badge>
        <span className="min-w-0">{statusText}</span>
        {blocker && (
          <a className="underline underline-offset-4" href={`#channel-${blocker.step}`}>{blocker.action}</a>
        )}
        {failedChecks > 0 && (
          <span className="w-full text-xs text-destructive">{copy.diagnosticsFailedNotice(failedChecks)}</span>
        )}
      </div>
    </div>
  );
}
