import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  THINKING_EFFORT_LEVELS,
  isThinkingEffortLevel,
  projectedKimiCapabilities
} from "../src/services/model-capability-projection.js";

describe("model capability projection", () => {
  it("projects forgebadger tags onto kimi code capability entries", () => {
    assert.deepEqual(
      projectedKimiCapabilities(["chat", "code", "vision", "video", "reasoning", "tools"]),
      ["image_in", "video_in", "thinking", "tool_use"]
    );
  });

  it("projects audio for free-form tags outside the common set", () => {
    assert.deepEqual(projectedKimiCapabilities(["audio"]), ["audio_in"]);
  });

  it("never projects always_thinking and ignores tags without a counterpart", () => {
    assert.deepEqual(projectedKimiCapabilities(["chat", "embedding", "multimodal"]), []);
    assert.ok(!projectedKimiCapabilities(["reasoning"]).includes("always_thinking"));
  });

  it("de-duplicates and preserves first-seen order", () => {
    assert.deepEqual(
      projectedKimiCapabilities(["reasoning", "vision", "reasoning", "tools"]),
      ["thinking", "image_in", "tool_use"]
    );
  });

  it("returns an empty array for no tags", () => {
    assert.deepEqual(projectedKimiCapabilities([]), []);
  });

  it("exposes the kimi code effort ladder", () => {
    assert.deepEqual(THINKING_EFFORT_LEVELS, ["low", "medium", "high", "xhigh", "max"]);
    assert.equal(isThinkingEffortLevel("xhigh"), true);
    assert.equal(isThinkingEffortLevel("minimal"), false);
    assert.equal(isThinkingEffortLevel("off"), false);
    assert.equal(isThinkingEffortLevel(""), false);
    assert.equal(isThinkingEffortLevel(undefined), false);
  });
});
