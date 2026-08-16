import type { PortfolioEvidence } from "../../db/repositories/portfolio-repository.js";
import {
  type PortfolioReconciliationClaim,
  type PortfolioSchedulerRepository
} from "../../db/repositories/portfolio-scheduler-repository.js";
import type { Clock, ObservationCollectionResult, ObservationService } from "./observation-service.js";

/**
 * Reconciliation only produces read-only collection drafts. Scheduler
 * finalization owns the atomic Evidence/Risk/fact/ledger transition.
 */
export class PortfolioReconciliationService {
  constructor(private readonly dependencies: {
    clock: Clock;
    scheduler: PortfolioSchedulerRepository;
    observations: Pick<ObservationService, "collect">;
  }) {}

  recover(): PortfolioReconciliationClaim[] {
    return this.dependencies.scheduler.recoverExpired(this.dependencies.clock.now());
  }

  async reconcile(claim: PortfolioReconciliationClaim, signal?: AbortSignal): Promise<{
    status: "completed" | "retry_scheduled" | "exhausted";
    evidence: PortfolioEvidence[];
  }> {
    const projectIds = claim.projectId ? [claim.projectId] : this.dependencies.scheduler.listObservableProjectIds();
    const results = await this.collectProjectSources(projectIds, signal);
    if (results.length === 0) {
      throw new Error("PORTFOLIO_RECONCILIATION_NO_OBSERVABLE_PROJECT");
    }
    return this.dependencies.scheduler.finalizeClaim({
      claim,
      drafts: results.map((result) => result.draft),
      now: this.dependencies.clock.now()
    });
  }

  private async collectProjectSources(projectIds: string[], signal?: AbortSignal): Promise<ObservationCollectionResult[]> {
    const results: ObservationCollectionResult[] = [];
    for (const projectId of projectIds) {
      for (const source of ["platform_lifecycle_v1", "git_state_v1"] as const) {
        results.push(await this.dependencies.observations.collect({ projectId, source, rootRef: "project_root", argumentsJson: {} }, signal));
      }
    }
    return results;
  }
}
