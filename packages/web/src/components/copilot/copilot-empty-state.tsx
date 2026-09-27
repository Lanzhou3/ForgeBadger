"use client";

import type { LucideIcon } from "lucide-react";

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
