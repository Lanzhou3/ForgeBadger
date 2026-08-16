import type { GatewayEvent } from "@/lib/notifications";

export interface PortfolioEventState {
  highestProjectionVersion: number;
}

export interface PortfolioEventDisposition {
  shouldInvalidate: boolean;
  nextState: PortfolioEventState;
}

export function isPortfolioProjectionEvent(message: Pick<GatewayEvent, "type">): boolean {
  return message.type === "portfolio_projection_updated" || Boolean(message.type?.startsWith("portfolio."));
}

/**
 * Portfolio events are deliberately only an invalidation signal. The Web never
 * renders their payload, so an event cannot leak terminal output or credentials.
 */
export function evaluatePortfolioEvent(
  state: PortfolioEventState,
  message: GatewayEvent
): PortfolioEventDisposition {
  if (!isPortfolioProjectionEvent(message)) {
    return { shouldInvalidate: false, nextState: state };
  }

  const projectionVersion = getProjectionVersion(message.payload);
  if (projectionVersion === null || projectionVersion <= state.highestProjectionVersion) {
    return { shouldInvalidate: false, nextState: state };
  }

  return {
    shouldInvalidate: true,
    nextState: { highestProjectionVersion: projectionVersion },
  };
}

function getProjectionVersion(payload: Record<string, unknown> | undefined): number | null {
  const value = payload?.projectionVersion ?? payload?.projection_version;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
