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
    assert.deepEqual(plan.args, ["--no-daemon", "-c", 'tui.notifications=["approval-requested"]', "-c", 'tui.notification_method="osc9"', "-c", 'tui.notification_condition="always"', "-m", "gpt-5.1-codex", "-c", 'model_provider="openai"']);
    assert.equal(plan.cwd, "/workspace/app");
    assert.deepEqual(plan.secretEnvNames, []);
  });

  it("keeps Codex notification identity local to each terminal session", () => {
    const plans = ["session-a", "session-b"].map((sessionId) => createAdapterLaunchPlan({
      adapter: "codex",
      projectRoot: "/workspace/app",
      credentialMode: "host_environment",
      env: { FORGEBADGER_SESSION_ID: sessionId }
    }));

    for (const plan of plans) {
      assert.deepEqual(plan.args, ["--no-daemon", "-c", 'tui.notifications=["approval-requested"]', "-c", 'tui.notification_method="osc9"', "-c", 'tui.notification_condition="always"']);
      assert.equal(plan.args.includes("--dangerously-bypass-hook-trust"), false);
      assert.equal("shell" in plan, false);
    }
    assert.equal(plans[0].env.FORGEBADGER_SESSION_ID, "session-a");
    assert.equal(plans[1].env.FORGEBADGER_SESSION_ID, "session-b");
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

  it("creates a PI launch plan with zero arguments (host-environment config only)", () => {
    const plan = createAdapterLaunchPlan({
      adapter: "pi",
      projectRoot: "/workspace/app",
      credentialMode: "host_environment",
      model: { provider: "my-relay", modelId: "my-model-1" }
    });

    assert.equal(plan.command, "pi");
    assert.deepEqual(plan.args, []);
    assert.equal(plan.cwd, "/workspace/app");
    assert.deepEqual(plan.secretEnvNames, []);
    assert.equal("shell" in plan, false);
  });

  it("keeps provider-prefixed OpenCode model IDs unchanged", () => {
    assert.equal(formatAdapterModelId("opencode", "anthropic", "anthropic/claude-sonnet-4-5"), "anthropic/claude-sonnet-4-5");
  });

  it("adds native-session resume args for every resume-capable adapter", () => {
    const id = "01a176ff-ce02-7683-9a74-8df8c5f8e0fb";
    const base = { projectRoot: "/workspace/app", credentialMode: "host_environment" as const };
    const claude = createAdapterLaunchPlan({ ...base, adapter: "claude", resumeSessionId: id });
    assert.deepEqual(claude.args, ["--resume", id]);
    const codex = createAdapterLaunchPlan({ ...base, adapter: "codex", resumeSessionId: id });
    assert.deepEqual(codex.args.slice(0, 2), ["resume", id]);
    assert.equal(codex.args.includes("--no-daemon"), true);
    for (const adapter of ["opencode", "kimi", "pi"] as const) {
      const plan = createAdapterLaunchPlan({ ...base, adapter, resumeSessionId: id });
      assert.deepEqual(plan.args, ["--session", id]);
    }
    // Zero-resume-surface adapters ignore the id entirely.
    for (const adapter of ["grok", "mcode"] as const) {
      const plan = createAdapterLaunchPlan({ ...base, adapter, resumeSessionId: id });
      assert.deepEqual(plan.args, []);
    }
    // Fresh conversations keep the historical zero-resume shape.
    assert.deepEqual(createAdapterLaunchPlan({ ...base, adapter: "claude" }).args, []);
  });

  it("creates a Claude launch plan with resume and plugin dirs", () => {
    const plan = createAdapterLaunchPlan({
      adapter: "claude",
      projectRoot: "/workspace/app",
      credentialMode: "host_environment",
      resumeSessionId: "abc-123",
      pluginDirs: ["/plugins/one"]
    });
    assert.deepEqual(plan.args, ["--resume", "abc-123", "--plugin-dir", "/plugins/one"]);
  });
});
