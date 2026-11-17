import { checkedTool, invalidResponse, isSse, MAX_TOOL_ARGUMENT_BYTES, MAX_TOOL_CALLS, optionalText, parseJson, publishCompletion, readJsonResponse, readSse, record, usage, validateCompletion, type LlmCompletion, type LlmEmit, type LlmResult, type LlmToolCall } from "./llm-response.js";

function toolTypeIsUnsupported(type: unknown, fn: unknown): boolean {
  // Relay labels are descriptive: `null`, or a relabelled later fragment (`function_call`).
  // Only skip the label when this fragment carries the `function` payload we read;
  // a non-function payload is still rejected.
  if (type === undefined || type === null || type === "function") return false;
  return fn === undefined || fn === null;
}

function toolFromJson(value: unknown): LlmToolCall {
  const tool = record(value);
  if (toolTypeIsUnsupported(tool.type, tool.function)) invalidResponse("unsupported tool type");
  const fn = record(tool.function);
  return checkedTool({ id: optionalText(tool.id), name: optionalText(fn.name), arguments: optionalText(fn.arguments) });
}

type ReasoningDetailsMode = 'snapshot';

function applyReasoningReplay(completion: LlmCompletion, source: Record<string, unknown>, mode?: ReasoningDetailsMode): void {
  if (source.reasoning_content !== undefined && source.reasoning_content !== null) {
    completion.replay = { ...completion.replay, format: 'openai', reasoningContent: completion.thinking };
  }
  const details = source.reasoning_details;
  if (details === undefined || details === null) return;
  if (!Array.isArray(details) || details.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    invalidResponse('invalid reasoning details');
  }
  const incoming = details as Array<Record<string, unknown>>;
  const previous = completion.replay?.reasoningDetails;
  // Only explicit provider snapshot semantics permit replacing different arrays.
  // Generic endpoints may send one complete array, empty placeholders or repeats.
  if (mode !== 'snapshot' && previous?.length && incoming.length && JSON.stringify(previous) !== JSON.stringify(incoming)) {
    invalidResponse('unsupported reasoning details deltas');
  }
  const reasoningDetails = mode === 'snapshot' || incoming.length || !previous ? incoming : previous;
  completion.replay = { ...completion.replay, format: 'openai', reasoningDetails };
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
  applyReasoningReplay(completion, message);
  validateCompletion(completion, "openai", false);
  return completion;
}

interface ToolAssembly extends LlmToolCall { compatibleName: string }

function resolvedTool(tool: ToolAssembly, declaredNames: ReadonlySet<string>): LlmToolCall {
  const normalKnown = declaredNames.has(tool.name);
  const compatibleKnown = declaredNames.has(tool.compatibleName);
  if (tool.name !== tool.compatibleName && normalKnown && compatibleKnown) invalidResponse("ambiguous tool name deltas");
  return { id: tool.id, name: compatibleKnown && !normalKnown ? tool.compatibleName : tool.name, arguments: tool.arguments };
}

function appendTools(value: unknown, tools: Map<number, ToolAssembly>): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) invalidResponse("invalid tool deltas");
  for (const item of value) {
    const delta = record(item);
    if (!Number.isSafeInteger(delta.index) || (delta.index as number) < 0 || (delta.index as number) >= MAX_TOOL_CALLS) invalidResponse("invalid tool index");
    const index = delta.index as number;
    const tool = tools.get(index) ?? { id: "", name: "", arguments: "", compatibleName: "" };
    if (toolTypeIsUnsupported(delta.type, delta.function)) invalidResponse("unsupported tool type");
    if (delta.id !== undefined) {
      const id = optionalText(delta.id);
      if (tool.id && tool.id !== id) invalidResponse("conflicting tool identity");
      tool.id = id;
    }
    const fn = delta.function === undefined || delta.function === null ? {} : record(delta.function);
    const name = optionalText(fn.name);
    // Keep both interpretations until the complete name can be compared with
    // declared tools. Equal fragments alone cannot prove a provider name repeat.
    tool.name += name;
    if (name !== tool.compatibleName) tool.compatibleName += name;
    tool.arguments += optionalText(fn.arguments);
    if (tool.id.length > 256 || (tool.name.length > 256 && tool.compatibleName.length > 256) || Buffer.byteLength(tool.arguments) > MAX_TOOL_ARGUMENT_BYTES) invalidResponse("tool delta too large");
    tools.set(index, tool);
  }
}

/** True when a post-termination frame carries real content: non-empty text/reasoning deltas,
 * tool deltas, or a finish_reason different from the one already recorded. Empty deltas and
 * repeated finish_reasons are framing noise tolerated after termination. */
function choiceHasSubstance(choice: Record<string, unknown>, finishReason: string): boolean {
  const delta = choice.delta === undefined || choice.delta === null ? {} : record(choice.delta);
  if (deltaHasText(delta.content) || deltaHasText(delta.reasoning_content)) return true;
  if (deltaHasItems(delta.reasoning_details)) return true;
  if (deltaHasItems(delta.tool_calls)) return true;
  return choice.finish_reason !== null && choice.finish_reason !== undefined && choice.finish_reason !== finishReason;
}

/** Empty placeholder arrays (`tool_calls: []`, `reasoning_details: []`) are framing noise,
 * not content. A non-array value is still substance so the parser rejects it normally. */
function deltaHasItems(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return Array.isArray(value) ? value.length > 0 : true;
}

function deltaHasText(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  return value !== undefined && value !== null;
}

function applyChoice(value: unknown, completion: LlmCompletion, tools: Map<number, ToolAssembly>, emit: LlmEmit, reasoningDetailsMode?: ReasoningDetailsMode): void {
  const choice = record(value);
  if (choice.index !== undefined && choice.index !== 0) invalidResponse("unsupported choice index");
  // Some OpenAI-compatible proxies append trailing frames after the termination frame: an empty
  // delta with a repeated finish_reason, or a usage/statistics-only frame (those arrive with an
  // empty choices array and never reach here). Tolerate the empty ones; any real content after
  // termination is still an invalid response.
  if (completion.finishReason !== undefined) {
    if (!choiceHasSubstance(choice, completion.finishReason)) return;
    invalidResponse("choice after termination");
  }
  // Some relays send `delta: null` for empty keep-alive/termination chunks.
  const delta = choice.delta === undefined || choice.delta === null ? {} : record(choice.delta);
  if (delta.role !== undefined && delta.role !== "assistant") invalidResponse("invalid message role");
  const text = optionalText(delta.content);
  const thinking = optionalText(delta.reasoning_content);
  completion.message += text; completion.thinking += thinking;
  applyReasoningReplay(completion, delta, reasoningDetailsMode);
  if (thinking) emit({ type: "thinking_delta", text: thinking });
  if (text) emit({ type: "text_delta", text });
  appendTools(delta.tool_calls, tools);
  if (choice.finish_reason !== null && choice.finish_reason !== undefined) completion.finishReason = optionalText(choice.finish_reason);
}

async function sseCompletion(response: Response, emit: LlmEmit, signal: AbortSignal, allowFinishReasonEof: boolean, toolNames: readonly string[], reasoningDetailsMode?: ReasoningDetailsMode): Promise<LlmCompletion> {
  const completion: LlmCompletion = { message: "", thinking: "", toolCalls: [] };
  const tools = new Map<number, ToolAssembly>();
  const declaredNames = new Set(toolNames);
  let done = false;
  for await (const frame of readSse(response, signal)) {
    if (done) invalidResponse("data after terminal marker");
    if (frame.data === "[DONE]") { done = true; continue; }
    const data = record(parseJson(frame.data));
    if (data.error || frame.event === "error") invalidResponse("provider stream error");
    if (!Array.isArray(data.choices) || data.choices.length > 1) invalidResponse("missing or ambiguous choice");
    if (data.usage) completion.usage = usage(data.usage, "openai")!;
    if (data.choices.length === 0 && !data.usage) invalidResponse("empty stream chunk");
    if (data.choices.length) applyChoice(data.choices[0], completion, tools, emit, reasoningDetailsMode);
  }
  // Some official MiniMax endpoints terminate clean HTTP bodies after the final
  // finish_reason frame. Never publish before EOF or accept an unsuccessful reason.
  if (!done && !allowFinishReasonEof) invalidResponse("missing terminal marker");
  completion.toolCalls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, tool]) => resolvedTool(tool, declaredNames));
  validateCompletion(completion, "openai", true);
  return completion;
}

export async function readOpenAiCompletion(response: Response, emit: LlmEmit, signal: AbortSignal,
  options: { allowFinishReasonEof?: boolean; toolNames?: readonly string[]; reasoningDetailsMode?: ReasoningDetailsMode } = {}): Promise<LlmResult> {
  const streaming = isSse(response);
  const completion = streaming ? await sseCompletion(response, emit, signal, options.allowFinishReasonEof === true, options.toolNames ?? [], options.reasoningDetailsMode) : jsonCompletion(await readJsonResponse(response, signal));
  return publishCompletion(completion, emit, signal, streaming);
}
