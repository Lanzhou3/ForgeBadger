import { ClipboardList, ShieldCheck, Workflow } from "lucide-react";

import { PortfolioStatePanel } from "@/components/portfolio/portfolio-state-panel";
import type { PortfolioRequestTimeline } from "@/lib/portfolio-api";
import { formatPortfolioTime, portfolioStatusLabel, portfolioTimelineLabel, usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioTimelineProps {
  timeline: PortfolioRequestTimeline | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function PortfolioTimeline({ timeline, isLoading, error, onRetry }: PortfolioTimelineProps) {
  const { copy, language } = usePortfolioCopy();
  if (isLoading) return <PortfolioStatePanel state="loading" />;
  if (error) return <PortfolioStatePanel state="error" message={error.message} onRetry={onRetry} />;
  if (!timeline || timeline.events.length === 0) return <PortfolioStatePanel state="empty" />;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label={copy.timeline}>
      <div className="border-b border-border/70 px-4 py-3">
        <h2 className="text-sm font-semibold">{copy.timeline}</h2>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{timeline.request.originalText || copy.none}</p>
      </div>
      <ol className="divide-y divide-border/70">
        {timeline.events.map((event) => {
          const Icon = iconFor(event.kind);
          return (
            <li key={event.id} className="flex gap-3 px-4 py-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="size-3.5" /></div>
              <div className="min-w-0 flex-1"><div className="text-xs font-medium">{portfolioTimelineLabel(event.kind, copy)}</div><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{portfolioStatusLabel(event.state, copy)}</p></div>
              <div className="shrink-0 text-right text-[11px] text-muted-foreground"><time dateTime={event.occurredAt}>{formatPortfolioTime(event.occurredAt, language, copy.unknownTime)}</time></div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function iconFor(kind: "request" | "intake_decision" | "work_item") {
  if (kind === "intake_decision") return ShieldCheck;
  if (kind === "work_item") return Workflow;
  return ClipboardList;
}
