import { Activity, AlertTriangle, FileCheck2, ShieldCheck } from "lucide-react";

import type { PortfolioWorkspaceProjection } from "@/lib/portfolio-api";
import { portfolioStatusLabel, usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioStatusRailProps {
  projection: PortfolioWorkspaceProjection;
}

export function PortfolioStatusRail({ projection }: PortfolioStatusRailProps) {
  const { copy } = usePortfolioCopy();
  const pendingAuthorizations = projection.authorizations.filter((item) => !isSettled(item.state)).length;
  const activeRisks = projection.risks.filter((item) => !isSettled(item.state)).length;
  const heartbeat = projection.heartbeat;

  const metrics = [
    { label: copy.dossiers, value: projection.dossiers.length, icon: FileCheck2, tone: "text-brand" },
    { label: copy.activeRisks, value: activeRisks, icon: AlertTriangle, tone: activeRisks > 0 ? "text-amber-400" : "text-muted-foreground" },
    { label: copy.authorization, value: pendingAuthorizations > 0 ? `${pendingAuthorizations} ${copy.pending}` : copy.clear, icon: ShieldCheck, tone: pendingAuthorizations > 0 ? "text-amber-400" : "text-emerald-400" },
    { label: copy.heartbeat, value: heartbeat?.enabled ? portfolioStatusLabel(heartbeat.state, copy) : copy.disabled, icon: Activity, tone: heartbeat?.enabled ? "text-emerald-400" : "text-muted-foreground" },
  ];

  return (
    <section className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-2 xl:grid-cols-4" aria-label={copy.statusSummary}>
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <div key={metric.label} className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-border/70 sm:border-l sm:border-t-0" : ""}`}>
            <Icon className={`size-4 ${metric.tone}`} />
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</div>
              <div className="truncate text-sm font-semibold">{metric.value}</div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function isSettled(state: string): boolean {
  return ["resolved", "accepted", "rejected", "expired", "cancelled", "consumed"].includes(state);
}
