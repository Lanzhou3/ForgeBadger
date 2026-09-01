import type { FeishuConnectionHealth } from "./feishu-connection-supervisor.js";
import { redactFeishuError } from "./feishu-error-redaction.js";

interface FeishuRuntimeSupervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  reconcileAccount(userId: string): Promise<void>;
  getHealth(userId: string): FeishuConnectionHealth;
}

interface FeishuChannelRuntimeDependencies {
  supervisor: FeishuRuntimeSupervisor;
  workers?: Array<() => Promise<unknown>>;
  workerIntervalMs?: number;
  drainTimeoutMs?: number;
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  prepareAccount?: (userId: string) => Promise<void> | void;
}

export class FeishuChannelRuntime {
  private readonly workers: Array<() => Promise<unknown>>;
  private readonly activeCycles = new Set<Promise<unknown>>();
  private readonly setInterval: (callback: () => void, intervalMs: number) => unknown;
  private readonly clearInterval: (handle: unknown) => void;
  private intervalHandle: unknown;
  private started = false;
  private stopped = false;

  constructor(private readonly dependencies: FeishuChannelRuntimeDependencies) {
    this.workers = dependencies.workers ?? [];
    this.setInterval = dependencies.setInterval ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.clearInterval = dependencies.clearInterval ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
  }

  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    // Neither Feishu connectivity nor automation recovery may delay HTTP readiness.
    void Promise.resolve().then(() => {
      if (!this.started || this.stopped) return undefined;
      return this.dependencies.supervisor.start();
    }).catch(() => undefined);
    this.intervalHandle = this.setInterval(
      () => this.runWorkerCycle(),
      clamp(this.dependencies.workerIntervalMs ?? 250, 50, 60_000)
    );
  }

  async reconcileAccount(userId: string): Promise<void> {
    if (!this.started || this.stopped) throw new Error("FEISHU_RUNTIME_NOT_RUNNING");
    await this.dependencies.prepareAccount?.(userId);
    await this.dependencies.supervisor.reconcileAccount(userId);
  }

  getHealth(userId: string): FeishuConnectionHealth {
    const health = this.dependencies.supervisor.getHealth(userId);
    return {
      ...health,
      lastErrorMessage: health.lastErrorMessage
        ? redactFeishuError(new Error(health.lastErrorMessage))
        : null
    };
  }

  async emergencyStop(): Promise<void> {
    await this.shutdown();
  }

  async stop(): Promise<void> {
    await this.shutdown();
  }

  private runWorkerCycle(): void {
    if (!this.started || this.stopped) return;
    for (const worker of this.workers) {
      const cycle = Promise.resolve().then(worker).catch(() => undefined);
      this.activeCycles.add(cycle);
      void cycle.finally(() => this.activeCycles.delete(cycle));
    }
  }

  private async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    if (this.intervalHandle !== undefined) {
      this.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    await this.dependencies.supervisor.stop();
    await this.drainWorkers();
  }

  private async drainWorkers(): Promise<void> {
    if (!this.activeCycles.size) return;
    const timeoutMs = clamp(this.dependencies.drainTimeoutMs ?? 5_000, 100, 30_000);
    let timeout: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
      timeout.unref();
    });
    try {
      await Promise.race([Promise.allSettled([...this.activeCycles]).then(() => undefined), deadline]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}
