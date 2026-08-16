import type { PortfolioEvidence } from "../../db/repositories/portfolio-repository.js";

export interface RiskSignalRepositoryPort {
  createRiskSignal(input: {
    projectId: string;
    evidenceId?: string;
    severity: "low" | "medium" | "high";
    rationale: string;
    idempotencyKey: string;
  }): unknown;
}

/** Risk records are advisory only: this service has no State Gate dependency. */
export class RiskSignalService {
  constructor(private readonly repository: RiskSignalRepositoryPort) {}

  createFromObservationFailure(input: { evidence: PortfolioEvidence; errorCode: string }): void {
    this.repository.createRiskSignal({
      projectId: input.evidence.projectId,
      evidenceId: input.evidence.id,
      severity: "medium",
      rationale: `Bounded observation failed: ${input.errorCode}`,
      idempotencyKey: `observation-risk:${input.evidence.id}`
    });
  }
}
