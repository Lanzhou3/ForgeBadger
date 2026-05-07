import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ModelEndpointHealth {
  healthy: boolean;
  endpoint: string;
  latencyMs: number;
  timeoutMs: number;
  statusCode?: number;
  checkedAt: string;
  error?: string;
}

export interface CheckModelEndpointInput {
  endpoint: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  resolveHost?: (
    hostname: string,
    options: { all: true }
  ) => Promise<Array<{ address: string; family: number }>>;
}

export async function checkModelEndpoint(input: CheckModelEndpointInput): Promise<ModelEndpointHealth> {
  const timeoutMs = input.timeoutMs ?? 3000;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => Date.now());
  const resolveHost = input.resolveHost ?? lookup;
  const start = now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(input.endpoint);
    } catch {
      const latencyMs = Math.max(0, now() - start);
      const checkedAt = new Date().toISOString();
      return {
        healthy: false,
        endpoint: input.endpoint,
        latencyMs,
        timeoutMs,
        checkedAt,
        error: "Invalid endpoint URL"
      };
    }

    if (endpointUrl.protocol !== "https:") {
      const latencyMs = Math.max(0, now() - start);
      const checkedAt = new Date().toISOString();
      return {
        healthy: false,
        endpoint: input.endpoint,
        latencyMs,
        timeoutMs,
        checkedAt,
        error: "Only https protocol is allowed"
      };
    }

    const blocked = await validateEndpointHost(endpointUrl.hostname, resolveHost);
    if (blocked) {
      const latencyMs = Math.max(0, now() - start);
      const checkedAt = new Date().toISOString();
      return {
        healthy: false,
        endpoint: input.endpoint,
        latencyMs,
        timeoutMs,
        checkedAt,
        error: blocked
      };
    }

    const response = await fetchImpl(input.endpoint, {
      method: "HEAD",
      signal: controller.signal,
    });
    const checkedAt = new Date().toISOString();
    const latencyMs = Math.max(0, now() - start);
    return {
      healthy: response.status < 500,
      endpoint: input.endpoint,
      latencyMs,
      timeoutMs,
      statusCode: response.status,
      checkedAt
    };
  } catch (error) {
    const latencyMs = Math.max(0, now() - start);
    const checkedAt = new Date().toISOString();
    return {
      healthy: false,
      endpoint: input.endpoint,
      latencyMs,
      timeoutMs,
      checkedAt,
      error: error instanceof DOMException && error.name === "AbortError"
        ? "Request timed out"
        : error instanceof Error
          ? error.message
          : "Endpoint check failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateEndpointHost(
  hostname: string,
  resolveHost: CheckModelEndpointInput["resolveHost"]
): Promise<string | undefined> {
  const blockedByName = isBlockedMetadataHost(hostname);
  if (blockedByName) {
    return blockedByName;
  }

  const blockedByIp = isBlockedIpAddress(hostname);
  if (blockedByIp) {
    return blockedByIp;
  }

  if (!resolveHost) {
    return undefined;
  }

  try {
    const addresses = await resolveHost(hostname, { all: true });
    if (addresses.length === 0) {
      return "Endpoint host did not resolve to any address";
    }
    for (const entry of addresses) {
      const blocked = isBlockedIpAddress(entry.address);
      if (blocked) {
        return blocked;
      }
    }
  } catch {
    return "Unable to resolve endpoint host";
  }

  return undefined;
}

function isBlockedMetadataHost(hostname: string): string | undefined {
  const value = hostname.toLowerCase();
  if (value === "metadata.google.internal" || value.endsWith(".metadata.google.internal")) {
    return "Metadata hostnames are not allowed";
  }
  if (value === "localhost" || value === "localhost.localdomain") {
    return "Loopback addresses are not allowed";
  }
  return undefined;
}

function isBlockedIpAddress(hostname: string): string | undefined {
  if (isIP(hostname) === 4) {
    if (isBlockedIPv4(hostname)) {
      return "Private or loopback network addresses are not allowed";
    }
    return undefined;
  }

  if (isIP(hostname) === 6) {
    if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1" || isBlockedIPv6(hostname)) {
      return "Private or loopback network addresses are not allowed";
    }
    return undefined;
  }

  const ipv4Embedded = extractEmbeddedIPv4(hostname);
  if (ipv4Embedded && isBlockedIPv4(ipv4Embedded)) {
    return "Private or loopback network addresses are not allowed";
  }

  return undefined;
}

function isBlockedIPv4(address: string): boolean {
  const octets = address.split(".").map((segment) => Number.parseInt(segment, 10));
  if (octets.length !== 4 || octets.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return false;
  }

  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  return (
    a === 127 ||
    a === 10 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    a === 192 && b === 168
  );
}

function isBlockedIPv6(address: string): boolean {
  if (address.toLowerCase().startsWith("fe80") || address.toLowerCase().startsWith("fe9")) {
    return true;
  }
  if (address.toLowerCase().startsWith("fea") || address.toLowerCase().startsWith("feb")) {
    return true;
  }
  if (address.toLowerCase().startsWith("fec") || address.toLowerCase().startsWith("fed")) {
    return true;
  }
  if (address.toLowerCase().startsWith("fee") || address.toLowerCase().startsWith("fef")) {
    return true;
  }
  if (address.toLowerCase().startsWith("fc") || address.toLowerCase().startsWith("fd")) {
    return true;
  }
  return false;
}

function extractEmbeddedIPv4(address: string): string | undefined {
  const match = /:(?<ipv4>\d+\.\d+\.\d+\.\d+)$/.exec(address);
  return match?.groups?.ipv4;
}
