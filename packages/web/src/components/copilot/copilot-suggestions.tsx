"use client";

import { cn } from "@/lib/utils";

interface Props {
  /** Suggestion texts already translated by the caller. */
  suggestions: string[];
  onPick: (text: string) => void;
  /** Compact density for narrow surfaces such as the floating robot panel. */
  compact?: boolean;
  className?: string;
}

/**
 * Suggestion-chip row shared by the full Copilot console and the floating
 * robot panel: pill buttons that submit a ready-made prompt. The suggestion
 * texts themselves come from i18n keys so every surface stays in sync.
 */
export function CopilotSuggestionChips({ suggestions, onPick, compact = false, className }: Props) {
  return (
    <div className={cn("flex flex-wrap justify-center", compact ? "gap-1.5" : "gap-2", className)}>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onPick(suggestion)}
          className={cn(
            "rounded-full border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
            compact
              ? "border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground hover:border-brand/50 hover:bg-brand/10 hover:text-foreground"
              : "border-border/70 bg-card px-3.5 py-1.5 text-sm text-muted-foreground hover:border-brand/60 hover:text-foreground"
          )}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
