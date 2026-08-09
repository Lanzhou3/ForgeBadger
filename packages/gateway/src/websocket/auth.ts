import type { IncomingHttpHeaders } from "node:http";

import { extractBearerToken } from "../auth/middleware.js";

export function extractWsAuthToken(
  headers: IncomingHttpHeaders,
  expectedProtocol: string
): string | undefined {
  const fromHeader = extractBearerToken(headers.authorization);
  if (fromHeader) {
    return fromHeader;
  }

  const protocolHeader = headers["sec-websocket-protocol"];
  if (!protocolHeader) {
    return undefined;
  }

  const protocols = Array.isArray(protocolHeader) ? protocolHeader : [protocolHeader];
  const tokens = protocols
    .flatMap((protocol: string) => protocol.split(",").map((item: string) => item.trim()))
    .filter(Boolean);

  if (tokens[0] !== expectedProtocol) {
    return undefined;
  }

  if (tokens.length < 2) {
    return undefined;
  }

  return tokens[1];
}

export function extractWsAttachToken(
  headers: IncomingHttpHeaders,
  expectedProtocol: string
): string | undefined {
  const protocolHeader = headers["sec-websocket-protocol"];
  if (!protocolHeader) {
    return undefined;
  }

  const protocols = Array.isArray(protocolHeader) ? protocolHeader : [protocolHeader];
  const tokens = protocols
    .flatMap((protocol: string) => protocol.split(",").map((item: string) => item.trim()))
    .filter(Boolean);

  if (tokens[0] !== expectedProtocol || tokens.length < 3) {
    return undefined;
  }

  return tokens[2];
}
