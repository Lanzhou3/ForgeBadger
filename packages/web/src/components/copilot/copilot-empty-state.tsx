"use client";

import { Bot, Sparkles, type LucideIcon } from "lucide-react";

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
      <div className={cn("flex h-full flex-col items-center justify-center gap-4 px-4 text-center", className)}>
        <div className="relative">
          <div aria-hidden="true" className="absolute -inset-3 rounded-full bg-brand/15 blur-xl" />
          <div className="relative flex size-12 items-center justify-center rounded-2xl border border-brand/25 bg-gradient-to-b from-brand/20 to-brand/5 shadow-sm">
            <Sparkles className="size-5 text-brand" aria-hidden="true" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight">{t("copilot.welcomeTitle")}</p>
          <p className="mx-auto max-w-[260px] text-xs leading-relaxed text-muted-foreground">{t("copilot.welcomeSubtitle")}</p>
        </div>
        <CopilotSuggestionChips suggestions={suggestions} onPick={onSuggestion} compact />
      </div>
    );
  }
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-5 py-10 text-center", className)}>
      <div className="relative">
        <div aria-hidden="true" className="absolute -inset-4 rounded-full bg-brand/15 blur-2xl" />
        <span className="relative flex size-14 items-center justify-center rounded-2xl border border-brand/25 bg-gradient-to-b from-brand/20 to-brand/5 shadow-sm">
          <Bot className="size-7 text-brand" />
        </span>
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-semibold tracking-tight">{t("copilot.welcomeTitle")}</p>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("copilot.welcomeSubtitle")}
        </p>
      </div>
      <CopilotSuggestionChips suggestions={suggestions} onPick={onSuggestion} />
    </div>
  );
}
