import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { loadEnv } from "../src/config/env.js";

const jwtSecret = "0123456789abcdef0123456789abcdef";
const masterKey = "abcdef0123456789abcdef0123456789";
const hexMasterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("loadEnv security configuration", () => {
  it("ignores retired environment aliases", () => {
    const env = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: masterKey,
      FORGEBADGER_PORT: "49831",
      OLD_PRODUCT_PORT: "48731"
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
    assert.equal(env.FORGEBADGER_TMUX_PREFIX, "fb-");
    assert.equal(env.FORGEBADGER_PROJECT_MANAGER_AUTO_DISPATCH_ENABLED, false);
  });

  it("uses the ForgeBadger database name inside an explicit state directory", () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "forgebadger-explicit-state-"));

    const env = loadEnv({
      FORGEBADGER_JWT_SECRET: jwtSecret,
      FORGEBADGER_MASTER_KEY: masterKey,
      FORGEBADGER_STATE_DIR: stateDir
    });

    assert.equal(env.FORGEBADGER_DB_PATH, path.join(stateDir, "forgebadger.db"));
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
      FORGEBADGER_TMUX_PREFIX: "fb-smoke-test-"
    });

    assert.equal(env.FORGEBADGER_TMUX_PREFIX, "fb-smoke-test-");
  });

});
