import {
  type PortfolioAcceptanceDecisionState, type PortfolioAuthorizationState, type PortfolioRequestState,
  type PortfolioStateRecordType, type PortfolioStateTransitionCommit, type PortfolioStateTransitionResult,
  type PortfolioTaskAttemptState, type PortfolioWakeupState, type PortfolioWorkItemState, PortfolioRepository
} from "../../db/repositories/portfolio-repository.js";

export type PortfolioStateGateTransition = PortfolioStateTransitionResult;
type State = PortfolioRequestState | PortfolioWorkItemState | PortfolioTaskAttemptState | PortfolioAuthorizationState | PortfolioWakeupState | PortfolioAcceptanceDecisionState;
const transitions: Record<PortfolioStateRecordType, Record<string, readonly string[]>> = { request: { received: ["triaged", "needs_owner_decision", "cancelled"], triaged: ["accepted", "declined", "needs_owner_decision", "cancelled"], needs_owner_decision: ["accepted", "declined", "cancelled"] }, work_item: { todo: ["in_progress", "cancelled"], in_progress: ["blocked", "ready_for_review", "cancelled"], blocked: ["in_progress", "cancelled"], ready_for_review: ["done", "in_progress", "cancelled"] }, task_attempt: { prepared: ["awaiting_authorization", "dispatching", "cancelled"], awaiting_authorization: ["dispatching", "cancelled"], dispatching: ["running", "awaiting_authorization", "blocked", "failed", "cancelled"], running: ["awaiting_permission", "evaluating", "blocked", "failed", "cancelled"], awaiting_permission: ["dispatching", "running", "blocked", "failed", "cancelled"], evaluating: ["succeeded", "blocked", "failed", "cancelled"] }, authorization: { proposed: ["preauthorized", "awaiting_owner", "rejected", "cancelled"], preauthorized: ["approved", "expired", "cancelled"], awaiting_owner: ["approved", "rejected", "expired", "cancelled"], approved: ["consumed", "expired", "cancelled"] }, wakeup: { scheduled: ["claimed", "cancelled"], claimed: ["completed", "retry_scheduled", "cancelled", "exhausted"], retry_scheduled: ["claimed", "cancelled", "exhausted"] }, acceptance_decision: { candidate: ["accepted", "rejected", "superseded"], rejected: ["superseded"] } };

export class PortfolioStateGate {
  readonly #commit: (input: PortfolioStateTransitionCommit) => PortfolioStateTransitionResult;
  readonly #verify: (id: string, version: number, key: string) => unknown;

  /** @internal Construct through PortfolioRepository.createStateGate(). */
  constructor(
    private readonly repository: PortfolioRepository,
    commit: (input: PortfolioStateTransitionCommit) => PortfolioStateTransitionResult,
    verify: (id: string, version: number, key: string) => unknown
  ) {
    this.#commit = commit;
    this.#verify = verify;
  }
  transition(input: Omit<PortfolioStateTransitionCommit, "fromState"> & { toState: State }): PortfolioStateGateTransition {
    if (input.recordType === "wakeup") throw new Error("PORTFOLIO_WAKEUP_SCHEDULER_REQUIRED");
    const replay = this.repository.getStateTransitionReplay(input); if (replay) return replay;
    const current = this.repository.getStateRecord(input.recordType, input.recordId);
    if (!current) throw new Error("PORTFOLIO_RECORD_NOT_FOUND"); if (current.projection_version !== input.expectedProjectionVersion) throw new Error("PORTFOLIO_STATE_CONFLICT"); if (!transitions[input.recordType][current.state]?.includes(input.toState)) throw new Error("PORTFOLIO_INVALID_TRANSITION");
    this.preconditions(input); return this.#commit({ ...input, fromState: current.state });
  }
  verifyCompletionCandidate(input: { candidateId: string; expectedProjectionVersion: number; actorId: string; policyRule: string; idempotencyKey: string }): unknown {
    const candidate = this.repository.getCompletionCandidate(input.candidateId); const workItem = candidate && this.repository.getWorkItem(candidate.workItemId);
    if (!candidate || !workItem || workItem.ownerUserId !== input.actorId || !input.policyRule) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
    if (!candidate.attemptId) throw new Error("PORTFOLIO_COMPLETION_ATTEMPT_REQUIRED");
    if (!this.repository.hasTrustedCandidateEvidence(candidate.id)) throw new Error("PORTFOLIO_COMPLETION_EVIDENCE_INSUFFICIENT");
    return this.#verify(input.candidateId, input.expectedProjectionVersion, input.idempotencyKey);
  }
  private preconditions(input: Omit<PortfolioStateTransitionCommit, "fromState">): void {
    if (input.recordType === "authorization") {
      if (input.toState === "approved" && !this.repository.canApproveAuthorization(input.recordId, input.actorId, input.now)) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
      if (input.toState === "consumed" && !this.repository.canConsumeAuthorization(input.recordId, input.actorId, input.now)) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
      return;
    }
    if (input.recordType === "acceptance_decision" && input.toState === "accepted" && !this.repository.canAcceptDecision(input.recordId, input.actorId)) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
    if (input.recordType !== "work_item") return; const w = this.repository.getWorkItem(input.recordId); if (!w) throw new Error("PORTFOLIO_RECORD_NOT_FOUND");
    if (input.toState === "cancelled" && w.ownerUserId !== input.actorId) throw new Error("PORTFOLIO_OWNER_REQUIRED");
    if (input.toState === "in_progress" && (w.state === "todo" || w.state === "blocked")) {
      if (!input.attemptId) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
      const attempt = this.repository.getTaskAttempt(input.attemptId);
      if (!attempt || attempt.projectId !== w.projectId || attempt.workItemId !== w.id) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
      if (w.state === "todo" && !this.repository.hasObservedDispatchReceipt(w.id, attempt.id)) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
      if (w.state === "blocked") { if (w.ownerUserId !== input.actorId) throw new Error("PORTFOLIO_OWNER_REQUIRED"); if (!this.repository.hasObservedDispatchReceiptSinceLastBlock(w.id, attempt.id)) throw new Error("PORTFOLIO_PRECONDITION_FAILED"); }
    }
    if (input.toState === "in_progress" && w.state === "ready_for_review" && !this.repository.hasFollowUpTaskAttempt(w.id)) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
    if (input.toState === "blocked" && !this.repository.hasBlockerEvidence(w.id)) throw new Error("PORTFOLIO_PRECONDITION_FAILED");
    if (input.toState === "ready_for_review") {
      if (!input.attemptId) throw new Error("PORTFOLIO_COMPLETION_ATTEMPT_REQUIRED");
      if (!this.repository.hasVerifiedCompletionCandidate(w.id, input.attemptId)) throw new Error("PORTFOLIO_COMPLETION_EVIDENCE_INSUFFICIENT");
    }
    if (input.toState === "done") {
      if (!input.attemptId) throw new Error("PORTFOLIO_ACCEPTANCE_ATTEMPT_REQUIRED");
      if (!this.repository.hasAcceptedDecision(w.id, input.attemptId)) throw new Error("PORTFOLIO_ACCEPTANCE_EVIDENCE_INSUFFICIENT");
    }
  }
}

export function createPortfolioStateGate(repository: PortfolioRepository, commit: (input: PortfolioStateTransitionCommit) => PortfolioStateTransitionResult, verify: (id: string, version: number, key: string) => unknown): PortfolioStateGate {
  return new PortfolioStateGate(repository, commit, verify);
}
