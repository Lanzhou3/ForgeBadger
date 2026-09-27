"use client";

import { useEffect, useState } from "react";
import { Activity, Check, ChevronDown, CircleDashed, Loader2, X } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChannelDiagnosticCheck } from "@/lib/api";
import { useSettingsCopy } from "./settings-copy";

interface Props {
  channelName: string;
  isPending: boolean;
  isError: boolean;
  checks: ChannelDiagnosticCheck[] | undefined;
  /** Reports how many checks are genuinely failing so the banner can hint it. */
  onFailedCountChange: (count: number) => void;
}

/** Collapsible per-channel diagnostics; failed checks are also surfaced in the status banner. */
export function ChannelDiagnostics({ channelName, isPending, isError, checks, onFailedCountChange }: Props) {
  const copy = useSettingsCopy();
  const [expanded, setExpanded] = useState(false);
  const failedCount = (checks ?? []).filter((check) => !check.ok && check.status !== "untested" && check.status !== "pending").length;

  useEffect(() => {
    onFailedCountChange(failedCount);
  }, [failedCount, onFailedCountChange]);

  return (
    <Card className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<Activity className="size-4" />}
        title={`渠道诊断 · ${channelName}`}
        description="连接、模型与回传链路的实时自检。"
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {expanded ? copy.diagnosticsCollapse : copy.diagnosticsExpand}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </Button>
        }
      />
      {expanded && (
        <CardContent className="space-y-2">
          {isPending && <p role="status">正在检查渠道状态…</p>}
          {isError && <p role="alert">诊断加载失败，稍后自动重试。</p>}
          {!isPending && !isError && !checks?.length && <p className="text-sm text-muted-foreground">暂无诊断项。</p>}
          {checks?.map((check) => {
            const status = check.ok ? "ok" : check.status === "untested" ? "untested" : check.status === "pending" ? "pending" : "failed";
            return (
              <div key={check.key} className="flex items-start gap-2.5 rounded-md border border-border/70 p-3 text-sm">
                {status === "ok" ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                ) : status === "pending" ? (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber-400" />
                ) : status === "untested" ? (
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    {check.detail}
                    {status === "untested" && <Badge variant="outline" className="text-muted-foreground">{copy.diagnosticsStatusUntested}</Badge>}
                    {status === "pending" && <Badge variant="secondary" className="bg-amber-500/15 text-amber-400">{copy.diagnosticsStatusPending}</Badge>}
                    {status === "failed" && <Badge variant="secondary" className="bg-destructive/15 text-destructive">{copy.diagnosticsStatusFailed}</Badge>}
                  </p>
                  {status === "failed" && check.fixHint && (
                    <p className="mt-1 text-xs text-muted-foreground">建议：{check.fixHint}</p>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
