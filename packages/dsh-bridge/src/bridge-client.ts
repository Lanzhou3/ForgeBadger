/**
 * Minimal HTTP client for the Gateway internal copilot-bridge API.
 *
 * Contract (implemented by the Gateway, do not deviate):
 * - Base: `{gatewayUrl}/api/internal/v1/copilot-bridge`
 * - Headers: `Authorization: Bearer <token>`, `X-OpenForge-User-Id: <userId>`
 * - Envelope: `{ code: 0, data, message }` on success, `{ code: 1, message, details }` on error
 *
 * @module
 */

import type { JsonValue } from "@deepseek-ai/dsh-tools";

import type { BridgeConfig } from "./bridge-config.js";

/** One JSON object payload as returned by the internal API. */
export type JsonObject = Record<string, JsonValue>;

/** Error raised for any non-success internal API outcome. */
export class BridgeApiError extends Error {
  /** HTTP status when a response was received. */
  readonly status?: number;
  /** Envelope `details` payload when present. */
  readonly details?: unknown;

  constructor(message: string, options: { status?: number; details?: unknown; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "BridgeApiError";
    if (options.status !== undefined) this.status = options.status;
    if (options.details !== undefined) this.details = options.details;
  }
}

/** Subset of fetch used by the client (injectable for tests). */
export type BridgeFetch = typeof fetch;

/** Options for one internal API call. */
interface RequestOptions {
  readonly method?: "GET" | "POST";
  /** Query parameters; undefined/empty values are omitted. */
  readonly query?: Readonly<Record<string, string | undefined>>;
  /** JSON body (POST only). */
  readonly body?: unknown;
  /** Caller cancellation, fused with the per-request timeout. */
  readonly signal?: AbortSignal;
}

/** Success envelope shape. */
interface Envelope {
  code: number;
  data?: unknown;
  message?: string;
  details?: unknown;
}

/**
 * Internal API client. One instance per runtime process; all methods throw
 * {@link BridgeApiError} with the Gateway's `message` on `code !== 0`, on
 * transport failure, or on timeout.
 */
export class BridgeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: BridgeFetch;

  constructor(config: BridgeConfig, fetchImpl: BridgeFetch = fetch) {
    this.baseUrl = `${config.gatewayUrl}/api/internal/v1/copilot-bridge`;
    this.token = config.token;
    this.userId = config.userId;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  /** `GET /work-items?projectId=&status=` */
  async listWorkItems(filter: { projectId?: string; status?: string }, signal?: AbortSignal): Promise<JsonObject[]> {
    // The internal API contract wraps the list: data is `{ workItems, count }`.
    const data = await this.request("/work-items", { query: { projectId: filter.projectId, status: filter.status }, ...(signal ? { signal } : {}) }) as { workItems: JsonObject[] };
    return data.workItems;
  }

  /** `POST /work-items/:id/advance` with `{ note? }` */
  async advanceWorkItem(id: string, note?: string, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request(`/work-items/${encodeURIComponent(id)}/advance`, {
      method: "POST",
      body: note === undefined ? {} : { note },
      ...(signal ? { signal } : {}),
    }) as JsonObject;
  }

  /** `GET /sessions` */
  async listSessions(signal?: AbortSignal): Promise<JsonObject[]> {
    // The internal API contract wraps the list: data is `{ sessions, count }`.
    const data = await this.request("/sessions", signal ? { signal } : {}) as { sessions: JsonObject[] };
    return data.sessions;
  }

  /** `POST /sessions/:id/dispatch` with `{ message }` */
  async dispatchToSession(sessionId: string, message: string, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request(`/sessions/${encodeURIComponent(sessionId)}/dispatch`, {
      method: "POST",
      body: { message },
      ...(signal ? { signal } : {}),
    }) as JsonObject;
  }

  private async request(path: string, options: RequestOptions): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.token}`,
          "x-openforge-user-id": this.userId,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal,
      });
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === "AbortError";
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new BridgeApiError(
        timedOut
          ? `internal API request timed out after ${this.timeoutMs}ms: ${options.method ?? "GET"} ${path}`
          : aborted
            ? `internal API request aborted: ${options.method ?? "GET"} ${path}`
            : `internal API request failed: ${options.method ?? "GET"} ${path}: ${String(cause)}`,
        { cause },
      );
    }

    let envelope: Envelope;
    try {
      envelope = (await response.json()) as Envelope;
    } catch (cause) {
      throw new BridgeApiError(
        `internal API returned non-JSON response (HTTP ${response.status}): ${options.method ?? "GET"} ${path}`,
        { status: response.status, cause },
      );
    }

    if (envelope.code !== 0) {
      throw new BridgeApiError(
        envelope.message ?? `internal API error (HTTP ${response.status})`,
        { status: response.status, details: envelope.details },
      );
    }
    return envelope.data;
  }
}
