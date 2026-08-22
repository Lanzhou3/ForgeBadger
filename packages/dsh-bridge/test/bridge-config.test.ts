import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadBridgeConfig } from "../src/bridge-config.js";

describe("loadBridgeConfig", () => {
  it("applies defaults and accepts a complete env", () => {
    const config = loadBridgeConfig({
      OPENFORGE_COPILOT_BRIDGE_TOKEN: "token-1",
      OPENFORGE_USER_ID: "user-1",
    });
    assert.equal(config.gatewayUrl, "http://127.0.0.1:48731");
    assert.equal(config.token, "token-1");
    assert.equal(config.userId, "user-1");
    assert.equal(config.timeoutMs, 15_000);
    assert.equal(config.enableOperate, false);
  });

  it("enables operate tools only on an explicit 1/true", () => {
    const base = { OPENFORGE_COPILOT_BRIDGE_TOKEN: "t", OPENFORGE_USER_ID: "u" };
    assert.equal(loadBridgeConfig({ ...base, OPENFORGE_BRIDGE_ENABLE_OPERATE: "1" }).enableOperate, true);
    assert.equal(loadBridgeConfig({ ...base, OPENFORGE_BRIDGE_ENABLE_OPERATE: "true" }).enableOperate, true);
    assert.equal(loadBridgeConfig({ ...base, OPENFORGE_BRIDGE_ENABLE_OPERATE: "0" }).enableOperate, false);
    assert.equal(loadBridgeConfig({ ...base, OPENFORGE_BRIDGE_ENABLE_OPERATE: "yes" }).enableOperate, false);
  });

  it("strips trailing slashes from a custom gateway URL", () => {
    const config = loadBridgeConfig({
      OPENFORGE_GATEWAY_URL: "http://127.0.0.1:9000/",
      OPENFORGE_COPILOT_BRIDGE_TOKEN: "t",
      OPENFORGE_USER_ID: "u",
      OPENFORGE_BRIDGE_TIMEOUT_MS: "3000",
    });
    assert.equal(config.gatewayUrl, "http://127.0.0.1:9000");
    assert.equal(config.timeoutMs, 3000);
  });

  it("fails loud naming every missing required variable", () => {
    assert.throws(
      () => loadBridgeConfig({}),
      (error: unknown) => {
        const message = String(error);
        return message.includes("OPENFORGE_COPILOT_BRIDGE_TOKEN") && message.includes("OPENFORGE_USER_ID");
      },
    );
  });

  it("rejects an invalid gateway URL and a non-positive timeout", () => {
    assert.throws(
      () => loadBridgeConfig({
        OPENFORGE_GATEWAY_URL: "not a url",
        OPENFORGE_COPILOT_BRIDGE_TOKEN: "t",
        OPENFORGE_USER_ID: "u",
        OPENFORGE_BRIDGE_TIMEOUT_MS: "-5",
      }),
      /OPENFORGE_GATEWAY_URL[\s\S]*OPENFORGE_BRIDGE_TIMEOUT_MS/,
    );
  });
});
