import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type CopilotStatusTone = "success" | "warning" | "destructive" | "info" | "brand" | "muted";

/**
 * Calibrated semantic surface + text tokens for Copilot status pills and icons.
 * Every tone reads from globals.css theme variables so contrast stays >= 4.5:1
 * across all six light and dark themes (including GitHub Light & Solarized Light).
 */
export const COPILOT_TONE_BADGE_CLASSES: Record<CopilotStatusTone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  destructive: "bg-destructive/12 text-destructive",
  info: "bg-hue-sky/12 text-hue-sky",
  brand: "bg-brand/12 text-brand",
  muted: "bg-muted text-muted-foreground",
};

export const COPILOT_TONE_TEXT_CLASSES: Record<CopilotStatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-hue-sky",
  brand: "text-brand",
  muted: "text-muted-foreground",
};

export const COPILOT_TONE_DOT_CLASSES: Record<CopilotStatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-hue-sky",
  brand: "bg-brand",
  muted: "bg-muted-foreground/50",
};

interface CopilotStatusBadgeProps {
  tone: CopilotStatusTone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

export function CopilotStatusBadge({
  tone,
  children,
  dot = false,
  pulse = false,
  className,
}: CopilotStatusBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1.5 border-0 font-medium",
        COPILOT_TONE_BADGE_CLASSES[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            COPILOT_TONE_DOT_CLASSES[tone],
            pulse && "forgebadger-pulse-dot",
          )}
        />
      ) : null}
      {children}
    </Badge>
  );
}
