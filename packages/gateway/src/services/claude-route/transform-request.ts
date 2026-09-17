/**
 * Anthropic Messages API request → OpenAI Chat Completions request.
 *
 * Mirrors cc-switch's anthropic_to_openai semantics for the subset Claude Code
 * actually sends: system (string | text blocks), user/assistant messages with
 * text/image/tool_use/tool_result blocks, tools + tool_choice, sampling
 * params. Anthropic `thinking` is dropped (v1: no reasoning_effort mapping),
 * and model names pass through untouched — the apply step already wrote
 * provider model ids into the Claude Code env vars.
 */

export interface OpenAiChatRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  stream_options?: { include_usage: boolean };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item)) : [];
}

/** Claude Code prefixes the system prompt with a billing header line; drop it. */
function stripBillingHeader(text: string): string {
  return text.replace(/^(?:x-anthropic-billing-header:[^\n]*\n?)+/u, "").trimStart();
}

function toolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of recordArray(content)) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

interface UserExpansion {
  message?: Record<string, unknown>;
  toolMessages: Array<Record<string, unknown>>;
}

function expandUserMessage(content: unknown): UserExpansion {
  if (typeof content === "string") {
    return { message: { role: "user", content }, toolMessages: [] };
  }
  const parts: Array<Record<string, unknown>> = [];
  const toolMessages: Array<Record<string, unknown>> = [];
  for (const block of recordArray(content)) {
    switch (block.type) {
      case "text":
        if (typeof block.text === "string") parts.push({ type: "text", text: block.text });
        break;
      case "image": {
        const source = record(block.source);
        const url = source.type === "url" && typeof source.url === "string"
          ? source.url
          : source.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string"
            ? `data:${source.media_type};base64,${source.data}`
            : null;
        if (url) parts.push({ type: "image_url", image_url: { url } });
        break;
      }
      case "tool_result":
        if (typeof block.tool_use_id === "string") {
          toolMessages.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: toolResultContent(block.content)
          });
        }
        break;
      default:
        break;
    }
  }
  return {
    ...(parts.length > 0 ? { message: { role: "user", content: parts } } : {}),
    toolMessages
  };
}

function expandAssistantMessage(content: unknown): Record<string, unknown> {
  if (typeof content === "string") {
    return { role: "assistant", content };
  }
  let text = "";
  const toolCalls: Array<Record<string, unknown>> = [];
  for (const block of recordArray(content)) {
    if (block.type === "text" && typeof block.text === "string") {
      text += block.text;
    } else if (block.type === "tool_use") {
      const input = record(block.input);
      toolCalls.push({
        id: typeof block.id === "string" ? block.id : `toolu_${Math.random().toString(36).slice(2, 12)}`,
        type: "function",
        function: {
          name: typeof block.name === "string" ? block.name : "",
          arguments: JSON.stringify(Object.keys(input).length > 0 ? input : {})
        }
      });
    }
    // thinking blocks are intentionally dropped (v1)
  }
  const message: Record<string, unknown> = { role: "assistant" };
  if (text) message.content = text;
  else if (toolCalls.length === 0) message.content = "";
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return message;
}

function cleanToolSchema(schema: unknown): Record<string, unknown> {
  const cleaned = record(schema);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cleaned)) {
    if (key === "$schema") continue;
    out[key] = value;
  }
  return out;
}

function mapToolChoice(choice: unknown): unknown | undefined {
  if (choice === "auto" || choice === undefined) return "auto";
  if (choice === "any") return "required";
  if (choice === "none") return "none";
  const value = record(choice);
  if (value.type === "auto") return "auto";
  if (value.type === "any") return "required";
  if (value.type === "none") return "none";
  if (value.type === "tool" && typeof value.name === "string") {
    return { type: "function", function: { name: value.name } };
  }
  return undefined;
}

export function anthropicToOpenaiRequest(body: Record<string, unknown>): OpenAiChatRequest {
  const messages: Array<Record<string, unknown>> = [];

  const system = body.system;
  if (typeof system === "string") {
    const text = stripBillingHeader(system);
    if (text) messages.push({ role: "system", content: text });
  } else if (Array.isArray(system)) {
    const parts: string[] = [];
    for (const block of recordArray(system)) {
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
    const text = parts.map(stripBillingHeader).filter(Boolean).join("\n");
    if (text) messages.push({ role: "system", content: text });
  }

  for (const message of recordArray(body.messages)) {
    const role = typeof message.role === "string" ? message.role : "user";
    if (role === "user") {
      const expanded = expandUserMessage(message.content);
      if (expanded.message) messages.push(expanded.message);
      messages.push(...expanded.toolMessages);
    } else if (role === "assistant") {
      messages.push(expandAssistantMessage(message.content));
    }
    // system/developer roles inside messages are not part of the Anthropic
    // protocol; ignore any strays.
  }

  const request: OpenAiChatRequest = {
    model: typeof body.model === "string" ? body.model : "",
    messages,
    stream: body.stream === true
  };
  if (typeof body.max_tokens === "number") request.max_tokens = body.max_tokens;
  if (typeof body.temperature === "number") request.temperature = body.temperature;
  if (typeof body.top_p === "number") request.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences)) {
    request.stop = body.stop_sequences.filter((item): item is string => typeof item === "string");
  }

  const tools = recordArray(body.tools)
    .filter((tool) => tool.type !== "BatchTool" && typeof tool.name === "string")
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        parameters: cleanToolSchema(tool.input_schema)
      }
    }));
  if (tools.length > 0) request.tools = tools;

  const toolChoice = mapToolChoice(body.tool_choice);
  if (tools.length > 0 && toolChoice !== undefined) request.tool_choice = toolChoice;

  if (request.stream) request.stream_options = { include_usage: true };
  return request;
}
