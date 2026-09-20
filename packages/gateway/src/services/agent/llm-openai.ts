import { checkedTool, invalidResponse, isSse, MAX_TOOL_ARGUMENT_BYTES, MAX_TOOL_CALLS, optionalText, parseJson, publishCompletion, readJsonResponse, readSse, record, usage, validateCompletion, type LlmCompletion, type LlmEmit, type LlmResult, type LlmToolCall } from "./llm-response.js";

function toolFromJson(value: unknown): LlmToolCall {
  const tool = record(value);
  if (tool.type !== undefined && tool.type !== "function") invalidResponse("unsupported tool type");
  const fn = record(tool.function);
  return checkedTool({ id: optionalText(tool.id), name: optionalText(fn.name), arguments: optionalText(fn.arguments) });
}

function jsonCompletion(value: unknown): LlmCompletion {
  const data = record(value);
  if (data.error || !Array.isArray(data.choices) || data.choices.length !== 1) invalidResponse("missing or ambiguous choice");
  const choice = record(data.choices[0]);
  const message = record(choice.message);
  if (message.role !== undefined && message.role !== "assistant") invalidResponse("invalid message role");
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) invalidResponse("invalid tool batch");
  const completion: LlmCompletion = { message: optionalText(message.content), thinking: optionalText(message.reasoning_content),
    toolCalls: ((message.tool_calls ?? []) as unknown[]).map(toolFromJson),
    ...(choice.finish_reason === undefined ? {} : { finishReason: optionalText(choice.finish_reason) }),
    ...(data.usage ? { usage: usage(data.usage, "openai")! } : {}) };
  validateCompletion(completion, "openai", false);
  return completion;
}

function appendTools(value: unknown, tools: Map<number, LlmToolCall>): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) invalidResponse("invalid tool deltas");
  for (const item of value) {
    const delta = record(item);
    if (!Number.isSafeInteger(delta.index) || (delta.index as number) < 0 || (delta.index as number) >= MAX_TOOL_CALLS) invalidResponse("invalid tool index");
    const index = delta.index as number;
    const tool = tools.get(index) ?? { id: "", name: "", arguments: "" };
    if (delta.type !== undefined && delta.type !== "function") invalidResponse("unsupported tool type");
    if (delta.id !== undefined) {
      const id = optionalText(delta.id);
      if (tool.id && tool.id !== id) invalidResponse("conflicting tool identity");
      tool.id = id;
    }
    const fn = delta.function === undefined ? {} : record(delta.function);
    tool.name += optionalText(fn.name);
    tool.arguments += optionalText(fn.arguments);
    if (tool.id.length > 256 || tool.name.length > 256 || Buffer.byteLength(tool.arguments) > MAX_TOOL_ARGUMENT_BYTES) invalidResponse("tool delta too large");
    tools.set(index, tool);
  }
}

function applyChoice(value: unknown, completion: LlmCompletion, tools: Map<number, LlmToolCall>, emit: LlmEmit): void {
  const choice = record(value);
  if (choice.index !== undefined && choice.index !== 0) invalidResponse("unsupported choice index");
  if (completion.finishReason !== undefined) invalidResponse("choice after termination");
  const delta = record(choice.delta);
  if (delta.role !== undefined && delta.role !== "assistant") invalidResponse("invalid message role");
  const text = optionalText(delta.content);
  const thinking = optionalText(delta.reasoning_content);
  completion.message += text; completion.thinking += thinking;
  if (thinking) emit({ type: "thinking_delta", text: thinking });
  if (text) emit({ type: "text_delta", text });
  appendTools(delta.tool_calls, tools);
  if (choice.finish_reason !== null && choice.finish_reason !== undefined) completion.finishReason = optionalText(choice.finish_reason);
}

async function sseCompletion(response: Response, emit: LlmEmit, signal: AbortSignal, allowFinishReasonEof: boolean): Promise<LlmCompletion> {
  const completion: LlmCompletion = { message: "", thinking: "", toolCalls: [] };
  const tools = new Map<number, LlmToolCall>();
  let done = false;
  for await (const frame of readSse(response, signal)) {
    if (done) invalidResponse("data after terminal marker");
    if (frame.data === "[DONE]") { done = true; continue; }
    const data = record(parseJson(frame.data));
    if (data.error || frame.event === "error") invalidResponse("provider stream error");
    if (!Array.isArray(data.choices) || data.choices.length > 1) invalidResponse("missing or ambiguous choice");
    if (data.usage) completion.usage = usage(data.usage, "openai")!;
    if (data.choices.length === 0 && !data.usage) invalidResponse("empty stream chunk");
    if (data.choices.length) applyChoice(data.choices[0], completion, tools, emit);
  }
  // Some official MiniMax endpoints terminate clean HTTP bodies after the final
  // finish_reason frame. Never publish before EOF or accept an unsuccessful reason.
  if (!done && !allowFinishReasonEof) invalidResponse("missing terminal marker");
  completion.toolCalls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, tool]) => tool);
  validateCompletion(completion, "openai", true);
  return completion;
}

export async function readOpenAiCompletion(response: Response, emit: LlmEmit, signal: AbortSignal,
  options: { allowFinishReasonEof?: boolean } = {}): Promise<LlmResult> {
  const streaming = isSse(response);
  const completion = streaming ? await sseCompletion(response, emit, signal, options.allowFinishReasonEof === true) : jsonCompletion(await readJsonResponse(response, signal));
  return publishCompletion(completion, emit, signal, streaming);
}
