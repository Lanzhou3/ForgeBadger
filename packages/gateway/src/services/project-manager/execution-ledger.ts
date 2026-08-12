import { createHash, randomUUID } from "node:crypto";

import {
  ProjectManagerExecutionRepository,
  type ProjectManagerAttemptDesiredState,
  type ProjectManagerAttemptObservedState,
  type ProjectManagerTaskAttempt
} from "../../db/repositories/project-manager-execution-repository.js";
import type { Database } from "../../db/types.js";

export type ProjectManagerAttemptAction =
  | "dispatch"
  | "worker_ready"
  | "permission_requested"
  | "permission_resolved"
  | "completion_candidate"
  | "acceptance_passed"
  | "blocked"
  | "failed"
  | "cancel";

export type ProjectManagerBudget = "reconcile" | "decision" | "follow_up" | "retry";

export interface ProjectManagerExecutionLimits {
  maxReconcile: number;
  maxDecision: number;
  maxFollowUp: number;
  maxRetry: number;
}

const defaultLimits: ProjectManagerExecutionLimits = {
  maxReconcile: 100,
  maxDecision: 20,
  maxFollowUp: 5,
  maxRetry: 3
};

const transitions: Record<
  ProjectManagerAttemptAction,
  Partial<Record<ProjectManagerAttemptObservedState, {
    desiredState?: ProjectManagerAttemptDesiredState;
    observedState: ProjectManagerAttemptObservedState;
  }>>
> = {
  dispatch: { prepared: { desiredState: "running", observedState: "dispatching" } },
  worker_ready: { dispatching: { observedState: "running" } },
  permission_requested: { running: { observedState: "waiting_for_permission" } },
  permission_resolved: { waiting_for_permission: { observedState: "running" } },
  completion_candidate: { running: { observedState: "evaluating" } },
  acceptance_passed: { evaluating: { observedState: "succeeded" } },
  blocked: {},
  failed: {},
  cancel: {}
};

const nonTerminalStates: ProjectManagerAttemptObservedState[] = [
  "prepared",
  "dispatching",
  "running",
  "waiting_for_permission",
  "evaluating"
];

for (const state of nonTerminalStates) {
  transitions.blocked[state] = { observedState: "blocked" };
  transitions.failed[state] = { observedState: "failed" };
  transitions.cancel[state] = { desiredState: "cancelled", observedState: "cancelled" };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function buildDeterministicTaskPacket<T extends Record<string, unknown>>(input: T): T {
  return canonicalize(input) as T;
}

export function digestTaskPacket(taskPacket: Record<string, unknown>): string {
  const canonicalPacket = buildDeterministicTaskPacket(taskPacket);
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalPacket)).digest("hex")}`;
}

export function calculateBoundedBackoff(
  attemptNumber: number,
  baseDelayMs: number,
  ceilingMs: number
): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("BACKOFF_ATTEMPT_INVALID");
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 1) throw new Error("BACKOFF_BASE_INVALID");
  if (!Number.isFinite(ceilingMs) || ceilingMs < baseDelayMs) throw new Error("BACKOFF_CEILING_INVALID");
  return Math.min(baseDelayMs * (2 ** (attemptNumber - 1)), ceilingMs);
}

export class ProjectManagerExecutionLedgerService {
  private readonly repository: ProjectManagerExecutionRepository;
  private readonly limits: ProjectManagerExecutionLimits;

  constructor(
    private readonly db: Database,
    private readonly userId: string,
    limits: Partial<ProjectManagerExecutionLimits> = {}
  ) {
    this.repository = new ProjectManagerExecutionRepository(db, userId);
    this.limits = { ...defaultLimits, ...limits };
  }

  prepare(input: {
    projectId: string;
    workItemId: string;
    sourceVersion: number;
    taskPacket: Record<string, unknown>;
    deadlineAt?: Date | null;
  }): ProjectManagerTaskAttempt {
    const taskPacket = buildDeterministicTaskPacket(input.taskPacket);
    return this.repository.createOrReusePreparedAttempt({
      projectId: input.projectId,
      workItemId: input.workItemId,
      inputVersion: input.sourceVersion,
      inputDigest: digestTaskPacket(taskPacket),
      ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {})
    });
  }

  transition(
    attemptId: string,
    action: ProjectManagerAttemptAction,
    failure: { failureCode?: string | null; failureMessage?: string | null } = {}
  ): ProjectManagerTaskAttempt {
    const attempt = this.requireAttempt(attemptId);
    const next = transitions[action][attempt.observedState];
    if (!next) throw new Error("ATTEMPT_TRANSITION_INVALID");

    const apply = this.db.transaction(() => {
      const updated = this.repository.compareAndSwapAttempt(attemptId, {
        expectedObservedState: attempt.observedState,
        observedState: next.observedState,
        ...(next.desiredState !== undefined ? { desiredState: next.desiredState } : {}),
        ...(failure.failureCode !== undefined ? { failureCode: failure.failureCode } : {}),
        ...(failure.failureMessage !== undefined ? { failureMessage: failure.failureMessage } : {})
      });
      // Human-readable events are projections; the attempt row remains the authoritative state.
      this.db.prepare(`
        INSERT INTO project_manager_ledger_events (
          id, user_id, project_id, work_item_id, event_type, status,
          evidence_refs_json, feishu_refs_json, details_json, created_at
        ) VALUES (?, ?, ?, ?, 'execution_state_changed', NULL, '[]', '[]', ?, ?)
      `).run(
        randomUUID(),
        this.userId,
        attempt.projectId,
        attempt.workItemId,
        JSON.stringify({
          action,
          fromObservedState: attempt.observedState,
          toObservedState: updated.observedState,
          desiredState: updated.desiredState,
          failureCode: updated.failureCode
        }),
        Date.now()
      );
      return updated;
    });
    return apply();
  }

  assertInputSnapshot(
    attemptId: string,
    sourceVersion: number,
    taskPacket: Record<string, unknown>
  ): void {
    const attempt = this.requireAttempt(attemptId);
    if (attempt.inputVersion !== sourceVersion || attempt.inputDigest !== digestTaskPacket(taskPacket)) {
      throw new Error("ATTEMPT_INPUT_DRIFT");
    }
  }

  consumeBudget(attemptId: string, budget: ProjectManagerBudget): number {
    const maximum = {
      reconcile: this.limits.maxReconcile,
      decision: this.limits.maxDecision,
      follow_up: this.limits.maxFollowUp,
      retry: this.limits.maxRetry
    }[budget];
    return this.repository.consumeBudget(attemptId, budget, maximum);
  }

  private requireAttempt(attemptId: string): ProjectManagerTaskAttempt {
    const attempt = this.repository.getAttemptById(attemptId);
    if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
    return attempt;
  }
}
