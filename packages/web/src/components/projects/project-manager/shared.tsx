import type { LucideIcon } from "lucide-react";

export function LedgerDatum({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/40 px-2 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-xs tabular-nums">{value}</div>
    </div>
  );
}

export function EmptyState({ title, body, icon: Icon }: { title: string; body: string; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      {Icon ? (
        <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Icon className="size-5" />
        </div>
      ) : null}
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}
