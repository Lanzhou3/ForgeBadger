export interface CurrentEvidenceClock {
  now(): Date;
}

export interface CurrentEvidence {
  sourceCategory: string;
  confidence: string;
  freshness: string;
  observedAt: Date;
}

export type ObservationSourceWindow = "platform_lifecycle_v1" | "git_state_v1";

export const observationSourceWindows: Readonly<Record<ObservationSourceWindow, number>> = {
  platform_lifecycle_v1: 5 * 60_000,
  git_state_v1: 15 * 60_000
};

export function isObservationSourceWindow(sourceCategory: string): sourceCategory is ObservationSourceWindow {
  return sourceCategory === "platform_lifecycle_v1" || sourceCategory === "git_state_v1";
}

/**
 * V1 evidence is current only when its durable source result is fresh and its
 * source-owned observation window has not elapsed. Legacy Phase 3 categories
 * have no declared window, so only their explicit `current` form is admitted.
 */
export function isCurrentPortfolioEvidence(evidence: CurrentEvidence, now: Date): boolean {
  const trusted = evidence.confidence === "high" || evidence.confidence === "trusted" || evidence.confidence === "trusted_platform";
  if (!trusted) return false;
  if (!isObservationSourceWindow(evidence.sourceCategory)) return evidence.freshness === "current";
  return evidence.freshness === "fresh"
    && evidence.observedAt.getTime() + observationSourceWindows[evidence.sourceCategory] >= now.getTime();
}
