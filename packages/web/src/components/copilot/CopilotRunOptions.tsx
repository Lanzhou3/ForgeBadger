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
  const { t } = useLanguage();
  const title = t("copilot.runOptions");
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
          <SheetDescription>{t("copilot.runOptionsDescription")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 shrink-0" checked={reviewTaskResults} disabled={disabled} onChange={event => onReviewChange(event.target.checked)} />
            <span>{t("copilot.runOptionsReview")}
              <span className="mt-1 block text-xs text-muted-foreground">{t("copilot.runOptionsReviewHint")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 shrink-0" checked={repairFailedChecks} disabled={disabled} onChange={event => onRepairChange(event.target.checked)} />
            <span>{t("copilot.runOptionsRepair")}
              <span className="mt-1 block text-xs text-muted-foreground">{t("copilot.runOptionsRepairHint")}</span>
            </span>
          </label>
        </div>
        <CopilotMeteringPanel conversationId={conversationId} modelId={modelId} />
      </SheetContent>
    </Sheet>
  );
}
