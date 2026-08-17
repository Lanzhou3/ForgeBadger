import { fetchJson } from "@/lib/api";

/**
 * Portfolio operations are gateway-managed (copilot tools, the Feishu bound-chat
 * requirement flow, and the OperationsRuntime scheduler). The web surface is
 * reduced to the heartbeat control that lives in the copilot settings popover.
 */

export const portfolioQueryKeys = {
  root: ["portfolio"] as const,
  heartbeat: ["portfolio", "heartbeat"] as const,
};

export interface PortfolioHeartbeat {
  enabled: boolean;
  cadenceMinutes?: number | null;
  lastObservedAt?: string | null;
  state?: string | null;
  projectionVersion: number;
}

export interface PortfolioHeartbeatInput {
  enabled: boolean;
  cadenceMinutes?: number;
}

export interface PortfolioHeartbeatOptions {
  /** Reuse this exact key after an interrupted request; do not mint one per retry. */
  idempotencyKey: string;
}

function portfolioPath(path: string): string {
  return `/api/v1/portfolio${path}`;
}

export async function getPortfolioHeartbeat(): Promise<PortfolioHeartbeat> {
  const body = await fetchJson<Record<string, unknown>>(portfolioPath("/heartbeat"));
  return normalizeHeartbeat(record(body.heartbeat ?? { enabled: false }));
}

export async function updatePortfolioHeartbeat(
  input: PortfolioHeartbeatInput,
  options: PortfolioHeartbeatOptions
): Promise<PortfolioHeartbeat> {
  const heartbeat = await fetchJson<Record<string, unknown>>(portfolioPath("/heartbeat"), {
    method: "PUT",
    headers: { "Idempotency-Key": options.idempotencyKey },
    body: JSON.stringify({
      enabled: input.enabled,
      ...(input.cadenceMinutes === undefined ? {} : { cadenceMinutes: input.cadenceMinutes }),
    }),
  });
  return normalizeHeartbeat(heartbeat);
}

function normalizeHeartbeat(value: Record<string, unknown>): PortfolioHeartbeat {
  return { enabled: value.enabled === true, cadenceMinutes: numberOrNull(value.cadenceMinutes ?? value.cadence_minutes), lastObservedAt: nullableTimestamp(value.lastObservedAt ?? value.last_observed_at), state: nullableString(value.state), projectionVersion: number(value.projectionVersion ?? value.projection_version) };
}

function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nullableString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function number(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nullableTimestamp(value: unknown): string | null { const result = typeof value === "string" && value.length > 0 ? value : ""; return result || null; }
