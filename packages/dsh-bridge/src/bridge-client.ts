/**
 * Minimal HTTP client for the Gateway internal copilot-bridge API.
 *
 * Contract (implemented by the Gateway, do not deviate):
 * - Base: `{gatewayUrl}/api/internal/v1/copilot-bridge`
 * - Headers: `Authorization: Bearer <token>`, `X-ForgeBadger-User-Id: <userId>`
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

  /** `GET /sessions?projectId=&limit=` */
  async listSessions(filter: { projectId?: string; limit?: number } = {}, signal?: AbortSignal): Promise<JsonObject[]> {
    // The internal API contract wraps the list: data is `{ sessions, count }`.
    const data = await this.request("/sessions", {
      query: { projectId: filter.projectId, limit: filter.limit === undefined ? undefined : String(filter.limit) },
      ...(signal ? { signal } : {}),
    }) as { sessions: JsonObject[] };
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

  /** `GET /projects?limit=` */
  async listProjects(filter: { limit?: number }, signal?: AbortSignal): Promise<JsonObject[]> {
    const data = await this.request("/projects", {
      query: { limit: filter.limit === undefined ? undefined : String(filter.limit) },
      ...(signal ? { signal } : {}),
    }) as { projects: JsonObject[] };
    return data.projects;
  }

  /** `GET /projects/:id` — missing/foreign projects come back as `{ found: false }`. */
  async getProject(projectId: string, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request(`/projects/${encodeURIComponent(projectId)}`, signal ? { signal } : {}) as JsonObject;
  }

  /** `GET /projects/:id/graph/search?q=&kind=&limit=` — CodeGraph symbol search. */
  async projectGraphSearch(
    input: { projectId: string; q: string; kind?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    const data = await this.request(
      `/projects/${encodeURIComponent(input.projectId)}/graph/search`,
      {
        query: {
          q: input.q,
          kind: input.kind,
          limit: input.limit === undefined ? undefined : String(input.limit),
        },
        ...(signal ? { signal } : {}),
      },
    ) as JsonObject;
    return data;
  }

  /** `GET /projects/:id/graph/symbols/:symbolId` — definition + callers/callees. */
  async projectGraphSymbolDetail(
    input: { projectId: string; symbolId: string },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return await this.request(
      `/projects/${encodeURIComponent(input.projectId)}/graph/symbols/${encodeURIComponent(input.symbolId)}`,
      signal ? { signal } : {},
    ) as JsonObject;
  }

  /** `GET /projects/:id/graph/symbols/:symbolId/impact?depth=` — blast radius. */
  async projectGraphImpact(
    input: { projectId: string; symbolId: string; depth?: number },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return await this.request(
      `/projects/${encodeURIComponent(input.projectId)}/graph/symbols/${encodeURIComponent(input.symbolId)}/impact`,
      {
        query: { depth: input.depth === undefined ? undefined : String(input.depth) },
        ...(signal ? { signal } : {}),
      },
    ) as JsonObject;
  }

  /** `POST /projects/:id/graph/affected` with `{ paths, depth? }` — multi-file blast radius. */
  async projectGraphAffectedPaths(
    input: { projectId: string; paths: string[]; depth?: number },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return await this.request(
      `/projects/${encodeURIComponent(input.projectId)}/graph/affected`,
      {
        method: "POST",
        body: {
          paths: input.paths,
          ...(input.depth !== undefined ? { depth: input.depth } : {}),
        },
        ...(signal ? { signal } : {}),
      },
    ) as JsonObject;
  }

  /** `POST /projects` with `{ name, path, description? }` */
  async createProject(input: { name: string; path: string; description?: string }, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request("/projects", {
      method: "POST",
      body: { name: input.name, path: input.path, ...(input.description === undefined ? {} : { description: input.description }) },
      ...(signal ? { signal } : {}),
    }) as JsonObject;
  }

  /** `GET /portfolio/overview` */
  async portfolioOverview(signal?: AbortSignal): Promise<JsonObject> {
    const data = await this.request("/portfolio/overview", signal ? { signal } : {}) as { overview: JsonObject };
    return data.overview;
  }

  /** `GET /portfolio/requests?projectId=&limit=` */
  async listPortfolioRequests(filter: { projectId?: string; limit?: number }, signal?: AbortSignal): Promise<JsonObject[]> {
    const data = await this.request("/portfolio/requests", {
      query: { projectId: filter.projectId, limit: filter.limit === undefined ? undefined : String(filter.limit) },
      ...(signal ? { signal } : {}),
    }) as { requests: JsonObject[] };
    return data.requests;
  }

  /** `GET /portfolio/projects/:id/dossier` */
  async getProjectDossier(projectId: string, signal?: AbortSignal): Promise<JsonObject> {
    const data = await this.request(`/portfolio/projects/${encodeURIComponent(projectId)}/dossier`, signal ? { signal } : {}) as { dossier: JsonObject };
    return data.dossier;
  }

  /** `GET /skills` */
  async listSkills(signal?: AbortSignal): Promise<JsonObject> {
    return await this.request("/skills", signal ? { signal } : {}) as JsonObject;
  }

  /** `GET /skills/:name` */
  async loadSkill(name: string, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request(`/skills/${encodeURIComponent(name)}`, signal ? { signal } : {}) as JsonObject;
  }

  /** `GET /usage/summary?days=` */
  async usageSummary(filter: { days?: number } = {}, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request("/usage/summary", {
      query: { days: filter.days === undefined ? undefined : String(filter.days) },
      ...(signal ? { signal } : {}),
    }) as JsonObject;
  }

  /** `GET /sessions/:id/output?maxLines=` */
  async sessionOutput(sessionId: string, maxLines?: number, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request(`/sessions/${encodeURIComponent(sessionId)}/output`, {
      query: { maxLines: maxLines === undefined ? undefined : String(maxLines) },
      ...(signal ? { signal } : {}),
    }) as JsonObject;
  }

  /** `GET /pm/projects/:projectId/task-packets?limit=` */
  async listTaskPackets(projectId: string, limit?: number, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request(`/pm/projects/${encodeURIComponent(projectId)}/task-packets`, {
      query: { limit: limit === undefined ? undefined : String(limit) },
      ...(signal ? { signal } : {}),
    }) as JsonObject;
  }

  /** `GET /pm/projects/:projectId/task-packet?workItemId=` */
  async getTaskPacket(projectId: string, workItemId: string, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request(`/pm/projects/${encodeURIComponent(projectId)}/task-packet`, {
      query: { workItemId },
      ...(signal ? { signal } : {}),
    }) as JsonObject;
  }

  /** `POST /pm/projects/:projectId/task-packet/start` */
  async startTaskPacket(
    projectId: string,
    input: { workItemId: string; aiTool?: string },
    signal?: AbortSignal,
  ): Promise<JsonObject> {
    return await this.request(`/pm/projects/${encodeURIComponent(projectId)}/task-packet/start`, {
      method: "POST",
      body: {
        workItemId: input.workItemId,
        ...(input.aiTool !== undefined ? { aiTool: input.aiTool } : {}),
      },
      ...(signal ? { signal } : {}),
    }) as JsonObject;
  }

  /** `GET /work-items/:id` */
  async getWorkItem(workItemId: string, signal?: AbortSignal): Promise<JsonObject> {
    const data = await this.request(`/work-items/${encodeURIComponent(workItemId)}`, signal ? { signal } : {}) as { workItem: JsonObject };
    return data.workItem;
  }

  /** `GET /memory/entries?scope=&projectId=&limit=` */
  async listMemoryEntries(filter: { scope?: string; projectId?: string; limit?: number }, signal?: AbortSignal): Promise<JsonObject[]> {
    const data = await this.request("/memory/entries", {
      query: {
        scope: filter.scope,
        projectId: filter.projectId,
        limit: filter.limit === undefined ? undefined : String(filter.limit),
      },
      ...(signal ? { signal } : {}),
    }) as { entries: JsonObject[] };
    return data.entries;
  }

  /** `GET /memory/search?q=&scope=&projectId=&limit=` */
  async searchMemory(filter: { query: string; scope?: string; projectId?: string; limit?: number }, signal?: AbortSignal): Promise<JsonObject[]> {
    const data = await this.request("/memory/search", {
      query: {
        q: filter.query,
        scope: filter.scope,
        projectId: filter.projectId,
        limit: filter.limit === undefined ? undefined : String(filter.limit),
      },
      ...(signal ? { signal } : {}),
    }) as { entries: JsonObject[] };
    return data.entries;
  }

  /** `POST /memory/entries` with `{ kind, scope, text, projectId?, metadata? }` */
  async writeMemory(input: { kind: string; scope: string; text: string; projectId?: string; metadata?: unknown }, signal?: AbortSignal): Promise<JsonObject> {
    return await this.request("/memory/entries", {
      method: "POST",
      body: {
        kind: input.kind,
        scope: input.scope,
        text: input.text,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
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
          "x-forgebadger-user-id": this.userId,
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
