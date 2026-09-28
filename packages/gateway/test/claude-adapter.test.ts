import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createClaudeLaunchPlan } from "../src/adapters/claude.js";

describe("createClaudeLaunchPlan", () => {
  it("returns a structured launch plan for stored encrypted credentials", () => {
    const plan = createClaudeLaunchPlan({
      projectRoot: "/workspace/app",
      credentialMode: "stored_encrypted_key",
      secretEnvNames: ["ANTHROPIC_API_KEY"]
    });

    assert.equal(plan.command, "claude");
    assert.deepEqual(plan.args, []);
    assert.equal(plan.cwd, "/workspace/app");
    assert.equal(plan.credentialMode, "stored_encrypted_key");
    assert.deepEqual(plan.secretEnvNames, ["ANTHROPIC_API_KEY"]);
    assert.equal(typeof plan, "object");
    assert.equal("shell" in plan, false);
  });

  it("keeps host environment mode explicit without secret names", () => {
    const plan = createClaudeLaunchPlan({
      projectRoot: "/workspace/app",
      credentialMode: "host_environment"
    });

    assert.equal(plan.credentialMode, "host_environment");
    assert.deepEqual(plan.secretEnvNames, []);
  });

  it("supports non-secret environment values without leaking secrets", () => {
    const plan = createClaudeLaunchPlan({
      projectRoot: "/workspace/app",
      credentialMode: "stored_encrypted_key",
      secretEnvNames: ["ANTHROPIC_API_KEY"],
      env: {
        FORGEBADGER_SESSION_ID: "session_123"
      }
    });

    assert.deepEqual(plan.env, { FORGEBADGER_SESSION_ID: "session_123" });
    assert.equal("ANTHROPIC_API_KEY" in plan.env, false);
  });

  it("adds validated plugin directories using Claude Code --plugin-dir flags", () => {
    const plan = createClaudeLaunchPlan({
      projectRoot: "/workspace/app",
      credentialMode: "host_environment",
      pluginDirs: [
        "/workspace/app/.forgebadger/claude-plugins/claude-safe-edits",
        "/workspace/app/.forgebadger/claude-plugins/claude-code-review"
      ]
    });

    assert.deepEqual(plan.args, [
      "--plugin-dir",
      "/workspace/app/.forgebadger/claude-plugins/claude-safe-edits",
      "--plugin-dir",
      "/workspace/app/.forgebadger/claude-plugins/claude-code-review"
    ]);
  });
});
