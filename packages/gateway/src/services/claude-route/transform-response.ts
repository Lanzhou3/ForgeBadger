/**
 * OpenAI Chat Completions response → Anthropic Messages API response
 * (non-streaming). Streaming conversion lives in transform-stream.ts.
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function mapFinishReason(finishReason: unknown): "end_turn" | "tool_use" | "max_tokens" {
  if (finishReason === "tool_calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  return "end_turn";
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "object") return record(raw);
  if (typeof raw === "string") {
    try {
      return record(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return {};
}

export function openaiToAnthropicResponse(
  body: Record<string, unknown>,
  requestedModel: string
): Record<string, unknown> {
  const choice = Array.isArray(body.choices) ? record(body.choices[0]) : {};
  const message = record(choice.message);
  const usage = record(body.usage);

  const content: Array<Record<string, unknown>> = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item))
    : [];
  for (const [index, call] of toolCalls.entries()) {
    const fn = record(call.function);
    content.push({
      type: "tool_use",
      id: typeof call.id === "string" ? call.id : `toolu_${index}`,
      name: typeof fn.name === "string" ? fn.name : "",
      input: parseToolArguments(fn.arguments)
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  const cached = Number(record(usage.prompt_tokens_details).cached_tokens);

  return {
    id: typeof body.id === "string" ? `msg_${body.id}` : `msg_${Date.now().toString(36)}`,
    type: "message",
    role: "assistant",
    model: requestedModel,
    content,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
      output_tokens: Number.isFinite(completionTokens) ? completionTokens : 0,
      cache_read_input_tokens: Number.isFinite(cached) ? cached : 0,
      cache_creation_input_tokens: 0
    }
  };
}

/**
 * Local token estimate for /v1/messages/count_tokens when the upstream is
 * OpenAI-protocol (no count_tokens equivalent). ~4 chars/token heuristic.
 */
export function estimateInputTokens(requestBody: Record<string, unknown>): number {
  const serialized = JSON.stringify(requestBody);
  return Math.max(1, Math.ceil(serialized.length / 4));
}
