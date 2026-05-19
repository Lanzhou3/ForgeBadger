import type { GatewayEvent } from "@/lib/notifications";

export const OPENFORGE_GATEWAY_EVENT = "openforge:gateway-event";

export function dispatchGatewayEvent(event: GatewayEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPENFORGE_GATEWAY_EVENT, { detail: event }));
}
