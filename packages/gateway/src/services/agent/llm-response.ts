import { AgentError } from "./types.js";
import type { AgentLlmStreamEvent } from "./llm-client.js";

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;
export const MAX_TOOL_CALLS = 64;
export interface LlmToolCall { id: string; name: string; arguments: string }
export interface LlmUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number }
export interface LlmResult { message: string; finishReason?: string; usage?: LlmUsage }
export interface LlmCompletion extends LlmResult { toolCalls: LlmToolCall[]; thinking: string }
export type LlmEmit = (event: AgentLlmStreamEvent) => void;

export function invalidResponse(reason: string): never {
  // Only fixed diagnostic strings belong here; provider payloads may contain secrets.
  throw new AgentError("AGENT_LLM_INVALID_RESPONSE", `Invalid provider response: ${reason}`);
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidResponse("expected object");
  return value as Record<string, unknown>;
}

export function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return invalidResponse("malformed JSON"); }
}

export function optionalText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") invalidResponse("expected text");
  return value;
}

export function checkedTool(call: LlmToolCall): LlmToolCall {
  if (!call.id.trim() || call.id.length > 256 || !call.name.trim() || call.name.length > 256) invalidResponse("invalid tool identity");
  if (Buffer.byteLength(call.arguments) > MAX_TOOL_ARGUMENT_BYTES) invalidResponse("tool arguments too large");
  record(parseJson(call.arguments));
  return call;
}

export function validateCompletion(completion: LlmCompletion, format: "openai" | "anthropic", requireReason: boolean): void {
  const reason = completion.finishReason;
  const tools = completion.toolCalls;
  const successful = format === "openai" ? ["stop", "tool_calls"] : ["end_turn", "stop_sequence", "tool_use"];
  if ((requireReason && !reason) || (reason !== undefined && !successful.includes(reason))) invalidResponse("missing or unsuccessful termination");
  if (reason && ((reason === "tool_calls" || reason === "tool_use") !== (tools.length > 0))) invalidResponse("termination does not match tool batch");
  if (!completion.message.trim() && tools.length === 0) invalidResponse("empty assistant response");
  if (tools.length > MAX_TOOL_CALLS) invalidResponse("too many tool calls");
  const ids = new Set<string>();
  for (const tool of tools) {
    checkedTool(tool);
    if (ids.has(tool.id)) invalidResponse("duplicate tool id");
    ids.add(tool.id);
  }
}

export function publishCompletion(completion: LlmCompletion, emit: LlmEmit, signal: AbortSignal, alreadyStreamed = false): LlmResult {
  signal.throwIfAborted();
  if (!alreadyStreamed && completion.thinking) emit({ type: "thinking_delta", text: completion.thinking });
  if (!alreadyStreamed && completion.message) emit({ type: "text_delta", text: completion.message });
  signal.throwIfAborted();
  for (const toolCall of completion.toolCalls) emit({ type: "tool_call", toolCall });
  const result: LlmResult = { message: completion.message,
    ...(completion.finishReason === undefined ? {} : { finishReason: completion.finishReason }),
    ...(completion.usage ? { usage: completion.usage } : {}) };
  emit({ type: "done", ...result });
  return result;
}

export function usage(value: unknown, format: "openai" | "anthropic"): LlmUsage | undefined {
  if (value === undefined || value === null) return undefined;
  const data = record(value);
  const result: LlmUsage = {};
  for (const [source, target] of (format === "openai"
    ? [["prompt_tokens", "inputTokens"], ["completion_tokens", "outputTokens"], ["total_tokens", "totalTokens"]]
    : [["input_tokens", "inputTokens"], ["output_tokens", "outputTokens"]]) as Array<[string, keyof LlmUsage]>) {
    const count = data[source];
    if (count === undefined) continue;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) invalidResponse("invalid usage");
    result[target] = count;
  }
  return result;
}

/** Abort even injected transports/readers that do not honor AbortSignal themselves. */
export async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) void operation.catch(() => undefined);
  signal.throwIfAborted();
  let abort!: () => void;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason ?? new Error("Request aborted"));
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}

async function* responseChunks(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body) invalidResponse("missing response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let completed = false;
  try {
    while (true) {
      const chunk = await withAbort(reader.read(), signal);
      if (chunk.done) { completed = true; break; }
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) invalidResponse("response too large");
      yield decoder.decode(chunk.value, { stream: true });
    }
    yield decoder.decode();
  } catch (error) {
    if (signal.aborted || error instanceof AgentError) throw error;
    invalidResponse("interrupted or invalid UTF-8 response");
  } finally {
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readJsonResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  // Minimal historical fetch doubles expose .json only. Real bodies always use bounded reads.
  if (!response.body && typeof response.json === "function") {
    let value: unknown;
    try { value = await withAbort(response.json(), signal); }
    catch (error) { if (signal.aborted) throw error; invalidResponse("malformed JSON"); }
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES) invalidResponse("response too large or empty");
    return value;
  }
  let text = "";
  for await (const chunk of responseChunks(response, signal)) text += chunk;
  return parseJson(text);
}

export function isSse(response: Response): boolean {
  return response.headers?.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "text/event-stream";
}

export async function* readSse(response: Response, signal: AbortSignal): AsyncGenerator<{ event: string; data: string }> {
  let pending = "";
  let data: string[] = [];
  let event = "";
  for await (const chunk of responseChunks(response, signal)) {
    pending += chunk;
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/u, "");
      pending = pending.slice(end + 1);
      if (!line) {
        if (data.length) yield { event, data: data.join("\n") };
        data = []; event = "";
      } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /u, ""));
      else if (line.startsWith("event:")) event = line.slice(6).trim();
    }
  }
  if (data.length || pending.trim()) invalidResponse("incomplete SSE frame");
}
