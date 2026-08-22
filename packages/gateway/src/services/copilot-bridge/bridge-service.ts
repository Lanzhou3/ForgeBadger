/**
 * Copilot bridge service — the shared seam behind both the Copilot harness
 * session/portfolio tools and the internal HTTP API consumed by the
 * deepseek-harness openforge-bridge plugin. Keeping both callers on these
 * functions prevents the two surfaces from drifting apart.
 *
 * Every function is user-scoped: repositories are constructed per userId and
 * apply their own `WHERE user_id = ?` filtering.
 */
import { SessionRepository } from "../../db/repositories/session-repository.js";
import {
  PortfolioRepository,
  type PortfolioWorkItemState
} from "../../db/repositories/portfolio-repository.js";
import type { Database } from "../../db/types.js";
import type { InMemorySessionManager } from "../session-manager.js";
import type { PortfolioUserApi } from "../portfolio/portfolio-api-service.js";
import {
  confirmDelivery,
  DEFAULT_DISPATCH_CONFIRM,
  deliveryNeedle,
  DISPATCH_DELIVERY_UNCONFIRMED,
  type DispatchConfirmOptions
} from "./delivery-confirm.js";

export interface BridgeSessionSummary {
  id: string;
  name: string;
  aiTool: string;
  status: string;
  projectId: string;
  projectName: string | null;
  modelId: string | null;
}

export interface BridgeSessionDetail {
  id: string;
  name: string;
  aiTool: string;
  status: string;
  projectId: string;
  workingDir: string;
  credentialMode: string;
  errorMessage: string | null;
}

export function listSessionSummaries(
  db: Database,
  userId: string,
  input: { projectId?: string; limit?: number }
): BridgeSessionSummary[] {
  const repository = new SessionRepository(db, userId);
  const rows = input.projectId ? repository.listByProject(input.projectId) : repository.list();
  return rows.slice(0, input.limit ?? 50).map((session) => ({
    id: session.id,
    name: session.name,
    aiTool: session.aiTool,
    status: session.status,
    projectId: session.projectId,
    projectName: session.projectName ?? null,
    modelId: session.modelId
  }));
}

export function getSessionDetail(
  db: Database,
  userId: string,
  sessionId: string
): BridgeSessionDetail | undefined {
  const session = new SessionRepository(db, userId).getById(sessionId);
  if (!session) {
    return undefined;
  }
  return {
    id: session.id,
    name: session.name,
    aiTool: session.aiTool,
    status: session.status,
    projectId: session.projectId,
    workingDir: session.workingDir,
    credentialMode: session.credentialMode,
    errorMessage: session.errorMessage
  };
}

/**
 * Forward-only progression a bridge "advance" maps to. Terminal states have
 * no next step; the State Gate rejects the transition as invalid.
 */
const ADVANCE_TARGET: Partial<Record<PortfolioWorkItemState, PortfolioWorkItemState>> = {
  todo: "in_progress",
  in_progress: "ready_for_review",
  blocked: "in_progress",
  ready_for_review: "done"
};

export interface AdvanceWorkItemResult {
  advanced: boolean;
  transition: unknown;
}

/**
 * Advance a work item one lifecycle step via the same State Gate transition
 * path the Copilot `advance_work_item` tool uses, so all risk/approval
 * preconditions (dispatch receipts, verified completion, accepted decisions,
 * owner authority) still apply. The expected projection version is re-read
 * fresh and the idempotency key is deterministic per (item, version, target)
 * so plugin retries replay instead of double-advancing.
 */
export function advanceWorkItem(
  db: Database,
  userId: string,
  api: PortfolioUserApi,
  workItemId: string,
  note?: string
): AdvanceWorkItemResult {
  const repository = new PortfolioRepository(db, userId);
  const current = repository.getWorkItem(workItemId);
  if (!current) {
    throw new Error("PORTFOLIO_RECORD_NOT_FOUND");
  }
  const toState = ADVANCE_TARGET[current.state];
  if (!toState) {
    throw new Error("PORTFOLIO_INVALID_TRANSITION");
  }
  const attemptId = requiresAttempt(toState)
    ? repository.getLatestTaskAttemptForWorkItem(workItemId)?.id
    : undefined;
  const transition = api.transition({
    recordType: "work_item",
    recordId: workItemId,
    toState,
    expectedProjectionVersion: current.projectionVersion,
    ...(attemptId ? { attemptId } : {}),
    ...(note ? { correlationId: note } : {}),
    idempotencyKey: `copilot-bridge:advance:${workItemId}:${current.projectionVersion}:${toState}`
  });
  return { advanced: true, transition };
}

function requiresAttempt(toState: PortfolioWorkItemState): boolean {
  return toState === "in_progress" || toState === "ready_for_review" || toState === "done";
}

/**
 * Inject a message into a session's terminal through the same
 * session-manager -> tmux send-keys path the Portfolio worker uses (the
 * trailing newline submits the input). The session input gate still applies:
 * a session leased to a Portfolio worker rejects direct writes.
 *
 * Delivery confirmation (post-M3): send-keys succeeds even when the target
 * CLI shows a modal dialog that swallows the input, so after the write the
 * pane is read back (capture-pane, same parameters as terminal history) until
 * the message's normalized prefix appears. An unconfirmed delivery throws
 * DISPATCH_DELIVERY_UNCONFIRMED — the bytes may or may not have landed, so
 * callers must surface the failure instead of claiming dispatch.
 *
 * The Portfolio worker path (sendInput with a capability) is deliberately
 * unchanged; confirmation applies to the bridge dispatch path only.
 */
export async function dispatchSessionInput(
  sessionManager: Pick<InMemorySessionManager, "sendInput" | "captureHistory">,
  sessionId: string,
  message: string,
  confirm?: DispatchConfirmOptions
): Promise<{ dispatched: true; sessionId: string; delivery: "confirmed" }> {
  await sessionManager.sendInput(sessionId, `${message}\n`);
  const confirmed = await confirmDelivery(
    () => sessionManager.captureHistory(sessionId),
    deliveryNeedle(message),
    confirm ?? DEFAULT_DISPATCH_CONFIRM
  );
  if (!confirmed) {
    throw new Error(DISPATCH_DELIVERY_UNCONFIRMED);
  }
  return { dispatched: true, sessionId, delivery: "confirmed" };
}
