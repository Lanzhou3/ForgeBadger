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
      <span className="size-1.5 rounded-full" style={{ backgroundColor: brand.color }} />
      {brand.label}
    </span>
  );
}
