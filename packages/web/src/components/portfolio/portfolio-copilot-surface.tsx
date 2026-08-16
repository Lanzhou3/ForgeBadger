"use client";

import { PortfolioWorkspace } from "@/components/portfolio/portfolio-workspace";
import { usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioCopilotSurfaceProps {
  initialProjectId?: string | null;
}

/**
 * Compatibility presentation for the `/copilot` bookmark and floating drawer.
 * Its workflow is Portfolio-only: redacted projection, governed requests, and
 * bounded owner/heartbeat controls are provided by PortfolioWorkspace.
 */
export function PortfolioCopilotSurface({ initialProjectId }: PortfolioCopilotSurfaceProps) {
  const { copy } = usePortfolioCopy();
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {copy.pageDescription} {copy.safety}
        </p>
      </div>
      <PortfolioWorkspace initialProjectId={initialProjectId} />
    </div>
  );
}
