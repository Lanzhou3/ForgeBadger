import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildModelHealth } from "../src/services/model-health.js";

describe("buildModelHealth", () => {
  it("marks configured active models as ready without external provider calls", () => {
    const health = buildModelHealth({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      endpoint: null,
      status: "active",
      isDefault: true
    });

    assert.equal(health.healthy, true);
    assert.equal(health.status, "ready");
    assert.equal(health.checks.modelConfigured, true);
    assert.equal(health.checks.endpointConfigured, false);
    assert.equal(health.checks.defaultModel, true);
  });

  it("marks disabled models as needing attention", () => {
    const health = buildModelHealth({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      endpoint: "https://api.anthropic.com",
      status: "disabled",
      isDefault: false
    });

    assert.equal(health.healthy, false);
    assert.equal(health.status, "needs_attention");
  });
});
