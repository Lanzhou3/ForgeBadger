import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  id?: string;
  step?: number;
  completed?: boolean;
  muted?: boolean;
  icon?: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

export function ChannelSection({
  id,
  step,
  completed = false,
  muted = false,
  icon,
  title,
  action,
  children,
  contentClassName,
}: Props) {
  return (
    <Card
      id={id}
      className={cn(
        "forgebadger-animate-in gap-0 overflow-hidden py-0 shadow-none forgebadger-motion-fade",
        muted && "opacity-75",
      )}
    >
      <header className="flex min-h-16 flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        {step ? (
          <span
            aria-hidden="true"
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold",
              completed ? "bg-success/12 text-success" : "bg-brand/10 text-brand",
            )}
          >
            {completed ? <Check className="size-3.5" strokeWidth={2.5} /> : String(step).padStart(2, "0")}
          </span>
        ) : (
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {icon}
          </span>
        )}
        <h2 className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </header>
      <div className={cn("border-t border-border/70 px-4 py-4 sm:px-5", contentClassName)}>{children}</div>
    </Card>
  );
}
