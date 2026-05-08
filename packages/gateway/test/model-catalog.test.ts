import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getModelPresets,
  getProviderCatalog,
  groupModelsByProvider
} from "../src/services/model-catalog.js";

describe("model catalog", () => {
  it("returns built-in model presets", () => {
    const presets = getModelPresets();

    assert.ok(presets.some((preset) => preset.id === "anthropic-sonnet"));
    assert.ok(presets.every((preset) => preset.provider.length > 0));
  });

  it("returns provider presets with adapter and api format metadata", () => {
    const catalog = getProviderCatalog();

    assert.ok(catalog.some((provider) => provider.id === "anthropic"));
    assert.ok(catalog.some((provider) => provider.id === "openai-compatible"));
    assert.ok(catalog.some((provider) => provider.id === "deepseek"));
    assert.ok(catalog.some((provider) => provider.id === "ollama"));

    const anthropic = catalog.find((provider) => provider.id === "anthropic");
    assert.equal(anthropic?.apiFormat, "anthropic");
    assert.deepEqual(anthropic?.supportedAdapters, ["claude"]);
    assert.ok(anthropic?.defaultModels.some((model) => model.capabilities.includes("code")));

    const compatible = catalog.find((provider) => provider.id === "openai-compatible");
    assert.equal(compatible?.authType, "api_key");
    assert.ok(compatible?.supportedAdapters.includes("opencode"));
    assert.equal(catalog.some((provider) => provider.supportedAdapters.includes("codex")), false);
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
