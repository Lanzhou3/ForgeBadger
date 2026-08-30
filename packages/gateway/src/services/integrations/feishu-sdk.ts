import * as Lark from "@larksuiteoapi/node-sdk";

export interface FeishuSdkAccountConfig {
  userId: string;
  accountId: string;
  appId: string;
  appSecret: string;
  configRevision: number;
  domain?: string | number;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  proxyAgent?: unknown;
  httpInstance?: unknown;
}

export interface FeishuSdkCallbacks {
  onReady?: () => void;
  onError?: (error: Error) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}

export interface FeishuSdkEventContext {
  botOpenId: string;
}

export interface FeishuSdkEventHandlers {
  onMessage?: (event: unknown, context: FeishuSdkEventContext) => Promise<unknown> | unknown;
  onCardAction?: (event: unknown) => Promise<unknown> | unknown;
}

export interface FeishuWebSocketHandle {
  start(): Promise<void>;
  close(force?: boolean): void;
  getConnectionStatus(): { state: string; reconnectAttempts: number };
}

interface FeishuSdkBindings {
  AppType: { SelfBuild: number };
  LoggerLevel: { warn: number };
  Client: new (options: Record<string, unknown>) => unknown;
  EventDispatcher: new (options: Record<string, unknown>) => {
    register(handlers: Record<string, unknown>): unknown;
  };
  WSClient: new (options: Record<string, unknown>) => {
    start(input: { eventDispatcher: unknown }): Promise<void>;
    close(input?: { force?: boolean }): void;
    getConnectionStatus(): { state: string; reconnectAttempts: number };
  };
  defaultHttpInstance: Lark.HttpInstance;
}

export class FeishuSdkFactory {
  private readonly botIdentityCache = new Map<string, Promise<string>>();

  constructor(private readonly sdk: FeishuSdkBindings = Lark as unknown as FeishuSdkBindings) {}

  createRestClient(config: FeishuSdkAccountConfig): unknown {
    assertCredentials(config);
    const options = this.createBaseOptions(config);
    return new this.sdk.Client({ ...options, appType: this.sdk.AppType.SelfBuild });
  }

  createWebSocketClient(
    config: FeishuSdkAccountConfig,
    callbacks: FeishuSdkCallbacks,
    handlers: FeishuSdkEventHandlers
  ): FeishuWebSocketHandle {
    assertCredentials(config);
    let client: InstanceType<FeishuSdkBindings["WSClient"]> | undefined;
    let startPromise: Promise<void> | undefined;
    let cancelStart: (() => void) | undefined;
    let closed = false;
    let generation = 0;
    let closeForce = false;
    const isActive = (expectedGeneration: number) =>
      !closed && generation === expectedGeneration;
    const requireActive = (expectedGeneration: number): void => {
      if (!isActive(expectedGeneration)) throw new Error("FEISHU_WS_HANDLE_CLOSED");
    };
    const runStart = async (expectedGeneration: number): Promise<void> => {
      const botOpenId = await this.resolveBotOpenId(config);
      requireActive(expectedGeneration);
      const nextClient = client ?? this.createUnderlyingWebSocketClient(config, callbacks);
      if (!isActive(expectedGeneration)) {
        if (!client) nextClient.close({ force: closeForce });
        throw new Error("FEISHU_WS_HANDLE_CLOSED");
      }
      client = nextClient;
      requireActive(expectedGeneration);
      await client.start({ eventDispatcher: createDispatcher(this.sdk, handlers, botOpenId) });
      requireActive(expectedGeneration);
    };
    const startClient = (expectedGeneration: number): Promise<void> => {
      const operation = runStart(expectedGeneration);
      return new Promise<void>((resolve, reject) => {
        // Intentional close/reconcile is a graceful cancellation, not a
        // connection failure for the supervisor to mark unhealthy and retry.
        const cancel = () => {
          if (cancelStart === cancel) cancelStart = undefined;
          resolve();
        };
        cancelStart = cancel;
        void operation.then(
          () => {
            if (cancelStart === cancel) cancelStart = undefined;
            resolve();
          },
          (error: unknown) => {
            if (cancelStart === cancel) cancelStart = undefined;
            reject(error);
          }
        );
      });
    };
    return {
      start: () => {
        if (closed) return Promise.reject(new Error("FEISHU_WS_HANDLE_CLOSED"));
        if (startPromise) return startPromise;
        const pending = startClient(generation);
        startPromise = pending;
        void pending.catch(() => {
          if (startPromise === pending) startPromise = undefined;
        });
        return pending;
      },
      close: (force = false) => {
        if (closed) return;
        closed = true;
        closeForce = force;
        generation += 1;
        cancelStart?.();
        client?.close({ force });
      },
      getConnectionStatus: () => client?.getConnectionStatus() ?? { state: "idle", reconnectAttempts: 0 }
    };
  }

  private createUnderlyingWebSocketClient(
    config: FeishuSdkAccountConfig,
    callbacks: FeishuSdkCallbacks
  ): InstanceType<FeishuSdkBindings["WSClient"]> {
    return new this.sdk.WSClient({
      ...this.createBaseOptions(config),
      ...callbacks,
      autoReconnect: true,
      handshakeTimeoutMs: clamp(config.handshakeTimeoutMs ?? 15_000, 1_000, 60_000),
      loggerLevel: this.sdk.LoggerLevel.warn,
      source: "openforge",
      wsConfig: { pingTimeout: 5 },
      ...(config.proxyAgent ? { agent: config.proxyAgent } : {})
    });
  }

  private resolveBotOpenId(config: FeishuSdkAccountConfig): Promise<string> {
    const cacheKey = `${config.accountId}:${config.configRevision}`;
    const cached = this.botIdentityCache.get(cacheKey);
    if (cached) return cached;
    const pending = this.fetchBotOpenId(config);
    this.botIdentityCache.set(cacheKey, pending);
    void pending.catch(() => {
      if (this.botIdentityCache.get(cacheKey) === pending) this.botIdentityCache.delete(cacheKey);
    });
    return pending;
  }

  private async fetchBotOpenId(config: FeishuSdkAccountConfig): Promise<string> {
    try {
      const client = this.createRestClient(config) as {
        request(input: { url: string; method: "GET" }): Promise<unknown>;
      };
      const response = await client.request({ url: "/open-apis/bot/v3/info", method: "GET" });
      const bot = isRecord(response) && isRecord(response.bot) ? response.bot : undefined;
      const openId = bot && typeof bot.open_id === "string" ? bot.open_id.trim() : "";
      if (openId) return openId;
    } catch {
      // The supervisor records a redacted health error and retries startup.
    }
    throw new Error("FEISHU_BOT_IDENTITY_REQUIRED");
  }

  private createBaseOptions(config: FeishuSdkAccountConfig): Record<string, unknown> {
    const requestTimeoutMs = clamp(config.requestTimeoutMs ?? 15_000, 1_000, 60_000);
    const baseHttpInstance = (config.httpInstance ?? this.sdk.defaultHttpInstance) as Lark.HttpInstance;
    // Proxy-aware HTTP instances are injected by the runtime; this wrapper enforces a bounded default timeout.
    return {
      appId: config.appId.trim(),
      appSecret: config.appSecret,
      ...(config.domain === undefined ? {} : { domain: config.domain }),
      httpInstance: withDefaultTimeout(baseHttpInstance, requestTimeoutMs)
    };
  }
}

function createDispatcher(
  sdk: FeishuSdkBindings,
  handlers: FeishuSdkEventHandlers,
  botOpenId: string
): unknown {
  const dispatcher = new sdk.EventDispatcher({ loggerLevel: sdk.LoggerLevel.warn });
  const registeredHandlers: Record<string, unknown> = {};
  if (handlers.onMessage) {
    registeredHandlers["im.message.receive_v1"] = (event: unknown) =>
      handlers.onMessage?.(event, { botOpenId });
  }
  if (handlers.onCardAction) registeredHandlers["card.action.trigger"] = handlers.onCardAction;
  dispatcher.register(registeredHandlers);
  return dispatcher;
}

function withDefaultTimeout(base: Lark.HttpInstance, timeout: number): Lark.HttpInstance {
  const options = <D>(input?: Lark.HttpRequestOptions<D>): Lark.HttpRequestOptions<D> => ({
    ...input,
    timeout: input?.timeout ?? timeout
  });
  return {
    request: (input) => base.request(options(input)),
    get: (url, input) => base.get(url, options(input)),
    delete: (url, input) => base.delete(url, options(input)),
    head: (url, input) => base.head(url, options(input)),
    options: (url, input) => base.options(url, options(input)),
    post: (url, data, input) => base.post(url, data, options(input)),
    put: (url, data, input) => base.put(url, data, options(input)),
    patch: (url, data, input) => base.patch(url, data, options(input))
  };
}

function assertCredentials(config: FeishuSdkAccountConfig): void {
  if (!config.appId.trim() || !config.appSecret) throw new Error("FEISHU_CREDENTIALS_REQUIRED");
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return maximum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
