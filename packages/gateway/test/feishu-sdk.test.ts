import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactFeishuError } from "../src/services/integrations/feishu-error-redaction.js";
import { FeishuSdkFactory } from "../src/services/integrations/feishu-sdk.js";

describe("FeishuSdkFactory", () => {
  it("rejects missing credentials before constructing SDK clients", () => {
    const factory = new FeishuSdkFactory(fakeSdk().sdk);

    assert.throws(
      () => factory.createRestClient(accountConfig({ appSecret: "" })),
      /FEISHU_CREDENTIALS_REQUIRED/
    );
    assert.throws(
      () => factory.createWebSocketClient(accountConfig({ appId: "" }), {}, {}),
      /FEISHU_CREDENTIALS_REQUIRED/
    );
  });

  it("constructs official REST and WS clients with bounded safe options", async () => {
    const fixture = fakeSdk();
    const factory = new FeishuSdkFactory(fixture.sdk);
    const config = accountConfig({ requestTimeoutMs: 12_000, handshakeTimeoutMs: 8_000 });

    factory.createRestClient(config);
    const session = factory.createWebSocketClient(config, {}, {
      onMessage: async () => undefined,
      onCardAction: async () => undefined
    });
    await session.start();

    assert.equal(fixture.restOptions[0]?.appId, "cli_test");
    assert.equal(fixture.restOptions[0]?.appType, 0);
    const httpInstance = fixture.restOptions[0]?.httpInstance as {
      request(options: Record<string, unknown>): Promise<unknown>;
    };
    await httpInstance.request({ url: "https://open.feishu.cn/open-apis/test" });
    assert.equal(fixture.httpRequests[0]?.timeout, 12_000);
    assert.equal(fixture.wsOptions[0]?.handshakeTimeoutMs, 8_000);
    assert.equal((fixture.wsOptions[0]?.wsConfig as { pingTimeout?: number }).pingTimeout, 5);
    assert.deepEqual(fixture.registeredEvents, ["card.action.trigger", "im.message.receive_v1"]);
    assert.equal(fixture.startCount, 1);
  });

  it("clamps unsafe timeout values and forwards an injected proxy agent", () => {
    const fixture = fakeSdk();
    const factory = new FeishuSdkFactory(fixture.sdk);
    const proxyAgent = { name: "proxy-agent" };

    factory.createWebSocketClient(accountConfig({
      requestTimeoutMs: 1,
      handshakeTimeoutMs: 999_999,
      proxyAgent
    }), {}, {});

    assert.equal(fixture.wsOptions[0]?.handshakeTimeoutMs, 60_000);
    assert.equal(fixture.wsOptions[0]?.agent, proxyAgent);
  });
});

describe("redactFeishuError", () => {
  it("removes credentials, bearer tokens, control characters, and bounds length", () => {
    const error = new Error(
      `authorization=Bearer abc.def\napp_secret=super-secret token=tenant-token ${"x".repeat(900)}`
    );

    const safe = redactFeishuError(error);

    assert.doesNotMatch(safe, /abc\.def|super-secret|tenant-token/);
    assert.doesNotMatch(safe, /[\r\n\u0000-\u001f]/);
    assert.ok(safe.length <= 503);
    assert.match(safe, /\[REDACTED\]/);
  });
});

function accountConfig(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    accountId: "account-1",
    appId: "cli_test",
    appSecret: "app-secret",
    configRevision: 1,
    requestTimeoutMs: 10_000,
    handshakeTimeoutMs: 10_000,
    ...overrides
  };
}

function fakeSdk() {
  const restOptions: Array<Record<string, unknown>> = [];
  const wsOptions: Array<Record<string, unknown>> = [];
  const registeredEvents: string[] = [];
  const httpRequests: Array<Record<string, unknown>> = [];
  let startCount = 0;

  class Client {
    constructor(options: Record<string, unknown>) {
      restOptions.push(options);
    }
  }
  class EventDispatcher {
    register(handlers: Record<string, unknown>) {
      registeredEvents.push(...Object.keys(handlers).sort());
      return this;
    }
  }
  class WSClient {
    constructor(options: Record<string, unknown>) {
      wsOptions.push(options);
    }
    async start() {
      startCount += 1;
    }
    close() {}
    getConnectionStatus() {
      return { state: "idle", reconnectAttempts: 0 };
    }
  }

  return {
    sdk: {
      AppType: { SelfBuild: 0 },
      LoggerLevel: { warn: 2 },
      Client,
      EventDispatcher,
      WSClient,
      defaultHttpInstance: {
        request: async (options: Record<string, unknown>) => { httpRequests.push(options); },
        get: async () => undefined,
        delete: async () => undefined,
        head: async () => undefined,
        options: async () => undefined,
        post: async () => undefined,
        put: async () => undefined,
        patch: async () => undefined
      }
    },
    restOptions,
    wsOptions,
    registeredEvents,
    httpRequests,
    get startCount() { return startCount; }
  };
}
