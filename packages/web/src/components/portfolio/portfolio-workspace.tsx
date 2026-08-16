"use client";

import { useEffect, useState } from "react";

import { PortfolioDossierDetail } from "@/components/portfolio/portfolio-dossier-detail";
import { PortfolioDossierList } from "@/components/portfolio/portfolio-dossier-list";
import { PortfolioHeartbeatControl } from "@/components/portfolio/portfolio-heartbeat-control";
import { PortfolioRequestInbox } from "@/components/portfolio/portfolio-request-inbox";
import { PortfolioStatePanel } from "@/components/portfolio/portfolio-state-panel";
import { PortfolioStatusRail } from "@/components/portfolio/portfolio-status-rail";
import { PortfolioTimeline } from "@/components/portfolio/portfolio-timeline";
import { usePortfolioRequestTimeline, usePortfolioWorkspaceProjection } from "@/hooks/use-portfolio";
import { GatewayApiError } from "@/lib/api";
import { usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioWorkspaceProps {
  initialProjectId?: string | null;
}

export function PortfolioWorkspace({ initialProjectId }: PortfolioWorkspaceProps) {
  const { copy } = usePortfolioCopy();
  const projectionQuery = usePortfolioWorkspaceProjection();
  const projection = projectionQuery.data;
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!projection) return;
    if (!selectedProjectId || !projection.dossiers.some((item) => item.projectId === selectedProjectId)) {
      setSelectedProjectId(projection.dossiers[0]?.projectId ?? null);
    }
  }, [projection, selectedProjectId]);

  // Keep hook order stable while the projection transitions through read states.
  const requestedDossier = projection?.dossiers.find((item) => item.projectId === selectedProjectId) ?? projection?.dossiers[0];
  const requestedTimelineId = projection?.requests.find((request) => request.projectId === requestedDossier?.projectId)?.id ?? projection?.requests[0]?.id ?? null;
  const timelineQuery = usePortfolioRequestTimeline(requestedTimelineId);

  if (projectionQuery.isLoading) return <PortfolioStatePanel state="loading" />;
  if (projectionQuery.error) {
    const error = projectionQuery.error as Error;
    const conflict = error instanceof GatewayApiError && error.status === 409;
    return <PortfolioStatePanel state={conflict ? "conflict" : "error"} message={error.message} onRetry={() => void projectionQuery.refetch()} />;
  }
  if (!projection) return <PortfolioStatePanel state="empty" />;

  const selectedDossier = projection.dossiers.find((item) => item.projectId === selectedProjectId) ?? projection.dossiers[0];
  const requestForDossier = projection.requests.filter((request) => request.projectId === selectedDossier?.projectId);
  const timelineRequestId = requestForDossier[0]?.id ?? projection.requests[0]?.id ?? null;

  return (
    <div className="space-y-4">
      <PortfolioRequestInbox dossiers={projection.dossiers} initialProjectId={initialProjectId} requests={projection.requests} />
      <PortfolioStatusRail projection={projection} />
      <PortfolioHeartbeatControl heartbeat={projection.heartbeat} />
      {projection.dossiers.length === 0 && projection.requests.length === 0 ? <PortfolioStatePanel state="empty" /> : null}
      {projection.dossiers.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)]">
          <PortfolioDossierList dossiers={projection.dossiers} projection={projection} selectedProjectId={selectedDossier?.projectId ?? null} onSelect={setSelectedProjectId} />
          {selectedDossier ? <PortfolioDossierDetail dossier={selectedDossier} projection={projection} /> : <PortfolioStatePanel state="empty" />}
        </div>
      ) : null}
      <section className="space-y-3">
        <div><h2 className="text-sm font-semibold">{copy.requests}</h2><p className="mt-0.5 text-xs text-muted-foreground">{copy.requestHistory}</p></div>
        <PortfolioTimeline timeline={timelineQuery.data} isLoading={Boolean(timelineRequestId) && timelineQuery.isLoading} error={timelineQuery.error as Error | null} onRetry={() => void timelineQuery.refetch()} />
      </section>
      <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{copy.safety}</p>
    </div>
  );
}
