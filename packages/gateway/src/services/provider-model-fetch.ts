import { lookup } from "node:dns/promises";

import { validatePublicHttpsEndpointUrl, type CheckModelEndpointInput } from "./model-endpoint-health.js";

export interface FetchedProviderModel {
  id: string;
  ownedBy: string | null;
}

export interface FetchProviderModelsInput {
  baseUrl: string;
  apiKey?: string | undefined;
  modelsUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  resolveHost?: CheckModelEndpointInput["resolveHost"] | undefined;
}

interface ModelsResponse {
  data?: Array<{
    id?: unknown;
    owned_by?: unknown;
    ownedBy?: unknown;
  }>;
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

export function buildProviderModelsUrlCandidates(baseUrl: string, modelsUrl?: string): string[] {
  const override = modelsUrl?.trim();
  if (override) return [override];

  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  if (!trimmed) throw new Error("Provider base URL is required");

  const candidates: string[] = [];
  candidates.push(trimmed.endsWith("/v1") ? `${trimmed}/models` : `${trimmed}/v1/models`);

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
    const validationError = await validatePublicHttpsEndpointUrl(endpoint, resolveHost);
    if (validationError) throw new Error(validationError);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers();
      const apiKey = input.apiKey?.trim();
      if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);

      const response = await fetchImpl(endpoint, {
        method: "GET",
        headers,
        redirect: "error",
        signal: controller.signal,
      });

      if (response.ok) {
        const payload = await response.json() as ModelsResponse;
        const models = (payload.data ?? [])
          .filter((model): model is { id: string; owned_by?: unknown; ownedBy?: unknown } => typeof model.id === "string" && model.id.length > 0)
          .map((model) => ({
            id: model.id,
            ownedBy: typeof model.owned_by === "string"
              ? model.owned_by
              : typeof model.ownedBy === "string"
                ? model.ownedBy
                : null,
          }))
          .sort((left, right) => left.id.localeCompare(right.id));
        return models;
      }

      const body = truncate(await response.text().catch(() => ""));
      lastError = `HTTP ${response.status}: ${body}`;
      if (response.status === 404 || response.status === 405) continue;
      throw new Error(lastError);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Request timed out");
      }
      if (error instanceof Error && error.message !== lastError) {
        throw error;
      }
      throw new Error(lastError);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`All model endpoint candidates failed: ${lastError}`);
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
