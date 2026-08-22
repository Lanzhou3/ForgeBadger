/**
 * Translates dsh `session.event` notifications into the existing Copilot
 * projections: `copilot_messages` row appends and `copilot_run_updated`
 * event-bus emissions. Pure and stateless apart from the per-run tool-call
 * id → name pairing table, so it is unit-testable without any process.
 *
 * The frontend contract (`copilot_run_updated` payload fields and the message
 * row shapes read by GET /conversations/:id/messages) is unchanged from the
 * in-process orchestrator path.
 */
import type { CopilotRunUpdatedEvent } from "../event-bus.js";

export interface TranslatorContext {
  userId: string;
  runId: string;
  conversationId: string;
  source: "user" | "reactive";
}

export interface AppendEffect {
  kind: "append";
  message: {
    role: "assistant" | "tool";
    kind: "text" | "tool_call" | "tool_result";
    content: string;
    toolName?: string;
    toolInputJson?: string;
    toolCallId?: string;
  };
}

export interface EmitEffect {
  kind: "emit";
  event: Omit<CopilotRunUpdatedEvent, "type" | "occurredAt">;
}

/** Terminal turn outcome: the BFF finalizes the run row from this. */
export interface RunEndEffect {
  kind: "runEnd";
  status: "completed" | "cancelled" | "failed";
  error?: string;
}

/** dsh assigned a conversation title (agent-spine fallback titler). */
export interface TitleEffect {
  kind: "title";
  title: string;
}

export type TranslatorEffect = AppendEffect | EmitEffect | RunEndEffect | TitleEffect;

/** The subset of the dsh SessionEvent union the translator reads. */
export interface DshSessionEvent {
  type: string;
  data?: Record<string, unknown>;
}

export function createEventTranslator(context: TranslatorContext) {
  const toolNames = new Map<string, string>();

  function emit(partial: Partial<Omit<CopilotRunUpdatedEvent, "type" | "occurredAt">>): EmitEffect {
    return {
      kind: "emit",
      event: {
        userId: context.userId,
        runId: context.runId,
        conversationId: context.conversationId,
        source: context.source,
        status: "running",
        ...partial
      }
    };
  }

  /** Translate one dsh session event into projection effects. */
  function translate(event: DshSessionEvent): TranslatorEffect[] {
    const data = event.data ?? {};
    switch (event.type) {
      case "assistant/chunk":
        return translateChunk(data.chunk as { type?: string; text?: string } | undefined);
      case "tool/call":
        return translateToolCall(data);
      case "tool/result":
        return translateToolResult(data);
      case "assistant/message":
        return translateAssistantMessage(data);
      case "turn/end":
        return [translateTurnEnd(data.reason as { kind?: string; error?: { message?: string } } | undefined)];
      case "session/title":
        return typeof data.title === "string" && data.title.trim() !== ""
          ? [{ kind: "title", title: data.title.trim() }]
          : [];
      default:
        return [];
    }
  }

  function translateChunk(chunk: { type?: string; text?: string } | undefined): TranslatorEffect[] {
    if (!chunk) return [];
    if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text !== "") {
      return [emit({ textDelta: chunk.text })];
    }
    if (chunk.type === "reasoning-delta" && typeof chunk.text === "string" && chunk.text !== "") {
      return [emit({ thinkingDelta: chunk.text })];
    }
    return [];
  }

  function translateToolCall(data: Record<string, unknown>): TranslatorEffect[] {
    const callId = String(data.callId ?? "");
    const name = String(data.name ?? "tool");
    const args = typeof data.arguments === "string" ? data.arguments : "{}";
    if (callId !== "") toolNames.set(callId, name);
    return [
      { kind: "append", message: { role: "assistant", kind: "tool_call", content: name, toolName: name, toolInputJson: args, ...(callId !== "" ? { toolCallId: callId } : {}) } },
      emit({ toolName: name, message: "running" })
    ];
  }

  function translateToolResult(data: Record<string, unknown>): TranslatorEffect[] {
    const message = data.message as { content?: Array<{ type?: string; toolCallId?: string; content?: Array<{ type?: string; text?: string }>; isError?: boolean }> } | undefined;
    const block = message?.content?.[0];
    const callId = String(block?.toolCallId ?? "");
    const text = (block?.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
    const isError = block?.isError === true || data.error !== undefined;
    const name = toolNames.get(callId) ?? "tool";
    return [
      { kind: "append", message: { role: "tool", kind: "tool_result", content: text, toolName: name, ...(callId !== "" ? { toolCallId: callId } : {}) } },
      emit({ toolName: name, message: isError ? "error" : "ok" })
    ];
  }

  function translateAssistantMessage(data: Record<string, unknown>): TranslatorEffect[] {
    const message = data.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
    const text = (message?.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    // Per-step assembled text is the durable projection; chunks were stream-only.
    if (text.trim() === "") return [];
    return [{ kind: "append", message: { role: "assistant", kind: "text", content: text } }];
  }

  function translateTurnEnd(reason: { kind?: string; error?: { message?: string } } | undefined): RunEndEffect {
    switch (reason?.kind) {
      case "aborted":
        return { kind: "runEnd", status: "cancelled" };
      case "error":
        return { kind: "runEnd", status: "failed", ...(reason.error?.message !== undefined ? { error: reason.error.message } : {}) };
      case "interrupted":
        return { kind: "runEnd", status: "failed", error: "dsh turn interrupted (runtime restarted)" };
      // completed / max-tokens / blocked all close a normal copilot turn.
      default:
        return { kind: "runEnd", status: "completed" };
    }
  }

  return { translate };
}
