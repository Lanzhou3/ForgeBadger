import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLaunchPlan } from "../src/routes/sessions.js";

describe("Codex provider env isolation", () => {
  it("launches Codex against the host environment without injected credentials or model args", () => {
    const plan = createLaunchPlan({
      adapter: "codex",
      projectRoot: "/workspace/app",
      sessionId: "session-1"
    });

    assert.equal(plan.command, "codex");
    assert.deepEqual(plan.args, []);
    assert.deepEqual(plan.secretEnvNames, []);
    assert.equal(plan.credentialMode, "host_environment");
    assert.equal(plan.env.OPENAI_API_KEY, undefined);
    assert.equal(plan.env.FORGEBADGER_SESSION_ID, "session-1");
    assert.ok(plan.env.FORGEBADGER_GATEWAY_URL);
  });

  it("launches Claude without injecting provider credentials or model env", () => {
    const plan = createLaunchPlan({
      adapter: "claude",
      projectRoot: "/workspace/app",
      sessionId: "session-2"
    });

    assert.equal(plan.command, "claude");
    assert.equal(plan.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(plan.env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(plan.env.ANTHROPIC_MODEL, undefined);
    assert.equal(plan.env.ANTHROPIC_BASE_URL, undefined);
    assert.deepEqual(plan.secretEnvNames, []);
  });

  it("launches OpenCode and Kimi without provider/model flags", () => {
    const opencode = createLaunchPlan({
      adapter: "opencode",
      projectRoot: "/workspace/app",
      sessionId: "session-3"
    });
    const kimi = createLaunchPlan({
      adapter: "kimi",
      projectRoot: "/workspace/app",
      sessionId: "session-4"
    });

    assert.deepEqual(opencode.args, []);
    assert.equal(opencode.env.OPENCODE_MODEL, undefined);
    assert.deepEqual(kimi.args, []);
    assert.deepEqual(kimi.secretEnvNames, []);
  });
});
