import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { loadEnv } from "../src/config/env.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const hexMasterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("loadEnv security configuration", () => {
  it("prefers ForgeBadger variables while accepting legacy OpenForge aliases", () => {
    const env = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: masterKey,
      FORGEBADGER_PORT: "49831",
      OPENFORGE_PORT: "48731"
    });

    assert.equal(env.FORGEBADGER_JWT_SECRET, jwtSecret);
    assert.equal(env.FORGEBADGER_MASTER_KEY, masterKey);
    assert.equal(env.FORGEBADGER_PORT, 49831);
  });

  it("requires explicit JWT and master key secrets", () => {
    assert.throws(() => loadEnv({}), /FORGEBADGER_JWT_SECRET|Required/i);
    assert.throws(
      () => loadEnv({ FORGEBADGER_JWT_SECRET: jwtSecret }),
      /FORGEBADGER_MASTER_KEY|Required/i
    );
  });

  it("validates JWT secret length", () => {
    assert.throws(
      () =>
        loadEnv({
          FORGEBADGER_JWT_SECRET: "short",
          FORGEBADGER_MASTER_KEY: masterKey
        }),
      /32/i
    );
  });

  it("validates master key byte length at startup", () => {
    assert.throws(
      () =>
        loadEnv({
          FORGEBADGER_JWT_SECRET: jwtSecret,
          FORGEBADGER_MASTER_KEY: "short"
        }),
      /32 bytes/i
    );
  });

  it("loads valid security configuration", () => {
    const env = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: masterKey
    });

    assert.equal(env.FORGEBADGER_JWT_SECRET, jwtSecret);
    assert.equal(env.FORGEBADGER_MASTER_KEY, masterKey);
    assert.equal(env.FORGEBADGER_TMUX_PREFIX, "of-");
    assert.equal(env.FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED, false);
  });

  it("reuses an existing legacy database inside an explicit state directory", () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "forgebadger-explicit-legacy-state-"));
    const legacyDbPath = path.join(stateDir, "openforge.db");
    writeFileSync(legacyDbPath, "");

    const env = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: masterKey,
      FORGEBADGER_STATE_DIR: stateDir
    });

    assert.equal(env.FORGEBADGER_DB_PATH, legacyDbPath);
  });

  it("only enables Project Manager automatic dispatch with an explicit boolean value", () => {
    const enabled = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: masterKey,
      FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED: "true"
    });

    assert.equal(enabled.FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED, true);
    assert.throws(
      () =>
        loadEnv({
          FORGEBADGER_JWT_SECRET: jwtSecret,
          FORGEBADGER_MASTER_KEY: masterKey,
          FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED: "yes"
        }),
      /FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED|Invalid/i
    );
  });

  it("keeps validated environment values safe to pass through runtime wiring", () => {
    const parsed = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: masterKey
    });

    assert.equal(
      loadEnv(parsed as unknown as NodeJS.ProcessEnv).FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED,
      false
    );
  });

  it("accepts a 32-byte key encoded as 64 hex characters", () => {
    const env = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: hexMasterKey
    });

    assert.equal(env.FORGEBADGER_MASTER_KEY, hexMasterKey);
  });

  it("loads a custom tmux prefix", () => {
    const env = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: masterKey,
      FORGEBADGER_TMUX_PREFIX: "of-smoke-test-"
    });

    assert.equal(env.FORGEBADGER_TMUX_PREFIX, "of-smoke-test-");
  });

  it("gates the dsh copilot behind an explicit flag value", () => {
    const base = { FORGEBADGER_JWT_SECRET: jwtSecret, FORGEBADGER_MASTER_KEY: masterKey };
    assert.equal(loadEnv({ ...base }).FORGEBADGER_DSH_COPILOT_ENABLED, false);
    assert.equal(loadEnv({ ...base, FORGEBADGER_DSH_COPILOT_ENABLED: "1" }).FORGEBADGER_DSH_COPILOT_ENABLED, true);
    assert.equal(loadEnv({ ...base, FORGEBADGER_DSH_COPILOT_ENABLED: "true" }).FORGEBADGER_DSH_COPILOT_ENABLED, true);
    assert.equal(loadEnv({ ...base, FORGEBADGER_DSH_COPILOT_ENABLED: "0" }).FORGEBADGER_DSH_COPILOT_ENABLED, false);
    assert.equal(loadEnv({ ...base, FORGEBADGER_DSH_COPILOT_ENABLED: "false" }).FORGEBADGER_DSH_COPILOT_ENABLED, false);
    assert.throws(
      () => loadEnv({ ...base, FORGEBADGER_DSH_COPILOT_ENABLED: "yes" }),
      /FORGEBADGER_DSH_COPILOT_ENABLED|Invalid/i
    );
  });

  it("gates the copilot reactive loop behind an explicit flag value, default off", () => {
    const base = { FORGEBADGER_JWT_SECRET: jwtSecret, FORGEBADGER_MASTER_KEY: masterKey };
    // Default off: Copilot never self-starts report conversations unless the
    // operator explicitly opts in.
    assert.equal(loadEnv({ ...base }).FORGEBADGER_COPILOT_REACTIVE_ENABLED, false);
    assert.equal(loadEnv({ ...base, FORGEBADGER_COPILOT_REACTIVE_ENABLED: "1" }).FORGEBADGER_COPILOT_REACTIVE_ENABLED, true);
    assert.equal(loadEnv({ ...base, FORGEBADGER_COPILOT_REACTIVE_ENABLED: "true" }).FORGEBADGER_COPILOT_REACTIVE_ENABLED, true);
    assert.equal(loadEnv({ ...base, FORGEBADGER_COPILOT_REACTIVE_ENABLED: "0" }).FORGEBADGER_COPILOT_REACTIVE_ENABLED, false);
    assert.equal(loadEnv({ ...base, FORGEBADGER_COPILOT_REACTIVE_ENABLED: "false" }).FORGEBADGER_COPILOT_REACTIVE_ENABLED, false);
    assert.throws(
      () => loadEnv({ ...base, FORGEBADGER_COPILOT_REACTIVE_ENABLED: "yes" }),
      /FORGEBADGER_COPILOT_REACTIVE_ENABLED|Invalid/i
    );
  });

  it("defaults the dsh idle reap to 15 minutes and accepts an override", () => {
    const base = { FORGEBADGER_JWT_SECRET: jwtSecret, FORGEBADGER_MASTER_KEY: masterKey };
    assert.equal(loadEnv({ ...base }).FORGEBADGER_DSH_IDLE_MS, 15 * 60 * 1000);
    assert.equal(loadEnv({ ...base, FORGEBADGER_DSH_IDLE_MS: "5000" }).FORGEBADGER_DSH_IDLE_MS, 5000);
    assert.throws(
      () => loadEnv({ ...base, FORGEBADGER_DSH_IDLE_MS: "-1" }),
      /FORGEBADGER_DSH_IDLE_MS|Invalid|positive/i
    );
  });
});
