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
  client?: FeishuWebSocketHandle;
  generation: number;
  failed: boolean;
  retryTimer?: unknown;
}

export class FeishuConnectionSupervisor {
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly health = new Map<string, FeishuConnectionHealth>();
  private readonly healthWrites = new Map<string, Promise<void>>();
  private readonly operations = new Map<string, number>();
  private readonly handlers = new Map<string, FeishuSdkEventHandlers>();
  private started = false;
  private lifecycle = 0;
  private stopping?: Promise<void>;

  constructor(private readonly dependencies: {
    accounts: AccountSource;
    sdkFactory: SupervisorSdkFactory;
    createHandlers?: (account: FeishuSupervisorAccount) => FeishuSdkEventHandlers;
    timers?: SupervisorTimers;
    jitter?: () => number;
  }) {}

  async start(): Promise<void> {
    if (this.started || this.stopping) return;
    this.started = true;
    const lifecycle = ++this.lifecycle;
    const accounts = await this.dependencies.accounts.listEnabled();
    if (!this.started || lifecycle !== this.lifecycle) return;
    await Promise.allSettled(accounts.map((account) => {
      // A concurrent explicit reconcile is newer than the startup snapshot.
      if (this.operations.has(account.userId)) return Promise.resolve();
      return this.reconcileAccount(account.userId);
    }));
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    let resolve!: () => void;
    this.stopping = new Promise<void>((done) => { resolve = done; });
    this.started = false;
    this.lifecycle += 1;
    const runtimes = [...this.runtimes.entries()];
    this.runtimes.clear();
    this.operations.clear();
    for (const [userId, runtime] of runtimes) {
      this.closeEntry(runtime);
      this.publishHealth(userId, { ...this.getHealth(userId), state: "stopped" });
    }
    void Promise.allSettled([...this.healthWrites.values()]).then(resolve);
    return this.stopping;
  }

  registerHandlers(userId: string, handlers: FeishuSdkEventHandlers): void {
    this.handlers.set(userId, handlers);
  }

  async reconcileAccount(userId: string): Promise<void> {
    return this.refreshAccount(userId, 0);
  }

  getHealth(userId: string): FeishuConnectionHealth {
    return this.health.get(userId) ?? disabledHealth(undefined);
  }

  private async refreshAccount(userId: string, retryAttempt: number): Promise<void> {
    if (!this.started) return;
    const lifecycle = this.lifecycle;
    const generation = (this.operations.get(userId) ?? 0) + 1;
    this.operations.set(userId, generation);
    const current = this.runtimes.get(userId);
    let account: FeishuSupervisorAccount | undefined;
    try { account = await this.dependencies.accounts.get(userId); }
    catch {
      if (this.isOperationCurrent(userId, generation, lifecycle)) {
        if (current) this.closeEntry(current);
        this.runtimes.delete(userId);
        this.publishHealth(userId, { ...this.getHealth(userId), state: "unhealthy", lastErrorMessage: "FEISHU_ACCOUNT_READ_FAILED" });
      }
      return;
    }
    if (!this.isOperationCurrent(userId, generation, lifecycle)) return;
    if (!account?.enabled || account.userId !== userId) {
      if (current) this.closeEntry(current);
      this.runtimes.delete(userId);
      this.publishHealth(userId, disabledHealth(account));
      return;
    }
    if (current && !current.failed && current.account.configRevision === account.configRevision
      && current.account.accountId === account.accountId) {
      current.generation = generation;
      return;
    }
    if (current) this.closeEntry(current);
    this.connect({ ...account }, generation, retryAttempt);
  }

  private connect(account: FeishuSupervisorAccount, generation: number, retryAttempt: number): void {
    const entry: RuntimeEntry = { account, generation, failed: false };
    this.runtimes.set(account.userId, entry);
    const callbacks = this.createCallbacks(entry, retryAttempt);
    try {
      entry.client = this.dependencies.sdkFactory.createWebSocketClient(account, callbacks, this.guardHandlers(entry));
      this.publishHealth(account.userId, {
        state: "connecting", accountId: account.accountId, configRevision: account.configRevision,
        reconnectAttempt: retryAttempt, lastConnectedAt: this.getHealth(account.userId).lastConnectedAt,
        lastErrorMessage: null
      });
      void entry.client.start().catch((error: unknown) => callbacks.onError?.(toError(error)));
    } catch (error) { this.handleTerminalError(entry, retryAttempt, toError(error)); }
  }

  private guardHandlers(entry: RuntimeEntry): FeishuSdkEventHandlers {
    const handlers = this.dependencies.createHandlers?.(entry.account) ?? this.handlers.get(entry.account.userId) ?? {};
    return {
      onMessage: (event, context) => this.isActive(entry) ? handlers.onMessage?.(event, context) : undefined,
      onCardAction: (event) => this.isActive(entry) ? handlers.onCardAction?.(event) : undefined
    };
  }

  private createCallbacks(entry: RuntimeEntry, retryAttempt: number): FeishuSdkCallbacks {
    const publish = (health: () => FeishuConnectionHealth): void => {
      if (this.isActive(entry)) this.publishHealth(entry.account.userId, health());
    };
    return {
      onReady: () => publish(() => connectedHealth(entry.account)),
      onReconnecting: () => publish(() => ({ ...this.getHealth(entry.account.userId), state: "reconnecting" })),
      onReconnected: () => publish(() => connectedHealth(entry.account)),
      onError: (error) => this.handleTerminalError(entry, retryAttempt, error)
    };
  }

  private handleTerminalError(entry: RuntimeEntry, retryAttempt: number, error: Error): void {
    if (!this.isActive(entry)) {
      // Preserve terminal failure during a configuration read without restoring authority.
      if (this.started && this.runtimes.get(entry.account.userId) === entry && !entry.failed) {
        entry.failed = true;
        this.closeEntry(entry);
      }
      return;
    }
    entry.failed = true;
    this.closeEntry(entry);
    const userId = entry.account.userId;
    const nextAttempt = retryAttempt + 1;
    this.publishHealth(userId, {
      state: "unhealthy", accountId: entry.account.accountId, configRevision: entry.account.configRevision,
      reconnectAttempt: nextAttempt, lastConnectedAt: this.getHealth(userId).lastConnectedAt,
      lastErrorMessage: redactFeishuError(error)
    });
    entry.retryTimer = this.timers.set(() => {
      if (!this.isOwned(entry)) return;
      entry.retryTimer = undefined;
      void this.refreshAccount(userId, nextAttempt).catch(() => this.reportFailure("FEISHU_RETRY_FAILED"));
    }, backoffDelay(nextAttempt, this.dependencies.jitter?.() ?? Math.random()));
  }

  private isOperationCurrent(userId: string, generation: number, lifecycle: number): boolean {
    return this.started && this.lifecycle === lifecycle && this.operations.get(userId) === generation;
  }

  private isOwned(entry: RuntimeEntry): boolean {
    return this.started && this.runtimes.get(entry.account.userId) === entry
      && this.operations.get(entry.account.userId) === entry.generation;
  }

  private isActive(entry: RuntimeEntry): boolean {
    return this.isOwned(entry) && !entry.failed;
  }

  private closeEntry(entry: RuntimeEntry): void {
    try {
      if (entry.retryTimer !== undefined) this.timers.clear(entry.retryTimer);
    } catch { this.reportFailure("FEISHU_TIMER_CLEAR_FAILED"); }
    entry.retryTimer = undefined;
    try { entry.client?.close(true); }
    catch { this.reportFailure("FEISHU_CLIENT_CLOSE_FAILED"); }
  }

  private publishHealth(userId: string, health: FeishuConnectionHealth): void {
    this.health.set(userId, health);
    const previous = this.healthWrites.get(userId) ?? Promise.resolve();
    const write = previous.then(async () => {
      if (this.health.get(userId) !== health) return;
      await this.dependencies.accounts.updateHealth(userId, health);
    }).catch(() => this.reportFailure("FEISHU_HEALTH_WRITE_FAILED"));
    this.healthWrites.set(userId, write);
    void write.then(() => { if (this.healthWrites.get(userId) === write) this.healthWrites.delete(userId); });
  }

  private reportFailure(code: string): void {
    console.error("[feishu-supervisor] lifecycle operation failed", { code });
  }

  private get timers(): SupervisorTimers {
    return this.dependencies.timers ?? defaultTimers;
  }
}

const defaultTimers: SupervisorTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
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
