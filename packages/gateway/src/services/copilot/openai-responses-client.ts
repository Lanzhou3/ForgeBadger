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

export interface OpenAiResponsesClientOptions {
  baseUrl: string | null;
  apiKey: string;
  fetch?: CopilotFetch;
}

export class OpenAiResponsesClient extends FetchCopilotModelClient {
  private readonly baseUrl: string | null;
  private readonly apiKey: string;

  constructor(options: OpenAiResponsesClientOptions) {
    super(options.fetch);
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
  }

  async createResponse(request: CopilotModelRequest, options?: CopilotModelRequestOptions): Promise<CopilotModelEvent[]> {
    if (!this.baseUrl) return providerNotConfigured();
    const response = await this.fetchImpl(openAiResponsesUrl(this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(openAiRequestBody(request, Boolean(options?.onTextDelta))),
      ...(options?.signal ? { signal: options.signal } : {})
    });
    if (!response.ok) return httpFailure(response.status, await this.readJson(response));
    const onTextDelta = options?.onTextDelta;
    if (onTextDelta && isEventStreamResponse(response)) {
      return normalizeOpenAiStream(
        await readSseJsonObjects(response, (chunk) => emitOpenAiStreamDelta(chunk, onTextDelta)),
        () => {}
      );
    }
    return normalizeOpenAiResponse(await this.readJson(response));
  }
}

function openAiRequestBody(request: CopilotModelRequest, stream = false): Record<string, unknown> {
  return {
    model: request.model,
    instructions: request.instructions,
    input: request.input,
    max_output_tokens: request.maxOutputTokens ?? 1024,
    ...(stream ? { stream: true } : {}),
    ...(request.tools ? {
      tools: request.tools.map(toOpenAiToolDefinition),
      parallel_tool_calls: false
    } : {})
  };
}

function normalizeOpenAiStream(chunks: unknown[], onTextDelta: (delta: string) => void): CopilotModelEvent[] {
  let text = "";
  const toolCalls: CopilotModelEvent[] = [];
  for (const chunk of chunks) {
    const type = readString(chunk, "type");
    if (type === "response.output_text.delta") {
      const delta = readOptionalString(chunk, "delta") ?? "";
      if (delta) {
        text += delta;
        onTextDelta(delta);
      }
      continue;
    }
    if (type !== "response.output_item.done") continue;
    const item = readObject(chunk, "item");
    if (readString(item, "type") === "function_call") {
      toolCalls.push({
        type: "tool_call_requested",
        id: readString(item, "call_id") ?? readString(item, "id") ?? "tool-call",
        name: fromProviderToolName(readString(item, "name") ?? "unknown"),
        input: parseJson(readOptionalString(item, "arguments"))
      });
    }
  }
  const events: CopilotModelEvent[] = [
    ...(text.trim() ? [{ type: "assistant_message" as const, text: text.trim() }] : []),
    ...toolCalls
  ];
  return events.length > 0 ? events : [{ type: "run_failed", code: "copilot_empty_response", message: "Empty model response" }];
}

function emitOpenAiStreamDelta(chunk: unknown, onTextDelta: (delta: string) => void): void {
  if (readString(chunk, "type") !== "response.output_text.delta") return;
  const delta = readOptionalString(chunk, "delta") ?? "";
  if (delta) onTextDelta(delta);
}

function toOpenAiToolDefinition(tool: CopilotToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: toProviderToolName(tool.name),
    ...(tool.description ? { description: tool.description } : {}),
    parameters: normalizeToolInputSchema(tool.inputSchema),
    strict: false
  };
}

function normalizeOpenAiResponse(body: unknown): CopilotModelEvent[] {
  const directText = readString(body, "output_text");
  const outputEvents = normalizeOutputItems(readArray(body, "output"));
  const outputTextEvents = outputEvents.filter(
    (event): event is Extract<CopilotModelEvent, { type: "assistant_message" }> =>
      event.type === "assistant_message"
  );
  const nonTextEvents = outputEvents.filter((event) => event.type !== "assistant_message");
  const text = directText ?? outputTextEvents.map((event) => event.text).join("\n").trim();
  const events = [
    ...(text ? [{ type: "assistant_message" as const, text }] : []),
    ...nonTextEvents
  ];
  return events.length > 0 ? events : [{ type: "run_failed", code: "copilot_empty_response", message: "Empty model response" }];
}

function normalizeOutputItems(output: unknown[]): CopilotModelEvent[] {
  const text = output.flatMap((item) => readOpenAiTextBlocks(item)).join("\n").trim();
  const toolCalls = output.flatMap((item) => readOpenAiToolCall(item));
  return [
    ...(text ? [{ type: "assistant_message" as const, text }] : []),
    ...toolCalls
  ];
}

function readOpenAiTextBlocks(item: unknown): string[] {
  const content = readArray(item, "content");
  return content
    .filter((block) => readString(block, "type") === "output_text")
    .map((block) => readString(block, "text"))
    .filter((text): text is string => Boolean(text));
}

function readOpenAiToolCall(item: unknown): CopilotModelEvent[] {
  if (readString(item, "type") !== "function_call") return [];
  const id = readString(item, "call_id") ?? readString(item, "id") ?? "tool-call";
  const name = fromProviderToolName(readString(item, "name") ?? "unknown");
  return [{ type: "tool_call_requested", id, name, input: parseJson(readString(item, "arguments")) }];
}

function openAiResponsesUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/responses")) return baseUrl;
  return `${baseUrl.replace(/\/+$/u, "")}/responses`;
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

function parseJson(value: string | undefined): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
