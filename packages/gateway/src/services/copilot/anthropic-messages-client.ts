import { FetchCopilotModelClient, type CopilotFetch } from "./model-client.js";
import type { CopilotModelEvent, CopilotModelRequest } from "./types.js";

export interface AnthropicMessagesClientOptions {
  baseUrl: string | null;
  apiKey: string;
  fetch?: CopilotFetch;
}

export class AnthropicMessagesClient extends FetchCopilotModelClient {
  private readonly baseUrl: string | null;
  private readonly apiKey: string;

  constructor(options: AnthropicMessagesClientOptions) {
    super(options.fetch);
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
  }

  async createResponse(request: CopilotModelRequest): Promise<CopilotModelEvent[]> {
    if (!this.baseUrl) return providerNotConfigured();
    const response = await this.fetchImpl(anthropicMessagesUrl(this.baseUrl), {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(anthropicRequestBody(request))
    });
    const body = await this.readJson(response);
    if (!response.ok) return httpFailure(response.status, body);
    return normalizeAnthropicResponse(body);
  }
}

function anthropicRequestBody(request: CopilotModelRequest): Record<string, unknown> {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 1024,
    system: request.instructions,
    messages: [{ role: "user", content: request.input }],
    ...(request.tools ? { tools: request.tools } : {})
  };
}

function normalizeAnthropicResponse(body: unknown): CopilotModelEvent[] {
  const content = readArray(body, "content");
  const text = content
    .filter((block) => readString(block, "type") === "text")
    .map((block) => readString(block, "text"))
    .filter((item): item is string => Boolean(item))
    .join("\n")
    .trim();
  const toolCalls = content
    .filter((block) => readString(block, "type") === "tool_use")
    .map(toToolCall);
  const events = [
    ...(text ? [{ type: "assistant_message" as const, text }] : []),
    ...toolCalls
  ];
  return events.length > 0 ? events : [{ type: "run_failed", code: "copilot_empty_response", message: "Empty model response" }];
}

function toToolCall(block: unknown): CopilotModelEvent {
  return {
    type: "tool_call_requested",
    id: readString(block, "id") ?? "tool-call",
    name: readString(block, "name") ?? "unknown",
    input: readObject(block, "input") ?? {}
  };
}

function anthropicMessagesUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/v1/messages")) return baseUrl;
  if (baseUrl.endsWith("/v1")) return `${baseUrl}/messages`;
  return `${baseUrl}/v1/messages`;
}

function normalizeBaseUrl(baseUrl: string | null): string | null {
  const trimmed = baseUrl?.trim().replace(/\/+$/u, "");
  return trimmed || null;
}

function providerNotConfigured(): CopilotModelEvent[] {
  return [{ type: "run_failed", code: "copilot_provider_not_configured", message: "Provider base URL is not configured" }];
}

function httpFailure(status: number, body: unknown): CopilotModelEvent[] {
  const error = readObject(body, "error");
  const message = readString(error, "message") ?? `Provider request failed with HTTP ${status}`;
  return [{ type: "run_failed", code: "copilot_provider_request_failed", message }];
}

function readArray(value: unknown, key: string): unknown[] {
  const item = readObject(value, key);
  return Array.isArray(item) ? item : [];
}

function readObject(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function readString(value: unknown, key: string): string | undefined {
  const item = readObject(value, key);
  return typeof item === "string" && item.trim() ? item : undefined;
}
