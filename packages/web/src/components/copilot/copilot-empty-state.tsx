"use client";

import { Bot, type LucideIcon } from "lucide-react";

import { CopilotSuggestionChips } from "@/components/copilot/copilot-suggestions";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

/** Centered icon + guidance copy used across Copilot settings empty states. */
export function CopilotEmptyState({ icon: Icon, title, description, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center gap-2.5 rounded-md border border-border/70 bg-muted/20 px-4 py-8 text-center", className)}>
      <div className="flex size-9 items-center justify-center rounded-md bg-brand/10 text-brand">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  );
}

interface WelcomeProps {
  onSuggestion: (text: string) => void;
  /** Narrow-surface density (e.g. the floating robot panel). */
  compact?: boolean;
  className?: string;
}

/**
 * Welcome empty state shared by the /copilot console and the floating robot
 * chat panel: greeting copy plus the i18n suggestion chips. Surfaces only
 * differ in density.
 */
export function CopilotWelcomeState({ onSuggestion, compact = false, className }: WelcomeProps) {
  const { t } = useLanguage();
  const suggestions = [t("copilot.suggestion1"), t("copilot.suggestion2"), t("copilot.suggestion3")];
  if (compact) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-3 text-center", className)}>
        <div>
          <p className="text-sm font-medium">{t("copilot.welcomeTitle")}</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">{t("copilot.welcomeSubtitle")}</p>
        </div>
        <CopilotSuggestionChips suggestions={suggestions} onPick={onSuggestion} compact />
      </div>
    );
  }
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-5 py-10 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-xl border border-border/60 bg-muted/60 shadow-inner">
        <Bot className="size-6 text-muted-foreground" />
      </span>
      <div>
        <p className="text-base font-semibold">{t("copilot.welcomeTitle")}</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("copilot.welcomeSubtitle")}
        </p>
      </div>
      <CopilotSuggestionChips suggestions={suggestions} onPick={onSuggestion} />
    </div>
  );
}
