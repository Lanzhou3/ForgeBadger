import { CliBrandIcon } from "@/components/cli-brand-icon";
import { getCliBrand } from "@/lib/cli-brand";
import { cn } from "@/lib/utils";

interface Props {
  aiTool?: string | null;
  className?: string;
}

export function CliBrandChip({ aiTool, className }: Props) {
  const brand = getCliBrand(aiTool);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        className
      )}
      title={brand.label}
    >
      {brand.id === "unknown" ? (
        <span className="size-1.5 rounded-full" style={{ backgroundColor: brand.color }} />
      ) : (
        // mcode's app-icon tile reads smaller than the filled marks, so it
        // gets one size step up in this 12px chip.
        <CliBrandIcon
          aiTool={aiTool}
          className={brand.id === "mcode" ? "size-3.5" : "size-3"}
        />
      )}
      {brand.label}
    </span>
  );
}
