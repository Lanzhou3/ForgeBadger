import { lookup } from "node:dns/promises";

import { redactSensitiveErrorMessage } from "../lib/redaction.js";
import { isSensitiveHeaderName } from "../lib/sensitive-headers.js";
import { validatePublicHttpsEndpointUrl, type CheckModelEndpointInput } from "./model-endpoint-health.js";

export interface FetchedProviderModel {
  id: string;
  ownedBy: string | null;
}

export interface FetchProviderModelsInput {
  baseUrl: string;
  apiKey?: string | undefined;
  apiFormat?: string | undefined;
  defaultHeaders?: Record<string, string> | undefined;
  modelsUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  resolveHost?: CheckModelEndpointInput["resolveHost"] | undefined;
  allowPlaintextHttp?: boolean | undefined;
}

interface ModelsResponse {
  data?: Array<{
    id?: unknown;
    owned_by?: unknown;
    ownedBy?: unknown;
  }>;
  has_more?: unknown;
  last_id?: unknown;
}

const knownCompatSuffixes = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
] as const;

const defaultTimeoutMs = 15_000;
const errorBodyMaxChars = 512;
const anthropicPageLimit = 1000;
const anthropicMaxPages = 20;
const anthropicMaxModels = 5000;

export function buildProviderModelsUrlCandidates(baseUrl: string, modelsUrl?: string): string[] {
  const override = modelsUrl?.trim();
  if (override) return [override];

  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  if (!trimmed) throw new Error("Provider base URL is required");

  const candidates: string[] = [];
  // When the base URL already ends with a version segment (`/v1`, or a
  // generic `/v{N}` like Z.ai's `/api/paas/v4`), the models endpoint is
  // `{base}/models` — appending `/v1` again would 404. Non-`/v1` version
  // segments keep `{base}/v1/models` as a fallback second candidate.
  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!trimmed.endsWith("/v1")) {
      candidates.push(`${trimmed}/v1/models`);
    }
  } else {
    candidates.push(`${trimmed}/v1/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = stripped.replace(/\/+$/u, "");
    if (root) {
      candidates.push(`${root}/v1/models`);
      candidates.push(`${root}/models`);
    }
  }

  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

export async function fetchProviderModels(input: FetchProviderModelsInput): Promise<FetchedProviderModel[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const resolveHost = input.resolveHost ?? lookup;
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  const candidates = buildProviderModelsUrlCandidates(input.baseUrl, input.modelsUrl);
  let lastError = "No model endpoint candidates";

  for (const endpoint of candidates) {
    const validationError = await validatePublicHttpsEndpointUrl(endpoint, resolveHost, {
      allowPlaintextHttp: input.allowPlaintextHttp
    });
    if (validationError) throw new Error(validationError);

    try {
      return await fetchModelsFromEndpoint(endpoint, input, fetchImpl, timeoutMs);
    } catch (error) {
      if (error instanceof ModelEndpointNotFoundError) {
        lastError = error.message;
        continue;
      }
      throw error;
    }
  }

  throw new Error(`All model endpoint candidates failed: ${lastError}`);
}

class ModelEndpointNotFoundError extends Error {}

async function fetchModelsFromEndpoint(
  endpoint: string,
  input: FetchProviderModelsInput,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<FetchedProviderModel[]> {
  const headers = buildModelFetchHeaders(input.apiKey, input.apiFormat, input.defaultHeaders);
  const isAnthropic = input.apiFormat?.trim().toLowerCase() === "anthropic";
  const collected = new Map<string, FetchedProviderModel>();
  let afterId: string | undefined;

  for (let page = 0; page < (isAnthropic ? anthropicMaxPages : 1); page += 1) {
    const pageUrl = buildPageUrl(endpoint, isAnthropic, afterId);
    const payload = await fetchModelsPage(pageUrl, headers, fetchImpl, timeoutMs);
    for (const model of payload.data ?? []) {
      if (typeof model.id !== "string" || model.id.length === 0) continue;
      if (collected.has(model.id)) continue;
      collected.set(model.id, {
        id: model.id,
        ownedBy: typeof model.owned_by === "string"
          ? model.owned_by
          : typeof model.ownedBy === "string"
            ? model.ownedBy
            : null,
      });
    }
    if (!isAnthropic) break;
    if (collected.size >= anthropicMaxModels) break;
    const hasMore = payload.has_more === true;
    const lastId = typeof payload.last_id === "string" && payload.last_id.length > 0 ? payload.last_id : undefined;
    if (!hasMore || !lastId) break;
    afterId = lastId;
  }

  return [...collected.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function buildModelFetchHeaders(
  apiKeyInput: string | undefined,
  apiFormat: string | undefined,
  defaultHeaders: Record<string, string> | undefined
): Headers {
  const headers = new Headers();
  // Default headers are catalog-managed and already screened for credentials
  // at import time; skip sensitive-looking names again defensively here.
  for (const [name, value] of Object.entries(defaultHeaders ?? {})) {
    if (isSensitiveHeaderName(name)) continue;
    headers.set(name, value);
  }

  // Authentication is written last so provider credentials always win over
  // any default header that slipped through.
  const apiKey = apiKeyInput?.trim();
  if (apiKey) {
    const format = apiFormat?.trim().toLowerCase();
    if (format === "anthropic") {
      headers.set("x-api-key", apiKey);
      headers.set("anthropic-version", "2023-06-01");
      headers.delete("authorization");
    } else if (format === "google") {
      headers.set("x-goog-api-key", apiKey);
      headers.delete("authorization");
    } else {
      headers.set("Authorization", `Bearer ${apiKey}`);
    }
  }
  return headers;
}

function buildPageUrl(endpoint: string, isAnthropic: boolean, afterId: string | undefined): string {
  if (!isAnthropic) return endpoint;
  const url = new URL(endpoint);
  url.searchParams.set("limit", String(anthropicPageLimit));
  if (afterId) url.searchParams.set("after_id", afterId);
  return url.toString();
}

async function fetchModelsPage(
  url: string,
  headers: Headers,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<ModelsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });

    if (response.ok) {
      return await response.json() as ModelsResponse;
    }

    const body = redactSensitiveErrorMessage(truncate(await response.text().catch(() => "")));
    const message = `HTTP ${response.status}: ${body}`;
    if (response.status === 404 || response.status === 405) {
      throw new ModelEndpointNotFoundError(message);
    }
    throw new Error(message);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    if (error instanceof ModelEndpointNotFoundError) throw error;
    if (error instanceof Error && error.message.startsWith("HTTP ")) throw error;
    const raw = error instanceof Error ? error.message : String(error);
    throw new Error(redactSensitiveErrorMessage(raw));
  } finally {
    clearTimeout(timeout);
  }
}

function endsWithVersionSegment(url: string): boolean {
  return /\/v\d+$/u.test(url);
}

function stripCompatSuffix(baseUrl: string): string | undefined {
  for (const suffix of knownCompatSuffixes) {
    if (baseUrl.endsWith(suffix)) {
      return baseUrl.slice(0, baseUrl.length - suffix.length);
    }
  }
  return undefined;
}

function truncate(value: string): string {
  return value.length > errorBodyMaxChars ? `${value.slice(0, errorBodyMaxChars)}...` : value;
}
