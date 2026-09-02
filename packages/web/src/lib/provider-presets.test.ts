import { describe, expect, it } from "vitest";

import {
  filterProviderPresets,
  providerPresets,
  providerPresetToForm,
} from "./provider-presets";

describe("providerPresets", () => {
  it("has unique ids", () => {
    const ids = providerPresets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every preset has at least one endpoint", () => {
    for (const preset of providerPresets) {
      expect(
        preset.anthropicBaseUrl ?? preset.openaiBaseUrl,
        `preset ${preset.id} must define an endpoint`
      ).toBeTruthy();
    }
  });

  it("never carries preset models", () => {
    for (const preset of providerPresets) {
      expect(preset).not.toHaveProperty("defaultModels");
      expect(preset).not.toHaveProperty("models");
    }
  });
});

describe("filterProviderPresets", () => {
  it("returns all presets for an empty query", () => {
    expect(filterProviderPresets(providerPresets, "  ")).toHaveLength(providerPresets.length);
  });

  it("matches by name case-insensitively", () => {
    const results = filterProviderPresets(providerPresets, "minimax");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((preset) => preset.name.toLowerCase().includes("minimax"))).toBe(true);
  });

  it("matches by endpoint host", () => {
    const results = filterProviderPresets(providerPresets, "api.kimi.com");
    expect(results.map((preset) => preset.id)).toContain("kimi-code");
  });
});

describe("providerPresetToForm", () => {
  it("maps preset endpoints and auth into the custom provider form", () => {
    const kimi = providerPresets.find((preset) => preset.id === "kimi-code");
    expect(kimi).toBeDefined();
    const form = providerPresetToForm(kimi!);
    expect(form).toEqual({
      name: "Kimi For Coding",
      providerKey: "kimi-code",
      apiFormat: "openai-compatible",
      authType: "api_key",
      anthropicBaseUrl: "https://api.kimi.com/coding/",
      openaiBaseUrl: "https://api.kimi.com/coding/v1",
      supportedAdapters: ["claude", "opencode"],
      allowPlaintextHttp: false,
    });
  });

  it("leaves missing endpoints empty instead of fabricating them", () => {
    const anthropic = providerPresets.find((preset) => preset.id === "anthropic-api");
    const form = providerPresetToForm(anthropic!);
    expect(form.openaiBaseUrl).toBe("");
    expect(form.anthropicBaseUrl).toBe("https://api.anthropic.com");
  });
});
