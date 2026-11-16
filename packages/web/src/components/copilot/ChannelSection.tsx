import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  id?: string;
  step?: number;
  icon?: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

export function ChannelSection({ id, step, icon, title, action, children, contentClassName }: Props) {
  return (
    <Card id={id} className="forgebadger-animate-in gap-0 overflow-hidden py-0 shadow-none">
      <header className="flex min-h-16 flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        {step ? (
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 font-mono text-xs font-semibold text-brand">
            {String(step).padStart(2, "0")}
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
