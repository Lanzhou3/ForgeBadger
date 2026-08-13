import { redactFeishuError } from "./feishu-error-redaction.js";
import type {
  FeishuSdkCallbacks,
  FeishuSdkEventHandlers,
  FeishuWebSocketHandle
} from "./feishu-sdk.js";

export interface FeishuSupervisorAccount {
  userId: string;
  accountId: string;
  appId: string;
  appSecret: string;
  enabled: boolean;
  configRevision: number;
}

export interface FeishuConnectionHealth {
  state: "disabled" | "connecting" | "connected" | "reconnecting" | "unhealthy" | "stopped";
  accountId: string | null;
  configRevision: number | null;
  reconnectAttempt: number;
  lastConnectedAt: Date | null;
  lastErrorMessage: string | null;
}

interface AccountSource {
  listEnabled(): FeishuSupervisorAccount[] | Promise<FeishuSupervisorAccount[]>;
  get(userId: string): FeishuSupervisorAccount | undefined | Promise<FeishuSupervisorAccount | undefined>;
  updateHealth(userId: string, health: FeishuConnectionHealth): void | Promise<void>;
}

interface SupervisorSdkFactory {
  createWebSocketClient(
    config: FeishuSupervisorAccount,
    callbacks: FeishuSdkCallbacks,
    handlers: FeishuSdkEventHandlers
  ): FeishuWebSocketHandle;
}

interface SupervisorTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(timer: unknown): void;
}

interface RuntimeEntry {
  account: FeishuSupervisorAccount;
  client: FeishuWebSocketHandle;
  retryAttempt: number;
  retryTimer?: unknown;
}

export class FeishuConnectionSupervisor {
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly health = new Map<string, FeishuConnectionHealth>();
  private readonly handlers = new Map<string, FeishuSdkEventHandlers>();
  private started = false;

  constructor(private readonly dependencies: {
    accounts: AccountSource;
    sdkFactory: SupervisorSdkFactory;
    timers?: SupervisorTimers;
    jitter?: () => number;
  }) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const accounts = await this.dependencies.accounts.listEnabled();
    // Connection attempts are detached so Feishu availability never gates Gateway readiness.
    for (const account of accounts) await this.connect(account, 0);
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const [userId, runtime] of this.runtimes) {
      if (runtime.retryTimer !== undefined) this.timers.clear(runtime.retryTimer);
      runtime.client.close(true);
      await this.publishHealth(userId, {
        ...this.getHealth(userId),
        state: "stopped"
      });
    }
    this.runtimes.clear();
  }

  registerHandlers(userId: string, handlers: FeishuSdkEventHandlers): void {
    this.handlers.set(userId, handlers);
  }

  async reconcileAccount(userId: string): Promise<void> {
    const account = await this.dependencies.accounts.get(userId);
    const current = this.runtimes.get(userId);
    if (!account?.enabled) {
      if (current?.retryTimer !== undefined) this.timers.clear(current.retryTimer);
      current?.client.close(true);
      this.runtimes.delete(userId);
      await this.publishHealth(userId, disabledHealth(account));
      return;
    }
    if (current?.account.configRevision === account.configRevision) return;
    if (current?.retryTimer !== undefined) this.timers.clear(current.retryTimer);
    current?.client.close(true);
    await this.connect(account, 0);
  }

  getHealth(userId: string): FeishuConnectionHealth {
    return this.health.get(userId) ?? disabledHealth(undefined);
  }

  private async connect(account: FeishuSupervisorAccount, retryAttempt: number): Promise<void> {
    if (!this.started) return;
    try {
      const callbacks = this.createCallbacks(account, retryAttempt);
      const client = this.dependencies.sdkFactory.createWebSocketClient(
        account,
        callbacks,
        this.handlers.get(account.userId) ?? {}
      );
      this.runtimes.set(account.userId, { account: { ...account }, client, retryAttempt });
      await this.publishHealth(account.userId, {
        state: "connecting",
        accountId: account.accountId,
        configRevision: account.configRevision,
        reconnectAttempt: retryAttempt,
        lastConnectedAt: this.getHealth(account.userId).lastConnectedAt,
        lastErrorMessage: null
      });
      void client.start().catch((error: unknown) => callbacks.onError?.(toError(error)));
    } catch (error) {
      await this.handleTerminalError(account, retryAttempt, toError(error), false);
    }
  }

  private createCallbacks(account: FeishuSupervisorAccount, retryAttempt: number): FeishuSdkCallbacks {
    return {
      onReady: () => void this.publishHealth(account.userId, connectedHealth(account)),
      onReconnecting: () => void this.publishHealth(account.userId, {
        ...this.getHealth(account.userId),
        state: "reconnecting"
      }),
      onReconnected: () => void this.publishHealth(account.userId, connectedHealth(account)),
      onError: (error) => void this.handleTerminalError(account, retryAttempt, error, true)
    };
  }

  private async handleTerminalError(
    account: FeishuSupervisorAccount,
    retryAttempt: number,
    error: Error,
    closeClient: boolean
  ): Promise<void> {
    if (!this.started) return;
    const runtime = this.runtimes.get(account.userId);
    if (closeClient) runtime?.client.close(true);
    const nextAttempt = retryAttempt + 1;
    await this.publishHealth(account.userId, {
      state: "unhealthy",
      accountId: account.accountId,
      configRevision: account.configRevision,
      reconnectAttempt: nextAttempt,
      lastConnectedAt: this.getHealth(account.userId).lastConnectedAt,
      lastErrorMessage: redactFeishuError(error)
    });
    const timer = this.timers.set(() => {
      if (!this.started) return;
      void this.connect(account, nextAttempt);
    }, backoffDelay(nextAttempt, this.dependencies.jitter?.() ?? Math.random()));
    if (runtime) runtime.retryTimer = timer;
    else this.runtimes.set(account.userId, {
      account: { ...account },
      client: noOpClient,
      retryAttempt: nextAttempt,
      retryTimer: timer
    });
  }

  private async publishHealth(userId: string, health: FeishuConnectionHealth): Promise<void> {
    this.health.set(userId, health);
    await this.dependencies.accounts.updateHealth(userId, health);
  }

  private get timers(): SupervisorTimers {
    return this.dependencies.timers ?? defaultTimers;
  }
}

const defaultTimers: SupervisorTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
};

const noOpClient: FeishuWebSocketHandle = {
  start: async () => undefined,
  close: () => undefined,
  getConnectionStatus: () => ({ state: "idle", reconnectAttempts: 0 })
};

function disabledHealth(account: FeishuSupervisorAccount | undefined): FeishuConnectionHealth {
  return {
    state: "disabled",
    accountId: account?.accountId ?? null,
    configRevision: account?.configRevision ?? null,
    reconnectAttempt: 0,
    lastConnectedAt: null,
    lastErrorMessage: null
  };
}

function connectedHealth(account: FeishuSupervisorAccount): FeishuConnectionHealth {
  return {
    state: "connected",
    accountId: account.accountId,
    configRevision: account.configRevision,
    reconnectAttempt: 0,
    lastConnectedAt: new Date(),
    lastErrorMessage: null
  };
}

function backoffDelay(attempt: number, jitter: number): number {
  const base = Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 30_000);
  const boundedJitter = Math.max(0, Math.min(1, jitter));
  return Math.round(base + base * 0.2 * boundedJitter);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
