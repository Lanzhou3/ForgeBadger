"use client";

import type { TerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { useLanguage } from "@/hooks/use-language";

interface RuntimeSetupCommandsProps {
  guidance: TerminalRuntimeSetupGuidance;
}

export function RuntimeSetupCommands({ guidance }: RuntimeSetupCommandsProps) {
  const { t } = useLanguage();

  if (guidance.commands.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {guidance.commands.map((item) => (
        <div
          key={`${item.labelKey}:${item.command}`}
          className="min-w-0 rounded-md border border-border bg-background/70 p-2"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(item.labelKey)}
          </div>
          <code className="mt-1 block overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
            {item.command}
          </code>
        </div>
      ))}
    </div>
  );
}
