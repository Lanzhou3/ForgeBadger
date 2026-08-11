import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAdapterLaunchPlan,
  formatAdapterModelId
} from "../src/adapters/index.js";

describe("multi-adapter launch plans", () => {
  it("creates an OpenCode TUI launch plan with provider/model args", () => {
    const plan = createAdapterLaunchPlan({
      adapter: "opencode",
      projectRoot: "/workspace/app",
      credentialMode: "stored_encrypted_key",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
      env: { ANTHROPIC_API_KEY: "secret" },
      secretEnvNames: ["ANTHROPIC_API_KEY"]
    });

    assert.equal(plan.command, "opencode");
    assert.deepEqual(plan.args, ["--model", "anthropic/claude-sonnet-4-5"]);
    assert.equal(plan.cwd, "/workspace/app");
    assert.deepEqual(plan.secretEnvNames, ["ANTHROPIC_API_KEY"]);
    assert.equal("shell" in plan, false);
  });

  it("creates a Codex launch plan with the selected model flag", () => {
    const plan = createAdapterLaunchPlan({
      adapter: "codex",
      projectRoot: "/workspace/app",
      credentialMode: "host_environment",
      model: { provider: "openai", modelId: "gpt-5.1-codex" }
    });

    assert.equal(plan.command, "codex");
    assert.deepEqual(plan.args, ["-m", "gpt-5.1-codex"]);
    assert.equal(plan.cwd, "/workspace/app");
    assert.deepEqual(plan.secretEnvNames, []);
  });

  it("creates a Kimi Code launch plan without model override args", () => {
    const plan = createAdapterLaunchPlan({
      adapter: "kimi",
      projectRoot: "/workspace/app",
      credentialMode: "host_environment",
      model: { provider: "kimi", modelId: "kimi-k2.5" }
    });

    assert.equal(plan.command, "kimi");
    assert.deepEqual(plan.args, []);
    assert.equal(plan.cwd, "/workspace/app");
    assert.deepEqual(plan.secretEnvNames, []);
    assert.equal("shell" in plan, false);
  });

  it("keeps provider-prefixed OpenCode model IDs unchanged", () => {
    assert.equal(formatAdapterModelId("opencode", "anthropic", "anthropic/claude-sonnet-4-5"), "anthropic/claude-sonnet-4-5");
  });
});
