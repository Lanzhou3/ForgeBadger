import { ChannelWorkerScheduler, type ChannelWorker } from "../channels/channel-worker-scheduler.js";
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
  workers?: ChannelWorker[];
  workerIntervalMs?: number;
  drainTimeoutMs?: number;
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  prepareAccount?: (userId: string) => Promise<void> | void;
}

export class FeishuChannelRuntime {
  private readonly scheduler: ChannelWorkerScheduler;
  private started = false;
  private stopped = false;

  constructor(private readonly dependencies: FeishuChannelRuntimeDependencies) {
    this.scheduler = new ChannelWorkerScheduler({
      ...dependencies,
      onWorkerError: (workerIndex) => console.error("[feishu-runtime] worker failed", {
        code: "FEISHU_WORKER_FAILED", workerIndex
      })
    });
  }

  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    // Neither Feishu connectivity nor automation recovery may delay HTTP readiness.
    void Promise.resolve().then(() => {
      if (!this.started || this.stopped) return undefined;
      return this.dependencies.supervisor.start();
    }).catch(() => {
      console.error("[feishu-runtime] supervisor startup failed", { code: "FEISHU_SUPERVISOR_START_FAILED" });
    });
    this.scheduler.start();
  }

  async reconcileAccount(userId: string): Promise<void> {
    if (!this.started || this.stopped) throw new Error("FEISHU_RUNTIME_NOT_RUNNING");
    await this.dependencies.prepareAccount?.(userId);
    if (!this.started || this.stopped) throw new Error("FEISHU_RUNTIME_NOT_RUNNING");
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

  private shutdown(): Promise<void> {
    this.stopped = true;
    this.started = false;
    return this.scheduler.stop(() => this.dependencies.supervisor.stop());
  }
}
