import { lookup } from "node:dns/promises";

import { redactSensitiveErrorMessage } from "../lib/redaction.js";
import {
  isBlockedIpAddress as checkBlockedIpAddress,
  isBlockedMetadataHost as checkBlockedMetadataHost,
  validateOutboundHost,
  type PublicEndpointOptions
} from "./network-policy.js";

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
  allowPlaintextHttp?: boolean;
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
    const validationError = await validatePublicHttpsEndpointUrl(input.endpoint, resolveHost, {
      allowPlaintextHttp: input.allowPlaintextHttp,
    });
    if (validationError) {
      const latencyMs = Math.max(0, now() - start);
      const checkedAt = new Date().toISOString();
      return {
        healthy: false,
        endpoint: input.endpoint,
        latencyMs,
        timeoutMs,
        checkedAt,
        error: validationError
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
      error: maskRemoteError(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function validatePublicHttpsEndpointUrl(
  endpoint: string,
  resolveHost: CheckModelEndpointInput["resolveHost"] = lookup,
  options: PublicEndpointOptions = {}
): Promise<string | undefined> {
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return "Invalid endpoint URL";
  }

  const isTrustedPlaintextHttp = endpointUrl.protocol === "http:" && options.allowPlaintextHttp === true;
  if (endpointUrl.protocol !== "https:" && !isTrustedPlaintextHttp) {
    return "Only https protocol is allowed";
  }

  return validateOutboundHost(endpointUrl.hostname, resolveHost);
}

function maskRemoteError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Request timed out";
  }
  if (error instanceof Error) {
    // Strip credential-shaped substrings from upstream error messages so we
    // never echo an `sk-...` or `Bearer ...` accidentally captured from a
    // provider response into our public error envelope.
    return redactSensitiveErrorMessage(error.message);
  }
  return "Endpoint check failed";
}

function isBlockedIpAddress(hostname: string): string | undefined {
  return checkBlockedIpAddress(hostname);
}

function isBlockedMetadataHost(hostname: string): string | undefined {
  return checkBlockedMetadataHost(hostname);
}
