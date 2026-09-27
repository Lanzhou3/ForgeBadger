"use client";

import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLanguage } from "@/hooks/use-language";
import { CopilotMeteringPanel } from "./CopilotMeteringPanel";

interface Props {
  conversationId: string | null;
  modelId: string | null;
  disabled: boolean;
  reviewTaskResults: boolean;
  repairFailedChecks: boolean;
  onReviewChange: (enabled: boolean) => void;
  onRepairChange: (enabled: boolean) => void;
}

/** Optional execution controls must not consume transcript height. */
export function CopilotRunOptions({ conversationId, modelId, disabled, reviewTaskResults, repairFailedChecks, onReviewChange, onRepairChange }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh-CN";
  const title = zh ? "执行选项" : "Run options";
  const enabledCount = Number(reviewTaskResults) + Number(repairFailedChecks);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="ml-auto h-7 shrink-0 gap-1 px-2 text-xs" aria-label={title}>
          <SlidersHorizontal className="size-3.5" />
          {title}
          {enabledCount > 0 ? <span className="rounded-full bg-muted px-1.5 text-foreground">{enabledCount}</span> : null}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b pr-10">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{zh ? "设置后续消息的复核与修复选项，查看当前对话用量。" : "Configure review and repair for subsequent messages and inspect conversation usage."}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 shrink-0" checked={reviewTaskResults} disabled={disabled} onChange={event => onReviewChange(event.target.checked)} />
            <span>{zh ? "任务结束后自动只读复核" : "Automatically review completed tasks"}
              <span className="mt-1 block text-xs text-muted-foreground">{zh ? "会使用额外模型额度。" : "Uses additional model quota."}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 shrink-0" checked={repairFailedChecks} disabled={disabled} onChange={event => onRepairChange(event.target.checked)} />
            <span>{zh ? "测试失败后尝试修复" : "Attempt repairs after failed checks"}
              <span className="mt-1 block text-xs text-muted-foreground">{zh ? "最多 2 次，使用额外模型额度；每次变更仍需审批。" : "Up to 2 attempts using additional model quota. Each change still requires approval."}</span>
            </span>
          </label>
        </div>
        <CopilotMeteringPanel conversationId={conversationId} modelId={modelId} />
      </SheetContent>
    </Sheet>
  );
}
