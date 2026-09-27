"use client";

import { History } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ChannelDelivery } from "@/lib/copilot-channels-api";
import { channelStateLabel } from "./channel-setup";

function deliveryBadgeClass(status: string): string {
  if (status === "delivered") return "bg-emerald-500/15 text-emerald-400";
  if (status === "failed") return "bg-destructive/15 text-destructive";
  if (status === "unknown" || status === "sending" || status === "pending") return "bg-amber-500/15 text-amber-400";
  return "text-muted-foreground";
}

interface Props {
  deliveries: ChannelDelivery[];
}

/** Recent result deliveries back to the channel, with honest status badges. */
export function ChannelDeliveries({ deliveries }: Props) {
  return (
    <Card className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<History className="size-4" />}
        title="最近结果回传"
        description="“渠道已接收”不代表已读。“结果不确定”可能已经送达，请先核对飞书或 Telegram；系统不会自动重发。"
      />
      <CardContent className="space-y-2 text-sm">
        {!deliveries.length && <p className="text-muted-foreground">暂无回传记录。</p>}
        {deliveries.map((delivery) => (
          <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-3">
            <span className="flex flex-wrap items-center gap-2">
              {delivery.phase === "terminal" ? "任务结果" : "状态提示"}
              <Badge variant="secondary" className={deliveryBadgeClass(delivery.status)}>
                {channelStateLabel(delivery.status)}
              </Badge>
            </span>
            <time className="text-xs text-muted-foreground">{new Date(delivery.createdAt).toLocaleString()}</time>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
