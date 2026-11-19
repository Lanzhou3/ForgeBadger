"use client";

import { Bot, FolderOpen, type LucideIcon } from "lucide-react";

import { CopilotSuggestionChips } from "@/components/copilot/copilot-suggestions";
import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
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
      <IconTile size="md" tone="brand">
        <Icon strokeWidth={1.75} aria-hidden="true" />
      </IconTile>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  );
}

interface WelcomeProps {
  onSuggestion: (text: string) => void;
  /** Narrow-surface density (e.g. the floating robot panel). */
  compact?: boolean;
  /** Active project name when a project context is selected. */
  projectName?: string;
  className?: string;
}

/**
 * Welcome empty state shared by the /copilot console and the floating robot
 * chat panel: unified Bot icon tile, greeting copy, and context-aware
 * suggestion chips.
 */
export function CopilotWelcomeState({ onSuggestion, compact = false, projectName, className }: WelcomeProps) {
  const { t } = useLanguage();
  const suggestions = projectName
    ? [t("copilot.projectSuggestion1"), t("copilot.projectSuggestion2"), t("copilot.projectSuggestion3")]
    : [t("copilot.suggestion1"), t("copilot.suggestion2"), t("copilot.suggestion3")];

  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center text-center",
        compact ? "gap-4 px-4" : "gap-5 py-10",
        className,
      )}
    >
      <div className="relative">
        <div
          aria-hidden="true"
          className={cn("rounded-full bg-brand/15", compact ? "absolute -inset-3 blur-xl" : "absolute -inset-4 blur-2xl")}
        />
        <span
          className={cn(
            "relative flex items-center justify-center rounded-2xl border border-brand/25 bg-gradient-to-b from-brand/20 to-brand/5 shadow-sm",
            compact ? "size-12" : "size-14",
          )}
        >
          <Bot className={cn("text-brand", compact ? "size-6" : "size-7")} aria-hidden="true" />
        </span>
      </div>

      <div className={compact ? "space-y-1" : "space-y-1.5"}>
        {projectName ? (
          <Badge variant="secondary" className="mb-1 gap-1.5 bg-brand/10 text-brand">
            <FolderOpen className="size-3" aria-hidden="true" />
            <span className="max-w-48 truncate">{projectName}</span>
          </Badge>
        ) : null}
        <p className={cn("font-semibold tracking-tight", compact ? "text-sm" : "text-base")}>
          {t("copilot.welcomeTitle")}
        </p>
        <p
          className={cn(
            "mx-auto leading-relaxed text-muted-foreground",
            compact ? "max-w-[260px] text-xs" : "max-w-md text-sm",
          )}
        >
          {t("copilot.welcomeSubtitle")}
        </p>
      </div>

      <CopilotSuggestionChips suggestions={suggestions} onPick={onSuggestion} compact={compact} />
    </div>
  );
}
