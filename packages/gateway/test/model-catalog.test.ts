import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getModelPresets, groupModelsByProvider } from "../src/services/model-catalog.js";

describe("model catalog", () => {
  it("returns built-in model presets", () => {
    const presets = getModelPresets();

    assert.ok(presets.some((preset) => preset.id === "anthropic-sonnet"));
    assert.ok(presets.every((preset) => preset.provider.length > 0));
  });

  it("groups models by provider with counts", () => {
    const groups = groupModelsByProvider([
      { id: "m1", name: "Claude Sonnet", provider: "anthropic" },
      { id: "m2", name: "GPT", provider: "openai" },
      { id: "m3", name: "Claude Opus", provider: "anthropic" },
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.provider, "anthropic");
    assert.equal(groups[0]!.count, 2);
    assert.equal(groups[1]!.provider, "openai");
  });
});
