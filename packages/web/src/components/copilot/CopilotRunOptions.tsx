"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLanguage } from "@/hooks/use-language";
import { listConversationRuns, revokeRunRepairs } from "@/lib/copilot-api";
import { useSettingsCopy } from "./settings-copy";

interface Props {
  conversationId: string | null;
  disabled: boolean;
  reviewTaskResults: boolean;
  repairFailedChecks: boolean;
  onReviewChange: (enabled: boolean) => void;
  onRepairChange: (enabled: boolean) => void;
}

/** Optional execution controls must not consume transcript height. */
export function CopilotRunOptions({ conversationId, disabled, reviewTaskResults, repairFailedChecks, onReviewChange, onRepairChange }: Props) {
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
          {conversationId ? <RepairRevokeControl conversationId={conversationId} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Mounted inside the sheet so its queries only fire while the sheet is open. */
function RepairRevokeControl({ conversationId }: { conversationId: string }) {
  const copy = useSettingsCopy();
  const runs = useQuery({ queryKey: ["copilot", "runs", conversationId], queryFn: () => listConversationRuns(conversationId) });
  const runId = runs.data?.runs[0]?.id;
  const revoke = useMutation({ mutationFn: () => revokeRunRepairs(runId!) });
  if (!runId) return null;
  return (
    <div className="border-t border-border/70 pt-4">
      <Button variant="outline" size="sm" disabled={revoke.isPending || revoke.isSuccess} onClick={() => revoke.mutate()}>
        {revoke.isSuccess ? copy.repairRevoked : copy.repairRevoke}
      </Button>
      {revoke.isError ? <p role="alert" className="mt-2 text-xs text-destructive">{copy.repairRevokeError}</p> : null}
    </div>
  );
}
