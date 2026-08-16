import {
  type PortfolioSchedulerRepositoryFactory,
  type PortfolioReconciliationClaim
} from "../../db/repositories/portfolio-scheduler-repository.js";
import type { ObservationRepositoryPort, Clock, FixedGitExecutor, ProjectRootValidator } from "./observation-service.js";
import { ObservationService } from "./observation-service.js";
import { PortfolioReconciliationService } from "./reconciliation-service.js";

export interface Timer {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface PortfolioObservationRepositoryFactory {
  forUser(userId: string): ObservationRepositoryPort;
}

export interface OperationsRuntimeDependencies {
  clock: Clock;
  timer: Timer;
  schedulerFactory: PortfolioSchedulerRepositoryFactory;
  portfolioFactory: PortfolioObservationRepositoryFactory;
  observationPorts: { projectRootValidator: ProjectRootValidator; gitExecutor: FixedGitExecutor };
}

export interface OperationsRuntimeLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  recover(): Promise<void>;
}

export type OperationsRuntimeFactory = (dependencies: OperationsRuntimeDependencies) => OperationsRuntimeLifecycle;

const RECONCILIATION_TICK_MS = 15_000;

/**
 * The Phase 5 runtime owns only bounded read-only observations. Its injected
 * surface intentionally excludes State Gate, workers, sessions, models,
 * connectors, Event Bus, terminal/tmux, dispatch, and delivery ports.
 */
export class OperationsRuntime implements OperationsRuntimeLifecycle {
  private interval: unknown;
  private started = false;
  private stopped = false;
  private readonly activeAborts = new Set<AbortController>();
  private tickPromise: Promise<void> | undefined;

  constructor(private readonly dependencies: OperationsRuntimeDependencies) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.stopped = false;
    await this.recover();
    if (this.stopped) return;
    this.started = true;
    await this.tick();
    if (this.stopped) return;
    this.interval = this.dependencies.timer.setInterval(() => {
      void this.tick();
    }, RECONCILIATION_TICK_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.interval !== undefined) this.dependencies.timer.clearInterval(this.interval);
    this.interval = undefined;
    for (const controller of this.activeAborts) controller.abort();
    await this.tickPromise;
    this.started = false;
  }

  async recover(): Promise<void> {
    if (this.stopped) return;
    this.dependencies.schedulerFactory.recoverExpired(this.dependencies.clock.now());
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.tickPromise) return this.tickPromise;
    this.tickPromise = this.runTick().finally(() => {
      this.tickPromise = undefined;
    });
    return this.tickPromise;
  }

  private async runTick(): Promise<void> {
    const now = this.dependencies.clock.now();
    const userIds = this.dependencies.schedulerFactory.dueUserIds(now);
    let remainingClaims = 20;
    for (const userId of userIds) {
      if (this.stopped || remainingClaims === 0) return;
      const scheduler = this.dependencies.schedulerFactory.forUser(userId);
      scheduler.scheduleDueHeartbeat(now);
      const claims = scheduler.claimDue(now, remainingClaims);
      for (const claim of claims) {
        if (this.stopped) return;
        await this.reconcileClaim(userId, claim);
        remainingClaims -= 1;
        if (remainingClaims === 0) return;
      }
    }
  }

  private async reconcileClaim(userId: string, claim: PortfolioReconciliationClaim): Promise<void> {
    const controller = new AbortController();
    this.activeAborts.add(controller);
    try {
      const repository = this.dependencies.portfolioFactory.forUser(userId);
      const observations = new ObservationService({
        clock: this.dependencies.clock,
        projectRootValidator: this.dependencies.observationPorts.projectRootValidator,
        gitExecutor: this.dependencies.observationPorts.gitExecutor,
        repository
      });
      const scheduler = this.dependencies.schedulerFactory.forUser(userId);
      const service = new PortfolioReconciliationService({
        clock: this.dependencies.clock,
        scheduler,
        observations
      });
      await service.reconcile(claim, controller.signal);
    } finally {
      this.activeAborts.delete(controller);
    }
  }
}
