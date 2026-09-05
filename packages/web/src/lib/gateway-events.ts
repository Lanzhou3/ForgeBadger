import type { GatewayEvent } from "@/lib/notifications";

export const FORGEBADGER_GATEWAY_CONNECTED = "forgebadger:gateway-connected";

export const FORGEBADGER_GATEWAY_EVENT = "forgebadger:gateway-event";

export function dispatchGatewayEvent(event: GatewayEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FORGEBADGER_GATEWAY_EVENT, { detail: event }));
}
