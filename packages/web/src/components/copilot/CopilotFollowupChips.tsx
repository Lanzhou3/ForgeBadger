"use client";

import { X } from "lucide-react";

import { useLanguage } from "@/hooks/use-language";
import type { CopilotFollowup } from "@/lib/copilot-api";
import { cn } from "@/lib/utils";

interface Props {
  items: CopilotFollowup[];
  onCancel: (id: string) => void;
}

/**
 * Compact read-only list of follow-ups waiting behind the current run, shown
 * directly above the composer. Input stays in the normal composer: while a run
 * is in flight, sending there enqueues instead of starting a competing run.
 */
export function CopilotFollowupChips({ items, onCancel }: Props) {
  const { t } = useLanguage();
  if (!items.length) return null;
  return (
    <ul data-testid="copilot-followup-chips" className="mb-1.5 flex flex-col gap-1">
      {items.map(item => (
        <li
          key={item.id}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
            item.status === "failed" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border/70 bg-muted/40 text-muted-foreground",
          )}
        >
          <span className="shrink-0 font-medium">
            {item.status === "failed" ? t("copilot.followups.failedPrefix") : t("copilot.followups.queuedPrefix")}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.content}</span>
          {item.status === "queued" && (
            <button
              type="button"
              onClick={() => onCancel(item.id)}
              aria-label={t("copilot.followups.cancelQueued")}
              title={t("copilot.followups.cancelQueued")}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
