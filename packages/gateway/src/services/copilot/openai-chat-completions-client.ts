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

export interface OpenAiChatCompletionsClientOptions {
  baseUrl: string | null;
  apiKey: string;
  fetch?: CopilotFetch;
}

export class OpenAiChatCompletionsClient extends FetchCopilotModelClient {
  private readonly baseUrl: string | null;
  private readonly apiKey: string;

  constructor(options: OpenAiChatCompletionsClientOptions) {
    super(options.fetch);
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
  }

  async createResponse(request: CopilotModelRequest, options?: CopilotModelRequestOptions): Promise<CopilotModelEvent[]> {
    if (!this.baseUrl) return providerNotConfigured();
    const response = await this.fetchImpl(openAiChatCompletionsUrl(this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(openAiChatRequestBody(request, Boolean(options?.onTextDelta))),
      ...(options?.signal ? { signal: options.signal } : {})
    });
    if (!response.ok) return httpFailure(response.status, await this.readJson(response));
    const onTextDelta = options?.onTextDelta;
    if (onTextDelta && isEventStreamResponse(response)) {
      return normalizeOpenAiChatStream(
        await readSseJsonObjects(response, (chunk) => emitOpenAiChatStreamDelta(chunk, onTextDelta)),
        () => {}
      );
    }
    return normalizeOpenAiChatResponse(await this.readJson(response));
  }
}

function openAiChatRequestBody(request: CopilotModelRequest, stream = false): Record<string, unknown> {
  return {
    model: request.model,
    messages: [
      { role: "system", content: request.instructions },
      { role: "user", content: request.input }
    ],
    max_tokens: request.maxOutputTokens ?? 1024,
    ...(stream ? { stream: true } : {}),
    ...(request.tools ? {
      tools: request.tools.map(toOpenAiChatToolDefinition),
      parallel_tool_calls: false
    } : {})
  };
}

function normalizeOpenAiChatStream(chunks: unknown[], onTextDelta: (delta: string) => void): CopilotModelEvent[] {
  let text = "";
  const toolCalls = new Map<number, { id: string | undefined; name: string | undefined; arguments: string }>();
  for (const chunk of chunks) {
    for (const choice of readArray(chunk, "choices")) {
      const delta = readObject(choice, "delta");
      const content = readOptionalString(delta, "content");
      if (content) {
        text += content;
        onTextDelta(content);
      }
      for (const call of readArray(delta, "tool_calls")) {
        const index = readNumber(call, "index") ?? toolCalls.size;
        const existing = toolCalls.get(index) ?? { id: undefined, name: undefined, arguments: "" };
        const fn = readObject(call, "function");
        toolCalls.set(index, {
          id: readString(call, "id") ?? existing.id,
          name: readString(fn, "name") ?? existing.name,
          arguments: existing.arguments + (readOptionalString(fn, "arguments") ?? "")
        });
      }
    }
  }
  const events: CopilotModelEvent[] = [
    ...(text.trim() ? [{ type: "assistant_message" as const, text: text.trim() }] : []),
    ...[...toolCalls.values()].map((call) => ({
      type: "tool_call_requested" as const,
      id: call.id ?? "tool-call",
      name: fromProviderToolName(call.name ?? "unknown"),
      input: parseJson(call.arguments)
    }))
  ];
  return events.length > 0 ? events : [{ type: "run_failed", code: "copilot_empty_response", message: "Empty model response" }];
}

function emitOpenAiChatStreamDelta(chunk: unknown, onTextDelta: (delta: string) => void): void {
  for (const choice of readArray(chunk, "choices")) {
    const delta = readObject(choice, "delta");
    const content = readOptionalString(delta, "content");
    if (content) onTextDelta(content);
  }
}

function toOpenAiChatToolDefinition(tool: CopilotToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: toProviderToolName(tool.name),
      ...(tool.description ? { description: tool.description } : {}),
      parameters: normalizeToolInputSchema(tool.inputSchema)
    }
  };
}

function normalizeOpenAiChatResponse(body: unknown): CopilotModelEvent[] {
  const choices = readArray(body, "choices");
  const events = choices.flatMap((choice) => normalizeChoice(choice));
  return events.length > 0 ? events : [{ type: "run_failed", code: "copilot_empty_response", message: "Empty model response" }];
}

function normalizeChoice(choice: unknown): CopilotModelEvent[] {
  const message = readObject(choice, "message");
  const text = readString(message, "content")?.trim();
  const toolCalls = readArray(message, "tool_calls").map(toToolCall);
  return [
    ...(text ? [{ type: "assistant_message" as const, text }] : []),
    ...toolCalls
  ];
}

function toToolCall(call: unknown): CopilotModelEvent {
  const fn = readObject(call, "function");
  return {
    type: "tool_call_requested",
    id: readString(call, "id") ?? "tool-call",
    name: fromProviderToolName(readString(fn, "name") ?? "unknown"),
    input: parseJson(readString(fn, "arguments"))
  };
}

function openAiChatCompletionsUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/chat/completions")) return baseUrl;
  return `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
}

function normalizeBaseUrl(baseUrl: string | null): string | null {
  const trimmed = baseUrl?.trim().replace(/\/+$/u, "");
  return trimmed || null;
}

function providerNotConfigured(): CopilotModelEvent[] {
  return [{ type: "run_failed", code: "copilot_provider_not_configured", message: "Provider base URL is not configured" }];
}

function httpFailure(status: number, body: unknown): CopilotModelEvent[] {
  const message = readString(body, "error") ?? readString(readObject(body, "error"), "message") ?? `Provider request failed with HTTP ${status}`;
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
