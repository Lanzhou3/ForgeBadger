import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  rectifyAnthropicBudget,
  rectifyAnthropicSignature,
  shouldRectifyThinkingBudget,
  shouldRectifyThinkingSignature
} from "../src/services/claude-route/rectify-anthropic.js";

describe("shouldRectifyThinkingSignature", () => {
  it("matches the canonical invalid-signature rejection", () => {
    assert.equal(
      shouldRectifyThinkingSignature("messages.1.content.0: Invalid `signature` in `thinking` block"),
      true
    );
    assert.equal(
      shouldRectifyThinkingSignature("Messages.1.Content.0: invalid signature in thinking block"),
      true
    );
  });

  it("matches thought-signature rejections from Gemini-backed relays", () => {
    assert.equal(
      shouldRectifyThinkingSignature("Unable to submit request because Thought signature is not valid."),
      true
    );
  });

  it("matches thinking-block ordering rejections", () => {
    assert.equal(
      shouldRectifyThinkingSignature("a final `assistant` message must start with a thinking block"),
      true
    );
    assert.equal(
      shouldRectifyThinkingSignature(
        "messages.69.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`."
      ),
      true
    );
    // Over-broad variants without tool_use must NOT match.
    assert.equal(
      shouldRectifyThinkingSignature("messages.69.content.0.type: Expected `thinking`, but found `text`."),
      false
    );
  });

  it("matches signature field-presence rejections", () => {
    assert.equal(shouldRectifyThinkingSignature("messages.1.content.0.signature: Field required"), true);
    assert.equal(
      shouldRectifyThinkingSignature("messages.1.content.0.signature: Extra inputs are not permitted"),
      true
    );
  });

  it("matches tamper rejections", () => {
    assert.equal(
      shouldRectifyThinkingSignature("thinking or redacted_thinking blocks in the response cannot be modified"),
      true
    );
  });

  it("matches generic invalid-request wrappers (incl. nested JSON and zh)", () => {
    assert.equal(
      shouldRectifyThinkingSignature(
        JSON.stringify({
          error: {
            message: JSON.stringify({
              type: "error",
              error: { type: "invalid_request_error", message: "Invalid `signature` in `thinking` block" }
            })
          }
        })
      ),
      true
    );
    assert.equal(shouldRectifyThinkingSignature("非法请求：thinking signature 不合法"), true);
    assert.equal(shouldRectifyThinkingSignature("invalid request: malformed JSON"), true);
  });

  it("does not match unrelated errors", () => {
    assert.equal(shouldRectifyThinkingSignature(undefined), false);
    assert.equal(shouldRectifyThinkingSignature("Request timeout"), false);
    assert.equal(shouldRectifyThinkingSignature("Connection refused"), false);
    assert.equal(
      shouldRectifyThinkingSignature("Input tag 'adaptive' found using 'type' does not match expected tags"),
      false
    );
    assert.equal(shouldRectifyThinkingSignature("prompt is too long: 200001 tokens > 200000 maximum"), false);
  });
});

describe("shouldRectifyThinkingBudget", () => {
  it("matches budget constraint rejections", () => {
    assert.equal(
      shouldRectifyThinkingBudget("thinking.budget_tokens: Input should be greater than or equal to 1024"),
      true
    );
    assert.equal(
      shouldRectifyThinkingBudget("thinking: budget_tokens must be >= 1024 when thinking is enabled"),
      true
    );
  });

  it("does not match unrelated errors", () => {
    assert.equal(shouldRectifyThinkingBudget(undefined), false);
    assert.equal(shouldRectifyThinkingBudget("max_tokens: Input should be less than or equal to 8192"), false);
  });
});

describe("rectifyAnthropicSignature", () => {
  it("removes thinking blocks, redacted blocks, and stray signature fields", () => {
    const body = {
      model: "claude-test",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "t", signature: "sig" },
            { type: "text", text: "hello", signature: "sig_text" },
            { type: "tool_use", id: "toolu_1", name: "WebSearch", input: {}, signature: "sig_tool" },
            { type: "redacted_thinking", data: "r", signature: "sig_redacted" }
          ]
        }
      ]
    };

    const result = rectifyAnthropicSignature(body);

    assert.equal(result.applied, true);
    assert.equal(result.removedThinkingBlocks, 1);
    assert.equal(result.removedRedactedThinkingBlocks, 1);
    assert.equal(result.removedSignatureFields, 2);
    assert.equal(result.removedTopLevelThinking, false);

    const content = (body.messages as Array<Record<string, unknown>>)[0]?.content as Array<Record<string, unknown>>;
    assert.equal(content.length, 2);
    assert.equal(content[0]?.type, "text");
    assert.equal(content[0]?.signature, undefined);
    assert.equal(content[1]?.type, "tool_use");
    assert.equal(content[1]?.signature, undefined);
  });

  it("drops top-level thinking when the last assistant message starts with tool_use", () => {
    const body = {
      model: "claude-test",
      thinking: { type: "enabled", budget_tokens: 1024 },
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "S", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] }
      ]
    };

    const result = rectifyAnthropicSignature(body);

    assert.equal(result.applied, true);
    assert.equal(result.removedTopLevelThinking, true);
    assert.equal(body.thinking, undefined);
  });

  it("keeps top-level thinking for adaptive requests and thinking-prefixed messages", () => {
    const adaptive = {
      model: "claude-test",
      thinking: { type: "adaptive", budget_tokens: 5000 },
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "S", input: {} }]
        }
      ]
    };
    assert.equal(rectifyAnthropicSignature(adaptive).applied, false);
    assert.deepEqual(adaptive.thinking, { type: "adaptive", budget_tokens: 5000 });

    const prefixed = {
      model: "claude-test",
      thinking: { type: "enabled" },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "some thought" },
            { type: "tool_use", id: "toolu_1", name: "Test", input: {} }
          ]
        }
      ]
    };
    const result = rectifyAnthropicSignature(prefixed);
    // The thinking block itself is removed, which makes the message start
    // with tool_use — top-level thinking is then dropped as well.
    assert.equal(result.applied, true);
    assert.equal(result.removedTopLevelThinking, true);
    assert.equal(prefixed.thinking, undefined);
  });

  it("cleans legacy signature blocks even under adaptive thinking", () => {
    const body = {
      model: "claude-test",
      thinking: { type: "adaptive" },
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "t", signature: "sig_thinking" },
            { type: "text", text: "hello", signature: "sig_text" }
          ]
        }
      ]
    };
    const result = rectifyAnthropicSignature(body);
    assert.equal(result.applied, true);
    assert.equal(result.removedThinkingBlocks, 1);
    assert.equal(result.removedSignatureFields, 1);
    assert.deepEqual(body.thinking, { type: "adaptive" });
  });

  it("reports applied=false when the body has nothing to fix", () => {
    const body = { model: "claude-test", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    const result = rectifyAnthropicSignature(body);
    assert.equal(result.applied, false);
    assert.deepEqual(body, { model: "claude-test", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
  });

  it("handles string content and missing messages gracefully", () => {
    assert.equal(rectifyAnthropicSignature({ model: "m", messages: [{ role: "user", content: "hi" }] }).applied, false);
    assert.equal(rectifyAnthropicSignature({ model: "m" }).applied, false);
  });
});

describe("rectifyAnthropicBudget", () => {
  it("forces a valid budget and raises max_tokens above it", () => {
    const body = { model: "claude-test", max_tokens: 1024, thinking: { type: "enabled", budget_tokens: 512 } };
    const result = rectifyAnthropicBudget(body);
    assert.equal(result.applied, true);
    assert.deepEqual(body.thinking, { type: "enabled", budget_tokens: 32000 });
    assert.equal(body.max_tokens, 64000);
    assert.equal(result.budgetTokensBefore, 512);
    assert.equal(result.budgetTokensAfter, 32000);
    assert.equal(result.maxTokensBefore, 1024);
    assert.equal(result.maxTokensAfter, 64000);
  });

  it("creates the thinking object when absent", () => {
    const body = { model: "claude-test" };
    const result = rectifyAnthropicBudget(body);
    assert.equal(result.applied, true);
    assert.deepEqual(body.thinking, { type: "enabled", budget_tokens: 32000 });
    assert.equal(body.max_tokens, 64000);
  });

  it("keeps an already-sufficient max_tokens", () => {
    const body = { model: "claude-test", max_tokens: 100000, thinking: { type: "enabled", budget_tokens: 1024 } };
    const result = rectifyAnthropicBudget(body);
    assert.equal(result.applied, true);
    assert.equal(body.max_tokens, 100000);
    assert.equal(result.maxTokensAfter, 100000);
  });

  it("never rewrites adaptive thinking", () => {
    const body = { model: "claude-test", thinking: { type: "adaptive" }, max_tokens: 4096 };
    const result = rectifyAnthropicBudget(body);
    assert.equal(result.applied, false);
    assert.deepEqual(body.thinking, { type: "adaptive" });
    assert.equal(body.max_tokens, 4096);
  });
});
