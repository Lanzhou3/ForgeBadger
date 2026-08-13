import type {
  CopilotAutomation,
  CopilotAutomationRun
} from "../../db/repositories/copilot-automation-repository.js";
import {
  fromStoredAutomationSchedule,
  nextAutomationRunAt
} from "./automation-types.js";

export interface AutomationSchedulerRepository {
  list(): CopilotAutomation[];
  get(id: string): CopilotAutomation | undefined;
  updateWithRevision(
    id: string,
    expectedRevision: number,
    patch: { status?: string; nextRunAt?: Date | null }
  ): CopilotAutomation;
  createOrGetRun(automationId: string, scheduledSlot: string, triggerKind: string): CopilotAutomationRun;
  claimDueRun(now?: Date, leaseMs?: number): CopilotAutomationRun | undefined;
}

interface SchedulerOptions {
  now?: () => Date;
  catchUpLimit?: number;
  maxConcurrentRuns?: number;
  leaseMs?: number;
  minimumTimerDelayMs?: number;
  run?: (runId: string) => Promise<void>;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class CopilotAutomationScheduler {
  private readonly now: () => Date;
  private readonly catchUpLimit: number;
  private readonly maxConcurrentRuns: number;
  private readonly leaseMs: number;
  private readonly minimumTimerDelayMs: number;
  private readonly run: (runId: string) => Promise<void>;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private timer: unknown;
  private started = false;
  private reconciling: Promise<void> | undefined;

  constructor(private readonly repository: AutomationSchedulerRepository, options: SchedulerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.catchUpLimit = clamp(options.catchUpLimit ?? 3, 1, 20);
    this.maxConcurrentRuns = clamp(options.maxConcurrentRuns ?? 2, 1, 8);
    this.leaseMs = clamp(options.leaseMs ?? 60_000, 5_000, 10 * 60_000);
    this.minimumTimerDelayMs = clamp(options.minimumTimerDelayMs ?? 1_000, 100, 60_000);
    this.run = options.run ?? (async () => undefined);
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.reconcile();
  }

  stop(): void {
    this.started = false;
    this.disarm();
  }

  isArmed(): boolean {
    return this.timer !== undefined;
  }

  reconcile(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.disarm();
    this.reconciling = this.performReconcile().finally(() => {
      this.reconciling = undefined;
      // Tests may invoke reconcile before start; arming still proves recovery behavior.
      this.armNextTimer();
    });
    return this.reconciling;
  }

  async runNow(automationId: string): Promise<CopilotAutomationRun> {
    const automation = this.repository.get(automationId);
    if (!automation) throw new Error("AUTOMATION_NOT_FOUND");
    if (automation.status === "deleted") throw new Error("AUTOMATION_NOT_RUNNABLE");
    const slot = `manual:${this.now().toISOString()}`;
    const run = this.repository.createOrGetRun(automationId, slot, "manual");
    await this.run(run.id);
    return run;
  }

  private async performReconcile(): Promise<void> {
    const now = this.now();
    for (const automation of this.repository.list()) {
      if (automation.status !== "active" || !automation.nextRunAt) continue;
      this.enqueueCatchUp(automation, now);
    }
    await this.drain(now);
  }

  private enqueueCatchUp(initial: CopilotAutomation, now: Date): void {
    let automation = initial;
    let emitted = 0;
    while (automation.nextRunAt && automation.nextRunAt <= now && emitted < this.catchUpLimit) {
      const slot = automation.nextRunAt;
      this.repository.createOrGetRun(automation.id, slot.toISOString(), "scheduled");
      const schedule = fromStoredAutomationSchedule(automation);
      const nextRunAt = nextAutomationRunAt(schedule, slot);
      automation = this.repository.updateWithRevision(automation.id, automation.revision, {
        nextRunAt,
        ...(nextRunAt ? {} : { status: "completed" })
      });
      emitted += 1;
    }
  }

  private async drain(now: Date): Promise<void> {
    const claimed: CopilotAutomationRun[] = [];
    while (claimed.length < this.maxConcurrentRuns) {
      // claimDueRun also returns expired leases to pending before claiming them.
      const run = this.repository.claimDueRun(now, this.leaseMs);
      if (!run) break;
      claimed.push(run);
    }
    await Promise.allSettled(claimed.map((item) => this.run(item.id)));
  }

  private armNextTimer(): void {
    const now = this.now().getTime();
    const next = this.repository.list()
      .filter((automation) => automation.status === "active" && automation.nextRunAt)
      .map((automation) => automation.nextRunAt!.getTime())
      .sort((left, right) => left - right)[0];
    if (next === undefined) return;
    const delay = Math.max(this.minimumTimerDelayMs, next - now);
    this.timer = this.setTimer(() => { void this.reconcile(); }, delay);
  }

  private disarm(): void {
    if (this.timer === undefined) return;
    this.clearTimer(this.timer);
    this.timer = undefined;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}
