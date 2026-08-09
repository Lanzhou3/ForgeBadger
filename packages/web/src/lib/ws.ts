import { getGatewayBaseUrl } from "./runtime-config";

export interface TerminalWebSocketAuth {
  authToken: string;
  attachToken: string;
}

export function terminalWebSocketUrl(
  sessionId: string,
  baseUrl = getGatewayBaseUrl()
): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/terminal/${encodeURIComponent(sessionId)}`;
  return url.toString();
}

export function terminalWebSocketProtocols(authToken: string, attachToken: string): string[] {
  // The attach token is delivered through the subprotocol header rather than
  // the URL query so it never appears in browser address bars, server access
  // logs, or HTTP referrer headers.
  return ["openforge-terminal", authToken, attachToken];
}

export function eventsWebSocketUrl(baseUrl = getGatewayBaseUrl()): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/events";
  return url.toString();
}

export function eventsWebSocketProtocols(authToken: string): string[] {
  return ["openforge-events", authToken];
}
