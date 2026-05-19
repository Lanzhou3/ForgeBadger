import {
  FetchCopilotModelClient,
  fromProviderToolName,
  isEventStreamResponse,
  normalizeToolInputSchema,
  readSseJsonObjects,
  toProviderToolName,
  type CopilotFetch
} from "./model-client.js";
import { providerHttpFailure } from "./provider-http-failure.js";
import type { CopilotModelEvent, CopilotModelRequest, CopilotModelRequestOptions, CopilotToolDefinition } from "./types.js";

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

  async createResponse(request: CopilotModelRequest, options?: CopilotModelRequestOptions): Promise<CopilotModelEvent[]> {
    if (!this.baseUrl) return providerNotConfigured();
    const response = await this.fetchImpl(anthropicMessagesUrl(this.baseUrl), {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(anthropicRequestBody(request, Boolean(options?.onTextDelta))),
      ...(options?.signal ? { signal: options.signal } : {})
    });
    if (!response.ok) return httpFailure(response.status, await this.readJson(response));
    const onTextDelta = options?.onTextDelta;
    if (onTextDelta && isEventStreamResponse(response)) {
      return normalizeAnthropicStream(
        await readSseJsonObjects(response, (chunk) => emitAnthropicStreamDelta(chunk, onTextDelta)),
        () => {}
      );
    }
    return normalizeAnthropicResponse(await this.readJson(response));
  }
}

function anthropicRequestBody(request: CopilotModelRequest, stream = false): Record<string, unknown> {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 1024,
    system: request.instructions,
    messages: [{ role: "user", content: request.input }],
    ...(stream ? { stream: true } : {}),
    ...(request.tools ? {
      tools: request.tools.map(toAnthropicToolDefinition),
      tool_choice: { type: "auto", disable_parallel_tool_use: true }
    } : {})
  };
}

function normalizeAnthropicStream(chunks: unknown[], onTextDelta: (delta: string) => void): CopilotModelEvent[] {
  let text = "";
  const toolCalls = new Map<number, { id: string | undefined; name: string | undefined; inputJson: string }>();
  for (const chunk of chunks) {
    const type = readString(chunk, "type");
    if (type === "content_block_start") {
      const index = readNumber(chunk, "index") ?? toolCalls.size;
      const block = readObject(chunk, "content_block");
      if (readString(block, "type") === "tool_use") {
        const initialInput = readObject(block, "input");
        toolCalls.set(index, {
          id: readString(block, "id"),
          name: readString(block, "name"),
          inputJson: isNonEmptyObject(initialInput) ? JSON.stringify(initialInput) : ""
        });
      }
      continue;
    }
    if (type !== "content_block_delta") continue;
    const delta = readObject(chunk, "delta");
    if (readString(delta, "type") === "text_delta") {
      const deltaText = readOptionalString(delta, "text") ?? "";
      if (deltaText) {
        text += deltaText;
        onTextDelta(deltaText);
      }
      continue;
    }
    if (readString(delta, "type") === "input_json_delta") {
      const index = readNumber(chunk, "index") ?? toolCalls.size;
      const existing = toolCalls.get(index) ?? { id: undefined, name: undefined, inputJson: "" };
      toolCalls.set(index, {
        ...existing,
        inputJson: existing.inputJson + (readOptionalString(delta, "partial_json") ?? "")
      });
    }
  }
  const events: CopilotModelEvent[] = [
    ...(text.trim() ? [{ type: "assistant_message" as const, text: text.trim() }] : []),
    ...[...toolCalls.values()].map((call) => ({
      type: "tool_call_requested" as const,
      id: call.id ?? "tool-call",
      name: fromProviderToolName(call.name ?? "unknown"),
      input: parseJson(call.inputJson)
    }))
  ];
  return events.length > 0 ? events : [{ type: "run_failed", code: "copilot_empty_response", message: "Empty model response" }];
}

function emitAnthropicStreamDelta(chunk: unknown, onTextDelta: (delta: string) => void): void {
  if (readString(chunk, "type") !== "content_block_delta") return;
  const delta = readObject(chunk, "delta");
  if (readString(delta, "type") !== "text_delta") return;
  const deltaText = readOptionalString(delta, "text") ?? "";
  if (deltaText) onTextDelta(deltaText);
}

function toAnthropicToolDefinition(tool: CopilotToolDefinition): Record<string, unknown> {
  return {
    name: toProviderToolName(tool.name),
    ...(tool.description ? { description: tool.description } : {}),
    input_schema: normalizeToolInputSchema(tool.inputSchema)
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
    name: fromProviderToolName(readString(block, "name") ?? "unknown"),
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
  return providerHttpFailure(status, message);
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

function readOptionalString(value: unknown, key: string): string | undefined {
  const item = readObject(value, key);
  return typeof item === "string" ? item : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  const item = readObject(value, key);
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

function parseJson(value: string | undefined): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}
