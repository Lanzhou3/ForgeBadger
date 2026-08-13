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

export interface FeishuSdkEventHandlers {
  onMessage?: (event: unknown) => Promise<unknown> | unknown;
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
    const dispatcher = new this.sdk.EventDispatcher({ loggerLevel: this.sdk.LoggerLevel.warn });
    const registeredHandlers: Record<string, unknown> = {};
    if (handlers.onMessage) registeredHandlers["im.message.receive_v1"] = handlers.onMessage;
    if (handlers.onCardAction) registeredHandlers["card.action.trigger"] = handlers.onCardAction;
    dispatcher.register(registeredHandlers);

    const client = new this.sdk.WSClient({
      ...this.createBaseOptions(config),
      ...callbacks,
      autoReconnect: true,
      handshakeTimeoutMs: clamp(config.handshakeTimeoutMs ?? 15_000, 1_000, 60_000),
      loggerLevel: this.sdk.LoggerLevel.warn,
      source: "openforge",
      wsConfig: { pingTimeout: 5 },
      ...(config.proxyAgent ? { agent: config.proxyAgent } : {})
    });
    return {
      start: () => client.start({ eventDispatcher: dispatcher }),
      close: (force = false) => client.close({ force }),
      getConnectionStatus: () => client.getConnectionStatus()
    };
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
