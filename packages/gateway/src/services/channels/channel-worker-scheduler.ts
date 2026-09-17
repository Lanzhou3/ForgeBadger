export type ChannelWorker = (signal: AbortSignal) => Promise<unknown>;

interface SchedulerOptions {
  workers?: ChannelWorker[];
  workerIntervalMs?: number;
  drainTimeoutMs?: number;
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  onWorkerError?: (workerIndex: number) => void;
}

/** In-process scheduling only. Durable workers must additionally fence their DB claims. */
export class ChannelWorkerScheduler {
  private readonly controller = new AbortController();
  private readonly active = new Map<number, Promise<void>>();
  private readonly workers: ChannelWorker[];
  private started = false;
  private timer: unknown;
  private stopping?: Promise<void>;

  constructor(private readonly options: SchedulerOptions = {}) {
    this.workers = [...(options.workers ?? [])];
  }

  start(): void {
    if (this.started || this.controller.signal.aborted) return;
    this.started = true;
    this.timer = (this.options.setInterval ?? setInterval)(
      () => this.tick(), finiteBound(this.options.workerIntervalMs, 250, 50, 60_000)
    );
  }

  stop(cleanup: () => Promise<void> = async () => undefined): Promise<void> {
    if (this.stopping) return this.stopping;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.stopping = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    this.started = false;
    let clearError: unknown;
    try {
      if (this.timer !== undefined) {
        const clear = this.options.clearInterval ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));
        clear(this.timer);
        this.timer = undefined;
      }
    } catch (error) { clearError = error; }
    // Cleanup must run even when interval cleanup failed. Observe every rejection.
    // Fence transport ingress synchronously, before invoking reentrant abort listeners.
    let cleaning: Promise<void>;
    try { cleaning = Promise.resolve(cleanup()); }
    catch { cleaning = Promise.reject(new Error("CHANNEL_SHUTDOWN_FAILED")); }
    this.controller.abort();
    void this.drain(cleaning, clearError).then(resolve, reject);
    return this.stopping;
  }

  private tick(): void {
    if (!this.started || this.controller.signal.aborted) return;
    this.workers.forEach((worker, index) => {
      if (this.active.has(index)) return;
      const cycle = Promise.resolve().then(async () => {
        if (!this.controller.signal.aborted) await worker(this.controller.signal);
      }).catch(() => {
        try { this.options.onWorkerError?.(index); } catch { /* Reporting cannot break the scheduler. */ }
      }).finally(() => { this.active.delete(index); });
      this.active.set(index, cycle);
    });
  }

  private async drain(cleanup: Promise<void>, clearError: unknown): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("CHANNEL_SHUTDOWN_TIMEOUT")),
        finiteBound(this.options.drainTimeoutMs, 5_000, 100, 30_000));
    });
    const completed = Promise.allSettled([cleanup, ...this.active.values()]).then((results) => {
      if (clearError !== undefined) throw new Error("CHANNEL_TIMER_CLEANUP_FAILED");
      if (results.some((result) => result.status === "rejected")) throw new Error("CHANNEL_SHUTDOWN_FAILED");
    });
    try { await Promise.race([completed, deadline]); }
    finally { if (timer) clearTimeout(timer); }
  }
}

function finiteBound(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), minimum), maximum) : fallback;
}
