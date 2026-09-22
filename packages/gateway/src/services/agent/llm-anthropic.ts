import { checkedTool, invalidResponse, isSse, MAX_TOOL_ARGUMENT_BYTES, MAX_TOOL_CALLS, optionalText, parseJson, publishCompletion, readJsonResponse, readSse, record, usage, validateCompletion, type LlmCompletion, type LlmEmit, type LlmResult } from "./llm-response.js";

interface ContentBlock { type: string; text: string; tool?: { id: string; name: string; arguments: string }; initialInput?: Record<string, unknown>; closed: boolean }

function parseBlock(value: unknown): ContentBlock {
  const block = record(value);
  if (block.type === "text") return { type: "text", text: optionalText(block.text), closed: false };
  if (block.type === "thinking") return { type: "thinking", text: optionalText(block.thinking), closed: false };
  if (block.type === "redacted_thinking") return { type: "redacted_thinking", text: "", closed: false };
  if (block.type !== "tool_use") invalidResponse("unsupported content block");
  return { type: "tool_use", text: "", closed: false, initialInput: record(block.input),
    tool: { id: optionalText(block.id), name: optionalText(block.name), arguments: "" } };
}

function finishBlock(block: ContentBlock, completion: LlmCompletion): void {
  if (block.closed) invalidResponse("duplicate block termination");
  block.closed = true;
  if (block.tool) completion.toolCalls.push(checkedTool({ ...block.tool, arguments: block.tool.arguments || JSON.stringify(block.initialInput) }));
}

function addText(block: ContentBlock, completion: LlmCompletion, emit?: LlmEmit): void {
  if (block.type === "text") { completion.message += block.text; if (block.text) emit?.({ type: "text_delta", text: block.text }); }
  if (block.type === "thinking") { completion.thinking += block.text; if (block.text) emit?.({ type: "thinking_delta", text: block.text }); }
}

function jsonCompletion(value: unknown): LlmCompletion {
  const data = record(value);
  if (data.error || !Array.isArray(data.content)) invalidResponse("missing message content");
  if (data.role !== undefined && data.role !== "assistant") invalidResponse("invalid message role");
  const completion: LlmCompletion = { message: "", thinking: "", toolCalls: [],
    ...(data.stop_reason === undefined ? {} : { finishReason: optionalText(data.stop_reason) }),
    ...(data.usage ? { usage: usage(data.usage, "anthropic")! } : {}) };
  if (data.content.length > MAX_TOOL_CALLS * 2) invalidResponse("too many content blocks");
  for (const value of data.content) {
    const block = parseBlock(value);
    addText(block, completion); finishBlock(block, completion);
  }
  validateCompletion(completion, "anthropic", false);
  return completion;
}

function blockIndex(data: Record<string, unknown>): number {
  if (!Number.isSafeInteger(data.index) || (data.index as number) < 0 || (data.index as number) >= MAX_TOOL_CALLS * 2) invalidResponse("invalid block index");
  return data.index as number;
}

function applyBlockDelta(data: Record<string, unknown>, block: ContentBlock, completion: LlmCompletion, emit: LlmEmit): void {
  if (block.closed) invalidResponse("delta after block termination");
  const delta = record(data.delta);
  if (delta.type === "input_json_delta" && block.tool) {
    if (Object.keys(block.initialInput ?? {}).length) invalidResponse("ambiguous initial tool input");
    block.tool.arguments += optionalText(delta.partial_json);
    if (Buffer.byteLength(block.tool.arguments) > MAX_TOOL_ARGUMENT_BYTES) invalidResponse("tool arguments too large");
    return;
  }
  if (delta.type === "signature_delta" && block.type === "thinking") return;
  if (delta.type === "text_delta" && block.type === "text") { block.text = optionalText(delta.text); addText(block, completion, emit); return; }
  if (delta.type === "thinking_delta" && block.type === "thinking") { block.text = optionalText(delta.thinking); addText(block, completion, emit); return; }
  invalidResponse("incompatible content delta");
}

function applyBlock(data: Record<string, unknown>, blocks: Map<number, ContentBlock>, completion: LlmCompletion, emit: LlmEmit): void {
  const index = blockIndex(data);
  if (data.type === "content_block_start") {
    if (blocks.has(index)) invalidResponse("duplicate content block");
    const block = parseBlock(data.content_block);
    blocks.set(index, block); addText(block, completion, emit); return;
  }
  const block = blocks.get(index);
  if (!block) invalidResponse("unknown content block");
  if (data.type === "content_block_stop") { finishBlock(block, completion); return; }
  applyBlockDelta(data, block, completion, emit);
}

async function sseCompletion(response: Response, emit: LlmEmit, signal: AbortSignal): Promise<LlmCompletion> {
  const completion: LlmCompletion = { message: "", thinking: "", toolCalls: [] };
  const blocks = new Map<number, ContentBlock>();
  let started = false;
  let stopped = false;
  for await (const frame of readSse(response, signal)) {
    const data = record(parseJson(frame.data));
    if (data.type === "error" || frame.event === "error") invalidResponse("provider stream error");
    if (stopped) invalidResponse("data after terminal marker");
    if (data.type === "ping") continue;
    if (data.type === "message_start") {
      if (started) invalidResponse("duplicate message start");
      const message = record(data.message);
      if (message.role !== "assistant" || !Array.isArray(message.content) || message.content.length) invalidResponse("invalid stream message start");
      started = true;
      if (message.usage) completion.usage = usage(message.usage, "anthropic")!;
      continue;
    }
    if (!started) invalidResponse("missing message start");
    if (data.type === "message_stop") { stopped = true; continue; }
    if (data.type === "message_delta") {
      if ([...blocks.values()].some(b => !b.closed) || completion.finishReason !== undefined) invalidResponse("invalid message termination");
      completion.finishReason = optionalText(record(data.delta).stop_reason);
      if (data.usage) completion.usage = { ...completion.usage, ...usage(data.usage, "anthropic") };
      continue;
    }
    if (completion.finishReason !== undefined) invalidResponse("content after termination");
    if (!["content_block_start", "content_block_delta", "content_block_stop"].includes(String(data.type))) invalidResponse("unsupported stream event");
    applyBlock(data, blocks, completion, emit);
  }
  if (!stopped || [...blocks.values()].some(b => !b.closed)) invalidResponse("missing terminal marker");
  validateCompletion(completion, "anthropic", true);
  return completion;
}

export async function readAnthropicCompletion(response: Response, emit: LlmEmit, signal: AbortSignal): Promise<LlmResult> {
  const streaming = isSse(response);
  const completion = streaming ? await sseCompletion(response, emit, signal) : jsonCompletion(await readJsonResponse(response, signal));
  return publishCompletion(completion, emit, signal, streaming);
}
