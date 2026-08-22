import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createEventTranslator, type EmitEffect, type AppendEffect, type RunEndEffect } from "../src/services/dsh-copilot/event-translator.js";

const context = { userId: "u1", runId: "r1", conversationId: "c1", source: "user" as const };

function translateAll(events: Array<{ type: string; data?: Record<string, unknown> }>) {
  const translator = createEventTranslator(context);
  return events.flatMap((event) => translator.translate(event));
}

describe("dsh event translator", () => {
  it("maps text-delta chunks to textDelta run events", () => {
    const effects = translateAll([
      { type: "assistant/chunk", data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "你好" } } }
    ]);
    assert.equal(effects.length, 1);
    const emit = effects[0] as EmitEffect;
    assert.equal(emit.kind, "emit");
    assert.equal(emit.event.textDelta, "你好");
    assert.equal(emit.event.status, "running");
    assert.equal(emit.event.runId, "r1");
    assert.equal(emit.event.conversationId, "c1");
    assert.equal(emit.event.source, "user");
  });

  it("maps reasoning-delta chunks to thinkingDelta run events", () => {
    const effects = translateAll([
      { type: "assistant/chunk", data: { chunk: { type: "reasoning-delta", index: 0, text: "想一下" } } }
    ]);
    assert.equal((effects[0] as EmitEffect).event.thinkingDelta, "想一下");
  });

  it("ignores non-textual chunks (block-start, tool-call-delta, usage, finish)", () => {
    const effects = translateAll([
      { type: "assistant/chunk", data: { chunk: { type: "block-start", index: 0, blockType: "text" } } },
      { type: "assistant/chunk", data: { chunk: { type: "tool-call-delta", index: 1, id: "c1", argumentsDelta: "{}" } } },
      { type: "assistant/chunk", data: { chunk: { type: "text-delta", index: 0, text: "" } } },
      { type: "assistant/chunk", data: {} }
    ]);
    assert.equal(effects.length, 0);
  });

  it("appends a tool_call row and a running event on tool/call", () => {
    const effects = translateAll([
      { type: "tool/call", data: { turn: 1, step: 1, callId: "call-9", name: "list_sessions", arguments: "{\"a\":1}" } }
    ]);
    const append = effects[0] as AppendEffect;
    assert.equal(append.kind, "append");
    assert.deepEqual(append.message, {
      role: "assistant", kind: "tool_call", content: "list_sessions",
      toolName: "list_sessions", toolInputJson: "{\"a\":1}", toolCallId: "call-9"
    });
    const emit = effects[1] as EmitEffect;
    assert.equal(emit.event.toolName, "list_sessions");
    assert.equal(emit.event.message, "running");
  });

  it("pairs tool/result with the call name and maps isError to the event message", () => {
    const effects = translateAll([
      { type: "tool/call", data: { callId: "call-9", name: "list_sessions", arguments: "{}" } },
      { type: "tool/result", data: { message: { content: [{ type: "tool-result", toolCallId: "call-9", content: [{ type: "text", text: "boom" }], isError: true }] } } }
    ]);
    const append = effects[2] as AppendEffect;
    assert.equal(append.message.role, "tool");
    assert.equal(append.message.kind, "tool_result");
    assert.equal(append.message.content, "boom");
    assert.equal(append.message.toolName, "list_sessions");
    assert.equal(append.message.toolCallId, "call-9");
    const emit = effects[3] as EmitEffect;
    assert.equal(emit.event.message, "error");
    assert.equal(emit.event.toolName, "list_sessions");
  });

  it("appends assistant text from assistant/message and skips empty text", () => {
    const withText = translateAll([
      { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "reasoning", text: "r" }, { type: "text", text: "回答" }] } } }
    ]);
    assert.equal(withText.length, 1);
    assert.deepEqual((withText[0] as AppendEffect).message, { role: "assistant", kind: "text", content: "回答" });
    const withoutText = translateAll([
      { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "tool-call", id: "c", name: "n", arguments: "{}" }] } } }
    ]);
    assert.equal(withoutText.length, 0);
  });

  it("maps turn/end reasons to run outcomes", () => {
    const outcome = (reason: unknown) =>
      (translateAll([{ type: "turn/end", data: { turn: 1, reason: reason as Record<string, unknown> } }])[0] as RunEndEffect);
    assert.deepEqual(outcome({ kind: "completed" }), { kind: "runEnd", status: "completed" });
    assert.deepEqual(outcome({ kind: "max-tokens" }), { kind: "runEnd", status: "completed" });
    assert.deepEqual(outcome({ kind: "blocked" }), { kind: "runEnd", status: "completed" });
    assert.deepEqual(outcome({ kind: "aborted", reason: { kind: "user" } }), { kind: "runEnd", status: "cancelled" });
    assert.deepEqual(outcome({ kind: "error", error: { message: "boom" } }), { kind: "runEnd", status: "failed", error: "boom" });
    assert.equal(outcome({ kind: "interrupted" }).status, "failed");
    assert.equal(outcome(undefined).status, "completed");
  });

  it("emits a title effect for session/title and ignores unknown events", () => {
    const effects = translateAll([
      { type: "session/title", data: { title: "  标题  " } },
      { type: "step/start", data: { turn: 1, step: 1 } },
      { type: "request/header", data: {} },
      { type: "user/message", data: {} }
    ]);
    assert.deepEqual(effects, [{ kind: "title", title: "标题" }]);
  });
});
