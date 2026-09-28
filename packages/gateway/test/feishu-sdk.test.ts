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
    let reconnecting = 0;
    let reconnected = 0;

    factory.createRestClient(config);
    const session = factory.createWebSocketClient(config, {
      onReconnecting: () => { reconnecting += 1; },
      onReconnected: () => { reconnected += 1; }
    }, {
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
    assert.deepEqual(fixture.identityRequests, [{ url: "/open-apis/bot/v3/info", method: "GET" }]);
    assert.deepEqual(session.getConnectionStatus(), { state: "connected", reconnectAttempts: 2 });
    (fixture.wsOptions[0]?.onReconnecting as (() => void) | undefined)?.();
    (fixture.wsOptions[0]?.onReconnected as (() => void) | undefined)?.();
    assert.deepEqual({ reconnecting, reconnected }, { reconnecting: 1, reconnected: 1 });
    session.close(true);
    assert.deepEqual(fixture.closeInputs, [{ force: true }]);
  });

  it("does not construct or start WS until bot identity succeeds, then retries identity", async () => {
    // Arrange
    const fixture = fakeSdk([new Error("identity unavailable"), { bot: { open_id: "ou_bot_retry" } }]);
    const factory = new FeishuSdkFactory(fixture.sdk);
    const session = factory.createWebSocketClient(accountConfig(), {}, {});

    // Act + Assert
    assert.deepEqual(session.getConnectionStatus(), { state: "idle", reconnectAttempts: 0 });
    await assert.rejects(() => session.start(), /FEISHU_BOT_IDENTITY_REQUIRED/u);
    assert.equal(fixture.identityFetchCount, 1);
    assert.equal(fixture.wsOptions.length, 0);
    assert.equal(fixture.startCount, 0);

    await session.start();
    assert.equal(fixture.identityFetchCount, 2);
    assert.equal(fixture.wsOptions.length, 1);
    assert.equal(fixture.startCount, 1);
  });

  it("cancels an in-flight identity-first start when the handle is closed", async () => {
    // Arrange
    const identity = deferred<unknown>();
    const fixture = fakeSdk([identity.promise]);
    const factory = new FeishuSdkFactory(fixture.sdk);
    const session = factory.createWebSocketClient(accountConfig(), {}, {});

    // Act
    const starting = session.start();
    session.close(true);
    await assert.doesNotReject(starting);
    identity.resolve({ bot: { open_id: "ou_too_late" } });
    await new Promise((resolve) => setImmediate(resolve));

    // Assert
    assert.equal(fixture.identityFetchCount, 1);
    assert.equal(fixture.wsOptions.length, 0);
    assert.equal(fixture.startCount, 0);
    assert.equal(fixture.closeCount, 0);
    assert.deepEqual(session.getConnectionStatus(), { state: "idle", reconnectAttempts: 0 });
    await assert.rejects(() => session.start(), /FEISHU_WS_HANDLE_CLOSED/u);
  });

  it("caches bot identity by account and config revision", async () => {
    // Arrange
    const fixture = fakeSdk([
      { bot: { open_id: "ou_bot_rev_1" } },
      { bot: { open_id: "ou_bot_rev_2" } }
    ]);
    const factory = new FeishuSdkFactory(fixture.sdk);

    // Act
    await factory.createWebSocketClient(accountConfig(), {}, {}).start();
    await factory.createWebSocketClient(accountConfig(), {}, {}).start();
    await factory.createWebSocketClient(accountConfig({ configRevision: 2 }), {}, {}).start();

    // Assert
    assert.equal(fixture.identityFetchCount, 2);
    assert.equal(fixture.startCount, 3);
  });

  it("coalesces concurrent starts on the same handle", async () => {
    // Arrange
    const identity = deferred<unknown>();
    const fixture = fakeSdk([identity.promise]);
    const session = new FeishuSdkFactory(fixture.sdk)
      .createWebSocketClient(accountConfig(), {}, {});

    // Act
    const first = session.start();
    const second = session.start();
    identity.resolve({ bot: { open_id: "ou_concurrent" } });
    await Promise.all([first, second]);

    // Assert
    assert.equal(first, second);
    assert.equal(fixture.identityFetchCount, 1);
    assert.equal(fixture.wsOptions.length, 1);
    assert.equal(fixture.startCount, 1);
  });

  it("passes the resolved bot open id to message handlers without awaiting identity in the callback", async () => {
    // Arrange
    const fixture = fakeSdk([{ bot: { open_id: "ou_exact_bot" } }]);
    const factory = new FeishuSdkFactory(fixture.sdk);
    let receivedContext: unknown;
    const session = factory.createWebSocketClient(accountConfig(), {}, {
      onMessage: (_event, context) => {
        receivedContext = context;
      }
    });
    await session.start();

    // Act
    const handler = fixture.registeredHandlers["im.message.receive_v1"] as
      | ((event: unknown) => unknown)
      | undefined;
    assert.ok(handler);
    handler({ event: "message" });

    // Assert
    assert.deepEqual(receivedContext, { botOpenId: "ou_exact_bot" });
  });

  it("clamps unsafe timeout values and forwards an injected proxy agent", async () => {
    const fixture = fakeSdk();
    const factory = new FeishuSdkFactory(fixture.sdk);
    const proxyAgent = { name: "proxy-agent" };

    const session = factory.createWebSocketClient(accountConfig({
      requestTimeoutMs: 1,
      handshakeTimeoutMs: 999_999,
      proxyAgent
    }), {}, {});
    await session.start();

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

function fakeSdk(identityResponses: Array<unknown | Error> = [{ bot: { open_id: "ou_bot" } }]) {
  const restOptions: Array<Record<string, unknown>> = [];
  const wsOptions: Array<Record<string, unknown>> = [];
  const registeredEvents: string[] = [];
  const registeredHandlers: Record<string, unknown> = {};
  const httpRequests: Array<Record<string, unknown>> = [];
  const identityRequests: Array<Record<string, unknown>> = [];
  const closeInputs: Array<{ force?: boolean } | undefined> = [];
  let startCount = 0;
  let closeCount = 0;
  let identityFetchCount = 0;

  class Client {
    constructor(options: Record<string, unknown>) {
      restOptions.push(options);
    }
    async request(input: Record<string, unknown>) {
      identityFetchCount += 1;
      identityRequests.push(input);
      const response = identityResponses.shift() ?? { bot: { open_id: "ou_bot" } };
      if (response instanceof Error) throw response;
      return response;
    }
  }
  class EventDispatcher {
    register(handlers: Record<string, unknown>) {
      registeredEvents.push(...Object.keys(handlers).sort());
      Object.assign(registeredHandlers, handlers);
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
    close(input?: { force?: boolean }) {
      closeCount += 1;
      closeInputs.push(input);
    }
    getConnectionStatus() {
      return { state: "connected", reconnectAttempts: 2 };
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
    registeredHandlers,
    httpRequests,
    identityRequests,
    closeInputs,
    get startCount() { return startCount; },
    get closeCount() { return closeCount; },
    get identityFetchCount() { return identityFetchCount; }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
