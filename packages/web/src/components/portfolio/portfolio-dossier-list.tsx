import { ChevronRight, FolderKanban } from "lucide-react";

import type { PortfolioDossier, PortfolioWorkspaceProjection } from "@/lib/portfolio-api";
import { usePortfolioCopy } from "@/lib/portfolio-i18n";
import { cn } from "@/lib/utils";

interface PortfolioDossierListProps {
  dossiers: PortfolioDossier[];
  projection: PortfolioWorkspaceProjection;
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function PortfolioDossierList({ dossiers, projection, selectedProjectId, onSelect }: PortfolioDossierListProps) {
  const { copy } = usePortfolioCopy();
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label={copy.dossiers}>
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{copy.dossiers}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.dossiersDescription}</p>
        </div>
        <span className="text-xs text-muted-foreground">{dossiers.length}</span>
      </div>
      <div className="divide-y divide-border/70">
        {dossiers.map((dossier) => {
          const workItems = projection.workItems.filter((item) => item.projectId === dossier.projectId);
          const risks = projection.risks.filter((item) => item.projectId === dossier.projectId && !isClosed(item.state));
          const selected = dossier.projectId === selectedProjectId;
          return (
            <button
              key={dossier.id}
              type="button"
              onClick={() => onSelect(dossier.projectId)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "bg-brand/10"
              )}
              aria-pressed={selected}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <FolderKanban className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{dossier.projectName || dossier.projectId || copy.none}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{dossier.observedState?.summary ?? copy.noObservedState}</div>
              </div>
              <div className="hidden text-right text-xs text-muted-foreground sm:block">
                <div>{workItems.length} {copy.workItems}</div>
                <div className={risks.length > 0 ? "mt-0.5 text-amber-400" : "mt-0.5"}>{risks.length} {copy.activeRisks}</div>
              </div>
              <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground", selected && "text-brand")} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function isClosed(state: string): boolean {
  return ["resolved", "dismissed", "cancelled"].includes(state);
}
