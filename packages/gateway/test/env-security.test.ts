import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadEnv } from "../src/config/env.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const hexMasterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("loadEnv security configuration", () => {
  it("requires explicit JWT and master key secrets", () => {
    assert.throws(() => loadEnv({}), /OPENFORGE_JWT_SECRET|Required/i);
    assert.throws(
      () => loadEnv({ OPENFORGE_JWT_SECRET: jwtSecret }),
      /OPENFORGE_MASTER_KEY|Required/i
    );
  });

  it("validates JWT secret length", () => {
    assert.throws(
      () =>
        loadEnv({
          OPENFORGE_JWT_SECRET: "short",
          OPENFORGE_MASTER_KEY: masterKey
        }),
      /32/i
    );
  });

  it("validates master key byte length at startup", () => {
    assert.throws(
      () =>
        loadEnv({
          OPENFORGE_JWT_SECRET: jwtSecret,
          OPENFORGE_MASTER_KEY: "short"
        }),
      /32 bytes/i
    );
  });

  it("loads valid security configuration", () => {
    const env = loadEnv({
      OPENFORGE_JWT_SECRET: jwtSecret,
      OPENFORGE_MASTER_KEY: masterKey
    });

    assert.equal(env.OPENFORGE_JWT_SECRET, jwtSecret);
    assert.equal(env.OPENFORGE_MASTER_KEY, masterKey);
    assert.equal(env.OPENFORGE_TMUX_PREFIX, "of-");
    assert.equal(env.OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED, false);
  });

  it("only enables Project Manager automatic dispatch with an explicit boolean value", () => {
    const enabled = loadEnv({
      OPENFORGE_JWT_SECRET: jwtSecret,
      OPENFORGE_MASTER_KEY: masterKey,
      OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED: "true"
    });

    assert.equal(enabled.OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED, true);
    assert.throws(
      () =>
        loadEnv({
          OPENFORGE_JWT_SECRET: jwtSecret,
          OPENFORGE_MASTER_KEY: masterKey,
          OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED: "yes"
        }),
      /OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED|Invalid/i
    );
  });

  it("keeps validated environment values safe to pass through runtime wiring", () => {
    const parsed = loadEnv({
      OPENFORGE_JWT_SECRET: jwtSecret,
      OPENFORGE_MASTER_KEY: masterKey
    });

    assert.equal(
      loadEnv(parsed as unknown as NodeJS.ProcessEnv).OPENFORGE_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED,
      false
    );
  });

  it("accepts a 32-byte key encoded as 64 hex characters", () => {
    const env = loadEnv({
      OPENFORGE_JWT_SECRET: jwtSecret,
      OPENFORGE_MASTER_KEY: hexMasterKey
    });

    assert.equal(env.OPENFORGE_MASTER_KEY, hexMasterKey);
  });

  it("loads a custom tmux prefix", () => {
    const env = loadEnv({
      OPENFORGE_JWT_SECRET: jwtSecret,
      OPENFORGE_MASTER_KEY: masterKey,
      OPENFORGE_TMUX_PREFIX: "of-smoke-test-"
    });

    assert.equal(env.OPENFORGE_TMUX_PREFIX, "of-smoke-test-");
  });

  it("gates the dsh copilot behind an explicit flag value", () => {
    const base = { OPENFORGE_JWT_SECRET: jwtSecret, OPENFORGE_MASTER_KEY: masterKey };
    assert.equal(loadEnv({ ...base }).OPENFORGE_DSH_COPILOT_ENABLED, false);
    assert.equal(loadEnv({ ...base, OPENFORGE_DSH_COPILOT_ENABLED: "1" }).OPENFORGE_DSH_COPILOT_ENABLED, true);
    assert.equal(loadEnv({ ...base, OPENFORGE_DSH_COPILOT_ENABLED: "true" }).OPENFORGE_DSH_COPILOT_ENABLED, true);
    assert.equal(loadEnv({ ...base, OPENFORGE_DSH_COPILOT_ENABLED: "0" }).OPENFORGE_DSH_COPILOT_ENABLED, false);
    assert.equal(loadEnv({ ...base, OPENFORGE_DSH_COPILOT_ENABLED: "false" }).OPENFORGE_DSH_COPILOT_ENABLED, false);
    assert.throws(
      () => loadEnv({ ...base, OPENFORGE_DSH_COPILOT_ENABLED: "yes" }),
      /OPENFORGE_DSH_COPILOT_ENABLED|Invalid/i
    );
  });

  it("gates the copilot reactive loop behind an explicit flag value, default off", () => {
    const base = { OPENFORGE_JWT_SECRET: jwtSecret, OPENFORGE_MASTER_KEY: masterKey };
    // Default off: Copilot never self-starts report conversations unless the
    // operator explicitly opts in.
    assert.equal(loadEnv({ ...base }).OPENFORGE_COPILOT_REACTIVE_ENABLED, false);
    assert.equal(loadEnv({ ...base, OPENFORGE_COPILOT_REACTIVE_ENABLED: "1" }).OPENFORGE_COPILOT_REACTIVE_ENABLED, true);
    assert.equal(loadEnv({ ...base, OPENFORGE_COPILOT_REACTIVE_ENABLED: "true" }).OPENFORGE_COPILOT_REACTIVE_ENABLED, true);
    assert.equal(loadEnv({ ...base, OPENFORGE_COPILOT_REACTIVE_ENABLED: "0" }).OPENFORGE_COPILOT_REACTIVE_ENABLED, false);
    assert.equal(loadEnv({ ...base, OPENFORGE_COPILOT_REACTIVE_ENABLED: "false" }).OPENFORGE_COPILOT_REACTIVE_ENABLED, false);
    assert.throws(
      () => loadEnv({ ...base, OPENFORGE_COPILOT_REACTIVE_ENABLED: "yes" }),
      /OPENFORGE_COPILOT_REACTIVE_ENABLED|Invalid/i
    );
  });

  it("defaults the dsh idle reap to 15 minutes and accepts an override", () => {
    const base = { OPENFORGE_JWT_SECRET: jwtSecret, OPENFORGE_MASTER_KEY: masterKey };
    assert.equal(loadEnv({ ...base }).OPENFORGE_DSH_IDLE_MS, 15 * 60 * 1000);
    assert.equal(loadEnv({ ...base, OPENFORGE_DSH_IDLE_MS: "5000" }).OPENFORGE_DSH_IDLE_MS, 5000);
    assert.throws(
      () => loadEnv({ ...base, OPENFORGE_DSH_IDLE_MS: "-1" }),
      /OPENFORGE_DSH_IDLE_MS|Invalid|positive/i
    );
  });
});
