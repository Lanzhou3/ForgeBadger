/**
 * OpenAI Chat Completions SSE stream → Anthropic Messages API SSE stream.
 *
 * Event sequence produced (cc-switch parity for the core shapes):
 *   message_start → content_block_start/delta/stop (text and/or tool_use)
 *   → message_delta (stop_reason + usage) → message_stop
 *
 * The final message_delta is deferred until the upstream `usage` chunk (sent
 * after the finish chunk when stream_options.include_usage is set) or the
 * stream ends, so usage is not lost. A source failure before any event was
 * emitted rethrows (caller can still answer with an HTTP error); a failure
 * mid-stream degrades to a graceful end_turn close of the open message.
 */

import { mapFinishReason } from "./transform-response.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

interface ToolBlockState {
  id: string;
  name: string;
  started: boolean;
  anthropicIndex: number;
  closed: boolean;
  pendingJson: string[];
}

interface StreamState {
  requestedModel: string;
  started: boolean;
  messageId: string;
  nextBlockIndex: number;
  textIndex: number;
  textOpen: boolean;
  toolBlocks: Map<number, ToolBlockState>;
  inputTokens: number | null;
  outputTokens: number | null;
  pendingFinish: "end_turn" | "tool_use" | "max_tokens" | null;
  finished: boolean;
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function openTextBlock(state: StreamState, out: string[]): void {
  state.textIndex = state.nextBlockIndex++;
  state.textOpen = true;
  out.push(sseEvent("content_block_start", {
    type: "content_block_start",
    index: state.textIndex,
    content_block: { type: "text", text: "" }
  }));
}

function closeTextBlock(state: StreamState, out: string[]): void {
  if (!state.textOpen) return;
  state.textOpen = false;
  out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: state.textIndex }));
}

function closeToolBlock(state: StreamState, block: ToolBlockState, out: string[]): void {
  if (block.closed) return;
  block.closed = true;
  out.push(sseEvent("content_block_stop", { type: "content_block_stop", index: block.anthropicIndex }));
}

function startToolBlock(state: StreamState, key: number, block: ToolBlockState, out: string[]): void {
  closeTextBlock(state, out);
  block.anthropicIndex = state.nextBlockIndex++;
  block.started = true;
  out.push(sseEvent("content_block_start", {
    type: "content_block_start",
    index: block.anthropicIndex,
    content_block: { type: "tool_use", id: block.id, name: block.name, input: {} }
  }));
  for (const fragment of block.pendingJson) {
    out.push(sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: block.anthropicIndex,
      delta: { type: "input_json_delta", partial_json: fragment }
    }));
  }
  block.pendingJson = [];
}

function flushFinal(state: StreamState, out: string[]): void {
  if (state.finished) return;
  state.finished = true;
  closeTextBlock(state, out);
  for (const block of state.toolBlocks.values()) closeToolBlock(state, block, out);
  const stopReason = state.pendingFinish ?? "end_turn";
  out.push(sseEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: {
      input_tokens: state.inputTokens ?? 0,
      output_tokens: state.outputTokens ?? 0
    }
  }));
  out.push(sseEvent("message_stop", { type: "message_stop" }));
}

function handleChunk(data: Record<string, unknown>, state: StreamState, out: string[]): void {
  if (!state.started) {
    state.started = true;
    state.messageId = typeof data.id === "string" && data.id.length > 0
      ? `msg_${data.id}`
      : `msg_${Date.now().toString(36)}_route`;
    out.push(sseEvent("message_start", {
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        model: state.requestedModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    }));
  }

  const usage = record(data.usage);
  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  if (Number.isFinite(promptTokens)) state.inputTokens = promptTokens;
  if (Number.isFinite(completionTokens)) state.outputTokens = completionTokens;

  for (const choiceRaw of Array.isArray(data.choices) ? data.choices : []) {
    const choice = record(choiceRaw);
    const delta = record(choice.delta);
    const finishReason = choice.finish_reason;

    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (!state.textOpen) openTextBlock(state, out);
      out.push(sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: state.textIndex,
        delta: { type: "text_delta", text: delta.content }
      }));
    }

    for (const callRaw of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const call = record(callRaw);
      const key = Number.isInteger(call.index) ? (call.index as number) : 0;
      let block = state.toolBlocks.get(key);
      if (!block) {
        block = { id: "", name: "", started: false, anthropicIndex: -1, closed: false, pendingJson: [] };
        state.toolBlocks.set(key, block);
      }
      if (typeof call.id === "string" && call.id) block.id = call.id;
      const fn = record(call.function);
      if (typeof fn.name === "string" && fn.name) block.name = fn.name;
      if (typeof fn.arguments === "string" && fn.arguments.length > 0) {
        if (block.started) {
          out.push(sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: block.anthropicIndex,
            delta: { type: "input_json_delta", partial_json: fn.arguments }
          }));
        } else {
          block.pendingJson.push(fn.arguments);
        }
      }
      // id and name may arrive in separate deltas; open once both exist
      if (!block.started && block.id && block.name) startToolBlock(state, key, block, out);
    }

    if (typeof finishReason === "string" && !state.pendingFinish) {
      state.pendingFinish = mapFinishReason(finishReason);
    }
  }

  // The usage chunk normally follows the finish chunk; emit the tail as soon
  // as we know the finish reason AND the usage, or when usage is present.
  if (state.pendingFinish !== null && (state.outputTokens !== null || data.usage !== undefined)) {
    flushFinal(state, out);
  }
}

export interface OpenaiSseToAnthropicOptions {
  requestedModel: string;
}

export async function* openaiSseToAnthropicSse(
  source: AsyncIterable<Uint8Array>,
  options: OpenaiSseToAnthropicOptions
): AsyncGenerator<string, void, unknown> {
  const state: StreamState = {
    requestedModel: options.requestedModel,
    started: false,
    messageId: "",
    nextBlockIndex: 0,
    textIndex: -1,
    textOpen: false,
    toolBlocks: new Map(),
    inputTokens: null,
    outputTokens: null,
    pendingFinish: null,
    finished: false
  };
  const decoder = new TextDecoder();
  let lineBuffer = "";

  try {
    for await (const chunk of source) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice("data:".length).trim();
        if (payload === "[DONE]") {
          if (state.pendingFinish !== null) flushFinal(state, []);
          continue;
        }
        let data: Record<string, unknown>;
        try {
          data = record(JSON.parse(payload));
        } catch {
          continue;
        }
        const out: string[] = [];
        handleChunk(data, state, out);
        for (const event of out) yield event;
      }
    }
    lineBuffer += decoder.decode();
    if (lineBuffer.trim().startsWith("data:")) {
      const payload = lineBuffer.trim().slice("data:".length).trim();
      if (payload !== "[DONE]") {
        try {
          const out: string[] = [];
          handleChunk(record(JSON.parse(payload)), state, out);
          for (const event of out) yield event;
        } catch { /* trailing garbage */ }
      }
    }
  } catch (error) {
    if (!state.started) throw error;
    // Mid-stream failure: close the open message so the client gets a
    // well-formed (partial) response instead of a dangling stream.
    console.warn("[claude-route] upstream stream failed mid-response; closing message gracefully", {
      code: "UPSTREAM_STREAM_INTERRUPTED",
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    if (!state.finished) {
      const out: string[] = [];
      flushFinal(state, out);
      for (const event of out) yield event;
    }
  }
}
