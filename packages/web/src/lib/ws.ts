import { getGatewayBaseUrl } from "./runtime-config";

export interface TerminalWebSocketAuth {
  authToken: string;
  attachToken: string;
}

export function terminalWebSocketUrl(
  sessionId: string,
  auth: TerminalWebSocketAuth,
  baseUrl = getGatewayBaseUrl()
): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/terminal/${encodeURIComponent(sessionId)}`;
  url.searchParams.set("attachToken", auth.attachToken);
  return url.toString();
}

export function terminalWebSocketProtocols(authToken: string): string[] {
  return ["openforge-terminal", authToken];
}

export function eventsWebSocketUrl(authToken: string, baseUrl = getGatewayBaseUrl()): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/events";
  url.searchParams.set("token", authToken);
  return url.toString();
}
