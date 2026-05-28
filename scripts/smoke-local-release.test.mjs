import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSmokeCommandPlan,
  buildSmokeEnvironment,
  redactSmokeEnvironment,
  requiredManualSmokeEvidence
} from "./smoke-local-release.mjs";

describe("local release smoke harness", () => {
  it("builds deterministic loopback environment without exposing secrets in reports", () => {
    const env = buildSmokeEnvironment({
      root: "/tmp/openforge-smoke",
      masterKey: "a".repeat(64),
      jwtSecret: "test-jwt-secret-with-enough-length"
    });

    assert.equal(env.OPENFORGE_HOST, "127.0.0.1");
    assert.equal(env.OPENFORGE_PORT, "48731");
    assert.equal(env.OPENFORGE_WEB_PORT, "48732");
    assert.equal(env.OPENFORGE_GATEWAY_URL, "http://127.0.0.1:48731");
    assert.equal(env.NEXT_PUBLIC_GATEWAY_URL, "http://127.0.0.1:48731");
    assert.equal(env.OPENFORGE_DB_PATH, "/tmp/openforge-smoke/openforge-smoke.db");

    assert.deepEqual(redactSmokeEnvironment(env), {
      ...env,
      OPENFORGE_MASTER_KEY: "[redacted]",
      OPENFORGE_JWT_SECRET: "[redacted]"
    });
  });

  it("keeps real browser and real provider prompt evidence explicit", () => {
    assert.deepEqual(requiredManualSmokeEvidence(), [
      "browser-terminal-attach",
      "browser-terminal-input-output",
      "browser-terminal-resize",
      "browser-terminal-refresh-reconnect",
      "session-stop",
      "gateway-web-restart-recovery",
      "real-claude-permission-prompt"
    ]);
  });

  it("emits command plan with redacted env and detailed manual evidence", () => {
    const plan = buildSmokeCommandPlan(buildSmokeEnvironment({
      root: "/tmp/openforge-smoke",
      masterKey: "b".repeat(64),
      jwtSecret: "another-test-jwt-secret-with-enough-length"
    }));

    assert.equal(plan.gateway, "pnpm --dir packages/gateway dev");
    assert.equal(plan.web, "pnpm --dir packages/web dev");
    assert.equal(plan.environment.OPENFORGE_MASTER_KEY, "[redacted]");
    assert.equal(plan.environment.OPENFORGE_JWT_SECRET, "[redacted]");
    assert.deepEqual(plan.manualEvidence, requiredManualSmokeEvidence());
  });
});
