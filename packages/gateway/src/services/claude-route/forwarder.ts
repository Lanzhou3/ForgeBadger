import {
  assertResolvedPublicHttpsEndpoint,
  type OutboundHostResolver
} from "../network-policy.js";
import type { Database } from "../../db/types.js";
import { ClaudeRouteRepository } from "../../db/repositories/claude-route-repository.js";
import {
  ModelProviderRepository,
  type ProviderCredentialSummary,
  type ProviderProfile
} from "../../db/repositories/model-provider-repository.js";
import { endpointForAdapter } from "../cli-config-apply.js";
import { anthropicToOpenaiRequest } from "./transform-request.js";
import { estimateInputTokens, openaiToAnthropicResponse } from "./transform-response.js";
import { openaiSseToAnthropicSse } from "./transform-stream.js";

export class ClaudeRouteError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface RouteTarget {
  userId: string;
  provider: ProviderProfile;
  credential: ProviderCredentialSummary;
  secret: string;
  baseUrl: string;
}

export interface SseResponseLike {
  setHeader(name: string, value: string): void;
  write(chunk: string): void;
  end(): void;
  json(body: unknown): void;
  status(code: number): SseResponseLike;
}

const nonStreamTimeoutMs = 5 * 60 * 1000;
const streamTimeoutMs = 10 * 60 * 1000;
// First-byte (time-to-first-token) budget for streaming. A local large model
// spends most of this on PREFILL, and prefill time scales with input size: a
// 200K-token context can legitimately take tens of seconds before its first
// byte, longer still when other sessions share the GPU. A flat deadline (the
// previous 90s) cut legitimate large-context requests, so the budget grows
// with the estimated input tokens instead — base + inputTokens / prefillRate —
// letting a small request still fail fast on a real stall while a large
// context gets the prefill time it needs. It is capped at the total stream
// timeout so it can never exceed the request backstop.
const streamFirstByteBaseMs = 30 * 1000;
// Conservative prefill rate (tokens/sec) that assumes the GPU may be shared
// with concurrent requests; it sizes the per-token first-byte allowance.
const streamFirstBytePrefillTokensPerSec = 2000;

/** Time-to-first-byte budget for a streaming request of the given size (ms). */
export function streamFirstByteBudgetMs(estimatedInputTokens: number): number {
  const perTokenMs = Math.ceil((estimatedInputTokens / streamFirstBytePrefillTokensPerSec) * 1000);
  return Math.min(streamTimeoutMs, streamFirstByteBaseMs + perTokenMs);
}

/** Data-plane auth: route token → enabled user → assignment → provider/credential. */
export function resolveRouteTarget(
  db: Database,
  masterKey: string,
  presentedToken: string | undefined
): RouteTarget {
  if (!presentedToken) {
    throw new ClaudeRouteError("CLAUDE_ROUTE_UNAUTHORIZED", 401, "Missing route token");
  }
  const owner = ClaudeRouteRepository.resolveTokenOwner(db, masterKey, presentedToken);
  if (!owner) {
    throw new ClaudeRouteError("CLAUDE_ROUTE_UNAUTHORIZED", 401, "Unknown route token");
  }
  if (!owner.enabled) {
    throw new ClaudeRouteError("CLAUDE_ROUTE_DISABLED", 503, "Claude Code routing is disabled");
  }
  const routeRepo = new ClaudeRouteRepository(db, owner.userId, masterKey);
  const assignment = routeRepo.getAssignment();
  if (!assignment) {
    throw new ClaudeRouteError("CLAUDE_ROUTE_NOT_ASSIGNED", 404, "No provider is routed to Claude Code yet");
  }
  const repository = new ModelProviderRepository(db, owner.userId, masterKey);
  const provider = repository.getProviderProfile(assignment.providerProfileId);
  if (!provider || provider.status !== "active") {
    throw new ClaudeRouteError("CLAUDE_ROUTE_PROVIDER_MISSING", 503, "The routed provider is unavailable");
  }
  // A rotated credential must not strand the routing: fall back to the
  // provider's oldest active credential.
  const credential = repository.getCredential(assignment.credentialId);
  const resolved = credential && credential.status === "active"
    ? credential
    : repository.getOldestActiveCredential(provider.id);
  if (!resolved) {
    throw new ClaudeRouteError("CLAUDE_ROUTE_CREDENTIAL_MISSING", 503, "The routed provider has no active credential");
  }
  const baseUrl = endpointForAdapter(provider, "claude");
  if (!baseUrl) {
    throw new ClaudeRouteError("CLAUDE_ROUTE_NO_ENDPOINT", 503, "The routed provider has no endpoint");
  }
  return {
    userId: owner.userId,
    provider,
    credential: resolved,
    secret: repository.decryptCredential(resolved.id),
    baseUrl
  };
}

function upstreamUrl(baseUrl: string, anthropic: boolean): string {
  const base = baseUrl.replace(/\/+$/u, "");
  if (base.endsWith("/v1")) {
    return anthropic ? `${base}/messages` : `${base}/chat/completions`;
  }
  return anthropic ? `${base}/v1/messages` : `${base}/v1/chat/completions`;
}

function upstreamHeaders(target: RouteTarget, anthropic: boolean, incoming: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...target.provider.defaultHeaders };
  const bearer = target.provider.authType === "bearer_token";
  if (anthropic) {
    if (bearer) headers.Authorization = `Bearer ${target.secret}`;
    else headers["x-api-key"] = target.secret;
    headers["anthropic-version"] = incoming["anthropic-version"] ?? "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${target.secret}`;
  }
  return headers;
}

function anthropicError(status: number, type: string, message: string): { status: number; body: Record<string, unknown> } {
  return {
    status,
    body: { type: "error", error: { type, message } }
  };
}

export interface ForwardDeps {
  resolveHost?: OutboundHostResolver | undefined;
  /** Test seam for the upstream HTTP client. */
  fetchImpl?: typeof fetch | undefined;
  /** Test seam for the streaming time-to-first-byte deadline (ms). */
  streamFirstByteTimeoutMs?: number | undefined;
}

/**
 * Forwards one Claude Code /v1/messages request to the routed provider.
 * Anthropic-protocol providers are passed through (SSE included); OpenAI-
 * protocol providers get request/response conversion. Writes the response
 * directly to `res` (streaming passes chunks through as they arrive).
 */
export async function forwardClaudeMessages(
  deps: { db: Database; masterKey: string } & ForwardDeps,
  res: SseResponseLike,
  token: string | undefined,
  body: Record<string, unknown>,
  incomingHeaders: Record<string, string>
): Promise<void> {
  const target = resolveRouteTarget(deps.db, deps.masterKey, token);
  const anthropic = target.provider.apiFormat === "anthropic";
  try {
    await assertResolvedPublicHttpsEndpoint(target.baseUrl, deps.resolveHost, {
      allowPlaintextHttp: target.provider.allowPlaintextHttp
    });
  } catch (error) {
    const failed = anthropicError(
      502,
      "api_error",
      `Routed provider endpoint rejected: ${error instanceof Error ? error.message : String(error)}`
    );
    res.status(failed.status).json(failed.body);
    return;
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const isStream = body.stream === true;
  const requestPath = upstreamUrl(target.baseUrl, anthropic);
  const requestBody = anthropic
    ? body
    : anthropicToOpenaiRequest(body);

  // A total cap bounds the whole request (headers + streamed body) so a
  // slow-trickling upstream that never finishes cannot pin the request forever.
  // The separate first-byte deadline below is what makes a stalled start fail
  // fast with a clean 502, without waiting out this total window.
  let upstream: Response;
  try {
    upstream = await fetchImpl(requestPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...upstreamHeaders(target, anthropic, incomingHeaders)
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(isStream ? streamTimeoutMs : nonStreamTimeoutMs)
    });
  } catch (error) {
    const failed = anthropicError(502, "api_error",
      `Upstream request failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(failed.status).json(failed.body);
    return;
  }

  if (!upstream.ok) {
    let detail = `Upstream HTTP ${upstream.status}`;
    try {
      const text = await upstream.text();
      if (text) detail = `${detail}: ${text.slice(0, 500)}`;
    } catch { /* body unreadable */ }
    const failed = anthropicError(502, "api_error", detail);
    res.status(failed.status).json(failed.body);
    return;
  }

  const isSse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream") || isStream;

  if (!isSse || !upstream.body) {
    const text = await upstream.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      const failed = anthropicError(502, "api_error", "Upstream returned a non-JSON body");
      res.status(failed.status).json(failed.body);
      return;
    }
    if (anthropic) {
      res.json(parsed);
    } else {
      res.json(openaiToAnthropicResponse(parsed, typeof body.model === "string" ? body.model : ""));
    }
    return;
  }

  // Read the first upstream chunk BEFORE committing the 200. This is the
  // time-to-first-byte guard: an upstream that returns headers then stalls
  // (stuck inference, a dead proxy half-connection) is still answerable as a
  // clean 502 instead of leaving the client hanging on an open SSE response.
  // The budget grows with input size (see streamFirstByteBudgetMs) so a large
  // prefill is not mistaken for a stall; the test seam overrides it outright.
  const firstByteTimeout = deps.streamFirstByteTimeoutMs
    ?? streamFirstByteBudgetMs(estimateInputTokens(requestBody));
  const upstreamBody = upstream.body ?? new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
  const reader = upstreamBody.getReader();
  let first: ReadableStreamReadResult<Uint8Array>;
  try {
    first = await readWithTimeout(reader.read(), firstByteTimeout);
  } catch (error) {
    try { await reader.cancel(); } catch { /* best-effort release */ }
    const detail = isFirstByteTimeout(error)
      ? `Upstream produced no data within ${Math.round(firstByteTimeout / 1000)}s`
      : `Upstream stream failed: ${error instanceof Error ? error.message : String(error)}`;
    const failed = anthropicError(502, "api_error", detail);
    res.status(failed.status).json(failed.body);
    return;
  }
  if (first.done || first.value === undefined) {
    const failed = anthropicError(502, "api_error", "Upstream returned no streaming data");
    res.status(failed.status).json(failed.body);
    return;
  }

  // Replay the already-read first chunk, then keep reading the SAME reader
  // live from the upstream. Reading stops once the upstream closes or signals
  // [DONE], so a connection that lingers after completion cannot pin the
  // downstream response (and its socket) open.
  const upstreamSource: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      const decoder = new TextDecoder();
      yield first.value as Uint8Array;
      try {
        if (decoder.decode(first.value as Uint8Array).includes("data: [DONE]")) {
          await reader.cancel();
          return;
        }
        for (;;) {
          const { done, value } = await reader.read();
          if (done || value === undefined) return;
          yield value;
          if (decoder.decode(value).includes("data: [DONE]")) {
            await reader.cancel();
            return;
          }
        }
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
      }
    }
  };

  res.status(200);
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  try {
    if (anthropic) {
      // Passthrough: forward raw SSE bytes unchanged.
      const decoder = new TextDecoder();
      for await (const chunk of upstreamSource) {
        res.write(decoder.decode(chunk, { stream: true }));
      }
      res.write(decoder.decode());
    } else {
      for await (const event of openaiSseToAnthropicSse(upstreamSource, {
        requestedModel: typeof body.model === "string" ? body.model : ""
      })) {
        res.write(event);
      }
    }
  } catch (error) {
    console.warn("[claude-route] response stream write failed", {
      code: "ROUTE_STREAM_WRITE_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
  }
  res.end();
}

class FirstByteTimeoutError extends Error {}

function isFirstByteTimeout(error: unknown): boolean {
  return error instanceof FirstByteTimeoutError;
}

async function readWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FirstByteTimeoutError("First-byte timeout")), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Forwards /v1/messages/count_tokens (anthropic) or estimates locally (openai). */
export async function forwardClaudeCountTokens(
  deps: { db: Database; masterKey: string } & ForwardDeps,
  res: SseResponseLike,
  token: string | undefined,
  body: Record<string, unknown>,
  incomingHeaders: Record<string, string>
): Promise<void> {
  const target = resolveRouteTarget(deps.db, deps.masterKey, token);
  if (target.provider.apiFormat !== "anthropic") {
    res.json({ input_tokens: estimateInputTokens(body) });
    return;
  }
  try {
    await assertResolvedPublicHttpsEndpoint(target.baseUrl, deps.resolveHost, {
      allowPlaintextHttp: target.provider.allowPlaintextHttp
    });
  } catch {
    // Counting is best-effort; degrade to a local estimate.
    res.json({ input_tokens: estimateInputTokens(body) });
    return;
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = target.baseUrl.replace(/\/+$/u, "");
  const url = base.endsWith("/v1") ? `${base}/messages/count_tokens` : `${base}/v1/messages/count_tokens`;
  try {
    const upstream = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...upstreamHeaders(target, true, incomingHeaders)
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    const parsed = JSON.parse(await upstream.text()) as Record<string, unknown>;
    const tokens = Number(parsed.input_tokens);
    res.json({ input_tokens: Number.isFinite(tokens) ? tokens : estimateInputTokens(body) });
  } catch {
    res.json({ input_tokens: estimateInputTokens(body) });
  }
}

/** Serves /v1/models from the routed provider's model catalog. */
export function listClaudeRouteModels(
  db: Database,
  masterKey: string,
  token: string | undefined
): Record<string, unknown> {
  const target = resolveRouteTarget(db, masterKey, token);
  const models = new ModelProviderRepository(db, target.userId, masterKey)
    .listModelProfiles(target.provider.id)
    .filter((model) => model.status === "active");
  const now = Math.floor(Date.now() / 1000);
  return {
    data: models.map((model) => ({
      id: model.modelId,
      display_name: model.name,
      created_at: now
    }))
  };
}
