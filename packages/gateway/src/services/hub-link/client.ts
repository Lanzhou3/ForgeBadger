import { isIP } from "node:net";

import { z } from "zod";

import { assertResolvedPublicHttpsEndpoint, type PublicEndpointOptions } from "../network-policy.js";

export class HubLinkError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "HubLinkError";
  }
}

export interface HubClientIO {
  fetch?: typeof fetch;
  validate?: typeof assertResolvedPublicHttpsEndpoint;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const envelope = z.object({ code: z.number(), data: z.unknown().optional(), message: z.string().optional() });

/**
 * The hub is a private-network service by design, so private addresses are
 * allowed for this one configured endpoint. Plain HTTP is accepted only for
 * loopback (an SSH port-forward to the hub); every other address must be
 * HTTPS so the node token never crosses the LAN in clear text. Cloud metadata
 * hosts and credentials in the URL stay blocked by the shared policy.
 */
export function hubEndpointOptions(url: URL): PublicEndpointOptions {
  return { allowPrivateNetworks: true, allowPlaintextHttp: LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) };
}

/** Normalizes a user-entered hub address to its origin, or throws HUB_URL_INVALID. */
export function normalizeHubUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new HubLinkError(400, "HUB_URL_INVALID"); }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password) {
    throw new HubLinkError(400, "HUB_URL_INVALID");
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) throw new HubLinkError(400, "HUB_URL_HTTPS_REQUIRED");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HubLinkError(400, "HUB_URL_INVALID");
  // An IPv6 literal keeps its brackets in `origin`, which is what fetch needs.
  if (isIP(url.hostname) === 0 && !/^[A-Za-z0-9.-]+$|^\[[0-9a-fA-F:]+\]$/.test(url.hostname)) throw new HubLinkError(400, "HUB_URL_INVALID");
  return url.origin;
}

/** Minimal client for the hub's node API (`/api/v1/hub`). One request per call, no retries. */
export class HubClient {
  private readonly request: typeof fetch;
  private readonly validate: typeof assertResolvedPublicHttpsEndpoint;

  constructor(private readonly baseUrl: string, private readonly token: string, io: HubClientIO = {}) {
    this.request = io.fetch ?? fetch;
    this.validate = io.validate ?? assertResolvedPublicHttpsEndpoint;
  }

  get<T>(path: string): Promise<T> {
    return this.call<T>("GET", path);
  }

  send<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T> {
    return this.call<T>(method, path, body);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(`/api/v1/hub${path}`, this.baseUrl);
    try {
      await this.validate(url.origin, undefined, hubEndpointOptions(url));
    } catch {
      throw new HubLinkError(400, "HUB_URL_REJECTED");
    }
    let response: Response;
    try {
      response = await this.request(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch {
      throw new HubLinkError(502, "HUB_UNREACHABLE");
    }
    const parsed = envelope.safeParse(await readJson(response));
    if (response.status === 401) throw new HubLinkError(401, "HUB_TOKEN_REJECTED");
    if (!parsed.success) throw new HubLinkError(502, "HUB_RESPONSE_INVALID");
    if (!response.ok || parsed.data.code !== 0) {
      const code = /^[A-Z][A-Z0-9_]{2,63}$/.test(parsed.data.message ?? "") ? parsed.data.message! : "HUB_REQUEST_FAILED";
      throw new HubLinkError(response.status >= 400 && response.status < 500 ? response.status : 502, code);
    }
    return parsed.data.data as T;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
