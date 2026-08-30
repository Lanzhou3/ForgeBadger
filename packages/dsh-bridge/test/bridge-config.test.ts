import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadBridgeConfig } from "../src/bridge-config.js";

describe("loadBridgeConfig", () => {
  it("applies defaults and accepts a complete env", () => {
    const config = loadBridgeConfig({
      FORGEBADGER_COPILOT_BRIDGE_TOKEN: "token-1",
      FORGEBADGER_USER_ID: "user-1",
    });
    assert.equal(config.gatewayUrl, "http://127.0.0.1:48731");
    assert.equal(config.token, "token-1");
    assert.equal(config.userId, "user-1");
    assert.equal(config.timeoutMs, 15_000);
    assert.equal(config.enableOperate, false);
  });

  it("accepts legacy OpenForge variables while preferring ForgeBadger values", () => {
    const config = loadBridgeConfig({
      FORGEBADGER_COPILOT_BRIDGE_TOKEN: "new-token",
      OPENFORGE_COPILOT_BRIDGE_TOKEN: "legacy-token",
      OPENFORGE_USER_ID: "legacy-user"
    });

    assert.equal(config.token, "new-token");
    assert.equal(config.userId, "legacy-user");
  });

  it("enables operate tools only on an explicit 1/true", () => {
    const base = { FORGEBADGER_COPILOT_BRIDGE_TOKEN: "t", FORGEBADGER_USER_ID: "u" };
    assert.equal(loadBridgeConfig({ ...base, FORGEBADGER_BRIDGE_ENABLE_OPERATE: "1" }).enableOperate, true);
    assert.equal(loadBridgeConfig({ ...base, FORGEBADGER_BRIDGE_ENABLE_OPERATE: "true" }).enableOperate, true);
    assert.equal(loadBridgeConfig({ ...base, FORGEBADGER_BRIDGE_ENABLE_OPERATE: "0" }).enableOperate, false);
    assert.equal(loadBridgeConfig({ ...base, FORGEBADGER_BRIDGE_ENABLE_OPERATE: "yes" }).enableOperate, false);
  });

  it("strips trailing slashes from a custom gateway URL", () => {
    const config = loadBridgeConfig({
      FORGEBADGER_GATEWAY_URL: "http://127.0.0.1:9000/",
      FORGEBADGER_COPILOT_BRIDGE_TOKEN: "t",
      FORGEBADGER_USER_ID: "u",
      FORGEBADGER_BRIDGE_TIMEOUT_MS: "3000",
    });
    assert.equal(config.gatewayUrl, "http://127.0.0.1:9000");
    assert.equal(config.timeoutMs, 3000);
  });

  it("fails loud naming every missing required variable", () => {
    assert.throws(
      () => loadBridgeConfig({}),
      (error: unknown) => {
        const message = String(error);
        return message.includes("FORGEBADGER_COPILOT_BRIDGE_TOKEN") && message.includes("FORGEBADGER_USER_ID");
      },
    );
  });

  it("rejects an invalid gateway URL and a non-positive timeout", () => {
    assert.throws(
      () => loadBridgeConfig({
        FORGEBADGER_GATEWAY_URL: "not a url",
        FORGEBADGER_COPILOT_BRIDGE_TOKEN: "t",
        FORGEBADGER_USER_ID: "u",
        FORGEBADGER_BRIDGE_TIMEOUT_MS: "-5",
      }),
      /FORGEBADGER_GATEWAY_URL[\s\S]*FORGEBADGER_BRIDGE_TIMEOUT_MS/,
    );
  });
});
