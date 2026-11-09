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
import { redactSensitiveErrorMessage } from "../../lib/redaction.js";
import { endpointForAdapter } from "../cli-config-apply.js";
import { circuitBreakerFor, type CircuitBreaker, type CircuitDecision } from "./circuit-breaker.js";
import {
  rectifyAnthropicBudget,
  rectifyAnthropicSignature,
  shouldRectifyThinkingBudget,
  shouldRectifyThinkingSignature
} from "./rectify-anthropic.js";
import { anthropicToOpenaiRequest, type OpenAiChatRequest } from "./transform-request.js";
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

export interface RouteCandidate extends RouteTarget {
  /** True when the provider's active model list includes the requested model id. */
  hostsRequestedModel: boolean;
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
// The base is generous on purpose: a single large model (e.g. a local 27B)
// that also serves auto mode's per-action safety classifier spends long on
// prefill even for a small request, and a tight 30s floor kept 502-ing those
// classifier calls. Raising the base trades faster stall detection for
// letting a slow model finish its first token.
const streamFirstByteBaseMs = 120 * 1000;
// Conservative prefill rate (tokens/sec) that assumes the GPU may be shared
// with concurrent requests; it sizes the per-token first-byte allowance.
const streamFirstBytePrefillTokensPerSec = 2000;

/** Time-to-first-byte budget for a streaming request of the given size (ms). */
export function streamFirstByteBudgetMs(estimatedInputTokens: number): number {
  const perTokenMs = Math.ceil((estimatedInputTokens / streamFirstBytePrefillTokensPerSec) * 1000);
  return Math.min(streamTimeoutMs, streamFirstByteBaseMs + perTokenMs);
}

// ---- Upstream reliability (retry / rectify) --------------------------------

/**
 * Total upstream attempts per client request. A failed attempt may be caused
 * by the relay (rate limit, overload, a dead half-connection, or a 400 that
 * the rectifiers can repair); retrying before committing a response keeps all
 * of that invisible to Claude Code.
 */
const defaultMaxAttempts = 3;
const retryBackoffBaseMs = 500;
const retryBackoffMaxMs = 15_000;
/** Retry-After values beyond this are left to the client's own retry. */
const retryAfterCapMs = 15_000;
/**
 * A connection-level failure this late into the request window is treated as
 * a long request that failed at the end, not a transient blip: retrying it
 * would duplicate a large amount of upstream compute, so no retry.
 */
const quickFailureRetryWindowMs = 30_000;
/** Error bodies are only read this far (enough to classify + pass through). */
const upstreamErrorBodyLimit = 16_384;

/**
 * Forwards one Claude Code /v1/messages request through the user's ordered
 * candidate list (primary provider first, then failover candidates).
 * Anthropic-protocol providers are passed through (SSE included); OpenAI-
 * protocol providers get request/response conversion. Writes the response
 * directly to `res` (streaming passes chunks through as they arrive).
 *
 * Reliability, per candidate, before any response is committed: attempts are
 * retried (bounded, with backoff) for retryable upstream statuses
 * (408/429/5xx/529), early connection-level failures, and first-byte stalls.
 * Anthropic-protocol 400 rejections that the rectifiers recognize (thinking
 * signature / budget incompatibility with third-party relays) are repaired
 * in place and resent once. Circuit-open candidates are skipped without an
 * upstream call.
 *
 * Failover: a candidate whose final failure is an upstream condition hands
 * off to the next candidate (the sanitized body, when rectification already
 * ran, is what the next candidate receives); a client-side 4xx stops the
 * walk and is passed straight through. When every candidate fails, the LAST
 * candidate's own final error (status, Retry-After, body) is what the client
 * sees — never a folded 502. When every candidate's breaker is open, the
 * client gets a clean 503 so Claude Code backs off.
 */
export async function forwardClaudeMessages(
  deps: { db: Database; masterKey: string } & ForwardDeps,
  res: SseResponseLike,
  token: string | undefined,
  body: Record<string, unknown>,
  incomingHeaders: Record<string, string>
): Promise<void> {
  // Ordered candidate list: position 1 (primary) first, then failover
  // candidates. Candidates that host the requested model are preferred; when
  // none do (relay alias / stale model list) every candidate is tried in
  // priority order, exactly like the legacy single-assignment behavior.
  const requestedModel = typeof body.model === "string" ? body.model : "";
  const candidates = resolveRouteCandidates(deps.db, deps.masterKey, token, requestedModel);

  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleepFn = deps.sleepFn ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = Math.max(1, deps.maxAttempts ?? defaultMaxAttempts);
  const isStream = body.stream === true;
  const requestStart = Date.now();
  // Rectification state is shared across candidates: once the body has been
  // sanitized for one relay's complaint, the sanitized body is what the next
  // candidate receives (and a fresh 400 on it is candidate-specific).
  const shared = { rectified: false };

  let lastError: UpstreamErrorInfo | null = null;
  let circuitRefused = false;
  for (const target of candidates) {
    const anthropic = target.provider.apiFormat === "anthropic";
    try {
      await assertResolvedPublicHttpsEndpoint(target.baseUrl, deps.resolveHost, {
        allowPlaintextHttp: target.provider.allowPlaintextHttp,
        allowPrivateNetworks: target.provider.allowPrivateNetworks
      });
    } catch (error) {
      // Gateway-side configuration problem for this candidate (private
      // endpoint, unresolvable host): skip it without touching provider health.
      console.warn("[claude-route] candidate endpoint rejected, skipping", {
        code: "ROUTE_FAILOVER_SKIP",
        providerId: target.provider.id,
        message: error instanceof Error ? redactSensitiveErrorMessage(error.message) : String(error)
      });
      continue;
    }

    // Provider health circuit (per user+provider): while the breaker is open
    // the candidate is skipped without an upstream call; after the open
    // window a single half-open probe retests it before traffic is admitted.
    const breaker = circuitBreakerFor(target.userId, target.provider.id);
    const stateBeforeAllow = breaker.getState();
    const circuit = breaker.allow();
    if (!circuit.allowed) {
      circuitRefused = true;
      console.warn("[claude-route] circuit breaker is open; skipping candidate", {
        code: "ROUTE_CIRCUIT_OPEN",
        providerId: target.provider.id,
        state: stateBeforeAllow
      });
      continue;
    }
    if (stateBeforeAllow === "open" && breaker.getState() === "half_open") {
      console.info("[claude-route] circuit breaker half-open; probing the provider", {
        code: "ROUTE_CIRCUIT_PROBING",
        providerId: target.provider.id
      });
    }

    const requestPath = upstreamUrl(target.baseUrl, anthropic);
    const requestBody = anthropic
      ? body
      : anthropicToOpenaiRequest(body);
    // A total cap bounds the whole request (headers + streamed body) so a
    // slow-trickling upstream that never finishes cannot pin the request
    // forever. The separate first-byte deadline below is what makes a stalled
    // start fail fast with a clean 502, without waiting out this total window.
    // The budget grows with input size (see streamFirstByteBudgetMs) so a
    // large prefill is not mistaken for a stall; the test seam overrides it
    // outright.
    const firstByteTimeout = deps.streamFirstByteTimeoutMs
      ?? streamFirstByteBudgetMs(estimateInputTokens(requestBody));

    const result = await attemptCandidate({
      res,
      target,
      anthropic,
      breaker,
      circuit,
      requestPath,
      requestBody,
      incomingHeaders,
      isStream,
      firstByteTimeout,
      maxAttempts,
      fetchImpl,
      sleepFn,
      requestStart,
      shared
    });
    if (result.kind === "success") return;
    if (result.kind === "neutral_failure") {
      // A client-side 4xx: the request itself is the problem, and no other
      // candidate can fix it — pass it straight through.
      writeUpstreamError(res, result.error);
      return;
    }
    lastError = result.error;
    console.warn("[claude-route] candidate exhausted; trying the next one", {
      code: "ROUTE_FAILOVER",
      providerId: target.provider.id
    });
  }

  if (lastError !== null) {
    // Every candidate failed on upstream conditions: the LAST candidate's own
    // final error is what the client sees (status, Retry-After, body).
    writeUpstreamError(res, lastError);
    return;
  }
  // No candidate could even be attempted: all breakers open (the common case)
  // or every endpoint was rejected by Gateway policy.
  const refused = anthropicError(
    503,
    circuitRefused ? "overloaded_error" : "api_error",
    circuitRefused
      ? "The routed provider is temporarily unavailable; retry shortly."
      : "No routed provider endpoint is reachable"
  );
  res.status(refused.status).json(refused.body);
}

/**
 * Runs the bounded attempt loop against ONE candidate. Writes the response
 * to `res` on success (streaming included) and records the candidate's
 * circuit outcome exactly once; on a final failure it returns the upstream's
 * own error info so the caller can decide whether to fail over (provider
 * failure), pass through (client-side 4xx), or treat it as circuit pressure.
 */
async function attemptCandidate(args: {
  res: SseResponseLike;
  target: RouteTarget;
  anthropic: boolean;
  breaker: CircuitBreaker;
  circuit: CircuitDecision;
  requestPath: string;
  requestBody: Record<string, unknown> | OpenAiChatRequest;
  incomingHeaders: Record<string, string>;
  isStream: boolean;
  firstByteTimeout: number;
  maxAttempts: number;
  fetchImpl: typeof fetch;
  sleepFn: (ms: number) => Promise<void> | void;
  requestStart: number;
  shared: { rectified: boolean };
}): Promise<
  | { kind: "success" }
  | { kind: "provider_failure" | "neutral_failure"; error: UpstreamErrorInfo }
> {
  const {
    res, target, anthropic, breaker, circuit, requestPath, requestBody,
    incomingHeaders, isStream, firstByteTimeout, maxAttempts, fetchImpl,
    sleepFn, requestStart, shared
  } = args;

  // Circuit outcome classification (one record per client request per
  // candidate, via finish()):
  // - "success": delivered on any attempt (internal retries included)
  // - "provider_failure": the final failure is an upstream condition
  // - "neutral_failure": a client-side 4xx rejection or Gateway-side problem
  //   (must not pollute provider health)
  let circuitOutcome: "success" | "provider_failure" | "neutral_failure" | null = null;
  const finish = (result: "success" | "provider_failure" | "neutral_failure"): void => {
    if (circuitOutcome !== null) return; // defensive: record exactly once
    circuitOutcome = result;
    if (result === "success") {
      const was = breaker.getState();
      breaker.recordSuccess(circuit.usedHalfOpenPermit);
      if (was === "half_open" && breaker.getState() === "closed") {
        console.info("[claude-route] circuit breaker closed; provider recovered", {
          code: "ROUTE_CIRCUIT_RECOVERED",
          providerId: target.provider.id
        });
      }
    } else if (result === "provider_failure") {
      const was = breaker.getState();
      breaker.recordFailure(circuit.usedHalfOpenPermit);
      if (was !== "open" && breaker.getState() === "open") {
        console.warn("[claude-route] circuit breaker opened for provider", {
          code: "ROUTE_CIRCUIT_OPENED",
          providerId: target.provider.id,
          stats: breaker.getStats()
        });
      }
    } else {
      breaker.releaseNeutral(circuit.usedHalfOpenPermit);
    }
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
      const retryable = attempt + 1 < maxAttempts
        && Date.now() - requestStart < quickFailureRetryWindowMs;
      if (!retryable) {
        finish("provider_failure");
        return {
          kind: "provider_failure",
          error: {
            status: 502,
            text: `Upstream request failed: ${error instanceof Error ? redactSensitiveErrorMessage(error.message) : String(error)}`,
            parsed: null,
            retryAfter: null
          }
        };
      }
      const delay = backoffMs(attempt, null);
      console.warn("[claude-route] upstream connection failed, retrying", {
        code: "ROUTE_RETRY",
        status: null,
        attempt: attempt + 2,
        delayMs: delay,
        message: error instanceof Error ? redactSensitiveErrorMessage(error.message) : String(error)
      });
      await sleepFn(delay);
      continue;
    }

    if (upstream.ok) {
      const delivered = await deliverSuccess(res, upstream, anthropic, isStream, requestBody, firstByteTimeout, {
        attempt,
        maxAttempts,
        sleepFn,
        backoff: () => backoffMs(attempt, null)
      });
      if (delivered.kind === "retry") {
        // The 200 stalled before its first byte; try the upstream again.
        continue;
      }
      finish(delivered.kind);
      return delivered.kind === "success"
        ? { kind: "success" }
        : { kind: "provider_failure", error: delivered.error };
    }

    // Non-OK upstream: read a bounded error body for classification.
    const errorText = await readBoundedBody(upstream);
    const parsed = parseJsonObject(errorText);
    const errorMessage = upstreamErrorMessage(parsed, errorText);
    const retryAfter = upstream.headers.get("retry-after");

    // Rectifiers (Anthropic passthrough only): repair a relay-specific 400 in
    // place and resend immediately. Each client request gets at most one
    // repair (shared.rectified, shared across candidates) — if the
    // resubmission is rejected again, the (possibly new) error is classified
    // normally below. On the anthropic path the request body IS the original
    // `body` object, so the in-place repair is picked up by the next attempt's
    // JSON.stringify.
    const anthropicBody = anthropic ? (requestBody as Record<string, unknown>) : null;
    if (anthropicBody && upstream.status === 400 && !shared.rectified) {
      const signature = shouldRectifyThinkingSignature(errorMessage)
        ? rectifyAnthropicSignature(anthropicBody)
        : null;
      const budget = signature
        ? null
        : shouldRectifyThinkingBudget(errorMessage)
          ? rectifyAnthropicBudget(anthropicBody)
          : null;
      const applied = (signature?.applied ?? false) || (budget?.applied ?? false);
      if (applied) {
        shared.rectified = true;
        console.info("[claude-route] upstream 400 repaired, retrying once", {
          code: signature ? "ROUTE_THINKING_RECTIFIED" : "ROUTE_THINKING_BUDGET_RECTIFIED",
          ...(signature
            ? {
                removedThinkingBlocks: signature.removedThinkingBlocks,
                removedRedactedThinkingBlocks: signature.removedRedactedThinkingBlocks,
                removedSignatureFields: signature.removedSignatureFields,
                removedTopLevelThinking: signature.removedTopLevelThinking
              }
            : {
                budgetTokens: budget ? `${budget.budgetTokensBefore} -> ${budget.budgetTokensAfter}` : undefined,
                maxTokens: budget ? `${budget.maxTokensBefore} -> ${budget.maxTokensAfter}` : undefined
              }),
          message: errorMessage ? redactSensitiveErrorMessage(errorMessage).slice(0, 200) : undefined
        });
        continue;
      }
    }

    if (isRetryableStatus(upstream.status) && attempt + 1 < maxAttempts) {
      const delay = backoffMs(attempt, retryAfter);
      console.warn("[claude-route] retrying upstream request", {
        code: "ROUTE_RETRY",
        status: upstream.status,
        attempt: attempt + 2,
        delayMs: delay
      });
      await sleepFn(delay);
      continue;
    }

    // Final failure for this candidate. Classification decides what the
    // candidate walk does next:
    // - retryable status → provider_failure (the next candidate may serve)
    // - 400 AFTER rectification already ran → provider_failure: the body is
    //   sanitized, so this relay simply does not like the request shape —
    //   failover may find a relay that does
    // - any other non-retryable 4xx → neutral_failure: the request itself is
    //   the problem, and no other attempt against any provider would fix it,
    //   so the breaker must not learn from it either.
    const outcome = isRetryableStatus(upstream.status)
      ? "provider_failure"
      : upstream.status === 400 && shared.rectified
        ? "provider_failure"
        : "neutral_failure";
    console.warn("[claude-route] upstream error finalized for candidate", {
      code: "ROUTE_UPSTREAM_ERROR",
      status: upstream.status,
      attempt: attempt + 1,
      outcome,
      message: errorMessage ? redactSensitiveErrorMessage(errorMessage).slice(0, 200) : undefined
    });
    finish(outcome);
    return {
      kind: outcome,
      error: { status: upstream.status, text: errorText, parsed, retryAfter }
    };
  }

  // Unreachable: every loop iteration either delivers a response and returns
  // or continues, and the final attempt can never continue. The finish call
  // still releases any half-open probe slot if this point is ever reached.
  finish("neutral_failure");
  throw new ClaudeRouteError("CLAUDE_ROUTE_INTERNAL", 502, "Upstream attempt loop exited unexpectedly");
}

/**
 * Delivers a 200 upstream response: JSON bodies are converted/returned
 * inline; streaming bodies have their FIRST chunk read before the 200 is
 * committed (time-to-first-byte guard), and a stalled/empty first read is
 * retried within the attempt budget.
 *
 * Returns the circuit outcome when the response is final:
 * "success" (delivered) or "provider_failure" (the upstream 200 was
 * unusable — non-JSON body, stalled or empty stream); "retry" asks the
 * attempt loop to try the upstream again.
 */
async function deliverSuccess(
  res: SseResponseLike,
  upstream: Response,
  anthropic: boolean,
  isStream: boolean,
  requestBody: Record<string, unknown> | OpenAiChatRequest,
  firstByteTimeout: number,
  retry: {
    attempt: number;
    maxAttempts: number;
    sleepFn: (ms: number) => Promise<void> | void;
    backoff: () => number;
  }
): Promise<DeliverResult> {
  const isSse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream") || isStream;

  if (!isSse || !upstream.body) {
    const text = await upstream.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        kind: "provider_failure",
        error: { status: 502, text: "Upstream returned a non-JSON body", parsed: null, retryAfter: null }
      };
    }
    if (anthropic) {
      res.json(parsed);
    } else {
      res.json(openaiToAnthropicResponse(parsed, typeof requestBody.model === "string" ? requestBody.model : ""));
    }
    return { kind: "success" };
  }

  // Read the first upstream chunk BEFORE committing the 200. This is the
  // time-to-first-byte guard: an upstream that returns headers then stalls
  // (stuck inference, a dead proxy half-connection) is still answerable as a
  // clean 502 — or retryable while attempts remain — instead of leaving the
  // client hanging on an open SSE response.
  const reader = upstream.body.getReader();
  let first: ReadableStreamReadResult<Uint8Array>;
  try {
    first = await readWithTimeout(reader.read(), firstByteTimeout);
  } catch (error) {
    try { await reader.cancel(); } catch { /* best-effort release */ }
    if (retry.attempt + 1 < retry.maxAttempts) {
      const delay = retry.backoff();
      console.warn("[claude-route] upstream stalled before first byte, retrying", {
        code: "ROUTE_RETRY",
        status: null,
        firstByte: true,
        attempt: retry.attempt + 2,
        delayMs: delay
      });
      await retry.sleepFn(delay);
      return { kind: "retry" };
    }
    const detail = isFirstByteTimeout(error)
      ? `Upstream produced no data within ${Math.round(firstByteTimeout / 1000)}s`
      : `Upstream stream failed: ${error instanceof Error ? redactSensitiveErrorMessage(error.message) : String(error)}`;
    return { kind: "provider_failure", error: { status: 502, text: detail, parsed: null, retryAfter: null } };
  }
  if (first.done || first.value === undefined) {
    try { await reader.cancel(); } catch { /* best-effort release */ }
    if (retry.attempt + 1 < retry.maxAttempts) {
      const delay = retry.backoff();
      console.warn("[claude-route] upstream returned an empty stream, retrying", {
        code: "ROUTE_RETRY",
        status: null,
        emptyStream: true,
        attempt: retry.attempt + 2,
        delayMs: delay
      });
      await retry.sleepFn(delay);
      return { kind: "retry" };
    }
    return {
      kind: "provider_failure",
      error: { status: 502, text: "Upstream returned no streaming data", parsed: null, retryAfter: null }
    };
  }

  // Replay the already-read first chunk, then keep reading the SAME reader
  // live from the upstream. Reading stops once the upstream closes or signals
  // [DONE], so a connection that lingers after completion cannot pin the
  // downstream response (and its socket) open.
  const firstChunk = first.value;
  const upstreamSource: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      const decoder = new TextDecoder();
      yield firstChunk;
      try {
        if (decoder.decode(firstChunk).includes("data: [DONE]")) {
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
        requestedModel: typeof requestBody.model === "string" ? requestBody.model : ""
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
  return { kind: "success" };
}

export interface ForwardDeps {
  resolveHost?: OutboundHostResolver | undefined;
  /** Test seam for the upstream HTTP client. */
  fetchImpl?: typeof fetch | undefined;
  /** Test seam for the streaming time-to-first-byte deadline (ms). */
  streamFirstByteTimeoutMs?: number | undefined;
  /** Test seam for the upstream attempt budget (default 3). */
  maxAttempts?: number | undefined;
  /** Test seam for retry backoff sleeps. */
  sleepFn?: ((ms: number) => Promise<void> | void) | undefined;
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
    // Forward the client's beta negotiation as-is. Relays gate features on
    // specific anthropic-beta values (1M context, Claude-Code-only endpoints),
    // and Claude Code always sends the set it was built against.
    if (incoming["anthropic-beta"]) {
      headers["anthropic-beta"] = incoming["anthropic-beta"];
    }
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

// ---- Upstream error classification -----------------------------------------

/**
 * Status codes a different upstream attempt may clear. 429 (rate limit) and
 * the 5xx/529 family are relay-side conditions; 408 is a request timeout.
 * Everything else is a client/request problem that no retry of the same
 * request fixes.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504
    || status === 529;
}

/** Backoff for attempt N (0-based): 500ms, 1s, 2s, ... capped; Retry-After wins within the cap. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.ceil(seconds * 1000), retryAfterCapMs);
    }
  }
  return Math.min(retryBackoffBaseMs * 2 ** attempt, retryBackoffMaxMs);
}

interface UpstreamErrorInfo {
  status: number;
  text: string;
  parsed: Record<string, unknown> | null;
  retryAfter: string | null;
}

type DeliverResult =
  | { kind: "retry" }
  | { kind: "success" }
  | { kind: "provider_failure"; error: UpstreamErrorInfo };

/**
 * Passes a final upstream failure back to the client with the upstream's own
 * status code, Retry-After, and error body. A well-formed upstream error
 * object is forwarded verbatim (Claude Code then sees the relay's real
 * message, exactly as it would in direct mode); anything else is wrapped in
 * a minimal Anthropic error envelope with a redacted snippet.
 */
function writeUpstreamError(res: SseResponseLike, error: UpstreamErrorInfo): void {
  res.status(error.status);
  if (error.retryAfter !== null) res.setHeader("retry-after", error.retryAfter);
  if (isWellFormedUpstreamError(error.parsed)) {
    res.json(error.parsed as Record<string, unknown>);
    return;
  }
  const detail = error.text.trim()
    ? `Upstream HTTP ${error.status}: ${redactSensitiveErrorMessage(error.text.trim().slice(0, 500))}`
    : `Upstream HTTP ${error.status}`;
  res.json(anthropicError(error.status, "api_error", detail).body);
}

function isWellFormedUpstreamError(parsed: Record<string, unknown> | null): boolean {
  if (!parsed) return false;
  const error = parsed.error;
  if (typeof error === "string") return error.length > 0;
  if (error && typeof error === "object") {
    return typeof (error as Record<string, unknown>).message === "string";
  }
  return false;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort extraction of the human/provider error message from an upstream
 * body. Falls back to the raw (bounded) text, which keeps nested-JSON relay
 * encodings matchable by the rectifiers.
 */
function upstreamErrorMessage(parsed: Record<string, unknown> | null, text: string): string | undefined {
  if (parsed) {
    const error = parsed.error;
    if (typeof error === "string" && error.length > 0) return error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
    const message = parsed.message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Reads an error body up to the cap, cancelling the remainder. */
async function readBoundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= upstreamErrorBodyLimit) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    // The body vanished mid-read; return what was captured.
  }
  return text + decoder.decode();
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
      allowPlaintextHttp: target.provider.allowPlaintextHttp,
      allowPrivateNetworks: target.provider.allowPrivateNetworks
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

/**
 * Data-plane auth + candidate resolution: route token → enabled user →
 * ordered assignments → resolvable provider/credential targets, in priority
 * order. Throws the same ClaudeRouteError the legacy single-assignment flow
 * used when nothing can be routed at all.
 */
export function resolveRouteCandidates(
  db: Database,
  masterKey: string,
  presentedToken: string | undefined,
  requestedModel: string
): RouteCandidate[] {
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
  const assignments = routeRepo.listAssignments();
  if (assignments.length === 0) {
    throw new ClaudeRouteError("CLAUDE_ROUTE_NOT_ASSIGNED", 404, "No provider is routed to Claude Code yet");
  }
  const repository = new ModelProviderRepository(db, owner.userId, masterKey);
  const candidates: RouteCandidate[] = [];
  let firstError: ClaudeRouteError | null = null;
  for (const assignment of assignments) {
    const provider = repository.getProviderProfile(assignment.providerProfileId);
    if (!provider || provider.status !== "active") {
      firstError ??= new ClaudeRouteError("CLAUDE_ROUTE_PROVIDER_MISSING", 503, "The routed provider is unavailable");
      continue;
    }
    // A rotated credential must not strand the candidate: fall back to the
    // provider's oldest active credential.
    const credential = repository.getCredential(assignment.credentialId);
    const resolved = credential && credential.status === "active"
      ? credential
      : repository.getOldestActiveCredential(provider.id);
    if (!resolved) {
      firstError ??= new ClaudeRouteError("CLAUDE_ROUTE_CREDENTIAL_MISSING", 503, "The routed provider has no active credential");
      continue;
    }
    const baseUrl = endpointForAdapter(provider, "claude");
    if (!baseUrl) {
      firstError ??= new ClaudeRouteError("CLAUDE_ROUTE_NO_ENDPOINT", 503, "The routed provider has no endpoint");
      continue;
    }
    const models = repository.listModelProfiles(provider.id);
    candidates.push({
      userId: owner.userId,
      provider,
      credential: resolved,
      secret: repository.decryptCredential(resolved.id),
      baseUrl,
      hostsRequestedModel: requestedModel !== ""
        && models.some((model) => model.modelId === requestedModel && model.status === "active")
    });
  }
  if (candidates.length === 0) {
    throw firstError ?? new ClaudeRouteError("CLAUDE_ROUTE_PROVIDER_MISSING", 503, "The routed provider is unavailable");
  }
  // Only candidates that host the requested model are useful — calling the
  // rest would just 404 the model. When none host it (relay alias or a stale
  // model list) the full priority-ordered list is kept so the request goes
  // through as-is, exactly like the legacy single-assignment behavior.
  if (requestedModel !== "" && candidates.some((candidate) => candidate.hostsRequestedModel)) {
    return candidates.filter((candidate) => candidate.hostsRequestedModel);
  }
  return candidates;
}

/** Legacy single-target view: the primary candidate (count_tokens, /v1/models). */
export function resolveRouteTarget(
  db: Database,
  masterKey: string,
  presentedToken: string | undefined
): RouteTarget {
  const candidates = resolveRouteCandidates(db, masterKey, presentedToken, "");
  const primary = candidates[0];
  if (!primary) {
    throw new ClaudeRouteError("CLAUDE_ROUTE_NOT_ASSIGNED", 404, "No provider is routed to Claude Code yet");
  }
  return primary;
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
