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
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import {
  PortfolioRepository,
  type PortfolioWorkItemState
} from "../../db/repositories/portfolio-repository.js";
import type { Database } from "../../db/types.js";
import {
  AgentMemoryRepository,
  type AgentMemoryScope
} from "../agent/memory.js";
import type { AgentMemoryEntry } from "../agent/types.js";
import type { InMemorySessionManager } from "../session-manager.js";
import type { AdapterId } from "../adapter-discovery.js";
import type { PortfolioUserApi } from "../portfolio/portfolio-api-service.js";
import {
  confirmProgrammaticTaskConsumed,
  DEFAULT_DISPATCH_CONFIRM,
  DISPATCH_DELIVERY_UNCONFIRMED,
  type DispatchConfirmOptions
} from "./delivery-confirm.js";
import { PROGRAMMATIC_SUBMIT_INDETERMINATE } from "../programmatic-terminal-submit.js";
import {
  getChangedPathsImpact,
  getSymbolDetail,
  getSymbolImpact,
  searchGraphSymbols
} from "../project-graph.js";

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
 * Submit one adapter-bound task through the programmatic terminal path. The
 * task is staged as one bracketed paste, allowed to settle, and submitted with
 * exactly one Enter. Success requires the current CLI composer to consume the
 * staged task; seeing the text elsewhere in scrollback is not sufficient.
 * Raw browser and Portfolio worker input continue to use sendInput unchanged.
 */
export async function dispatchSessionInput(
  sessionManager: Pick<InMemorySessionManager, "submitProgrammaticTask" | "captureHistory">,
  sessionId: string,
  adapter: AdapterId,
  message: string,
  confirm?: DispatchConfirmOptions
): Promise<{ dispatched: true; sessionId: string; delivery: "consumed" }> {
  let staged;
  try {
    staged = await sessionManager.submitProgrammaticTask(sessionId, { adapter, message });
  } catch (error) {
    if (error instanceof Error && error.message === PROGRAMMATIC_SUBMIT_INDETERMINATE) {
      throw new Error(DISPATCH_DELIVERY_UNCONFIRMED);
    }
    throw error;
  }
  const confirmed = await confirmProgrammaticTaskConsumed(
    () => sessionManager.captureHistory(sessionId),
    staged.adapter,
    staged.stagedPane,
    staged.needle,
    confirm ?? DEFAULT_DISPATCH_CONFIRM
  );
  if (!confirmed) {
    throw new Error(DISPATCH_DELIVERY_UNCONFIRMED);
  }
  return { dispatched: true, sessionId, delivery: "consumed" };
}

/* ------------------------------------------------------------------------ */
/* Projects — shared by the Copilot project tools and the bridge HTTP API.  */
/* ------------------------------------------------------------------------ */

export interface BridgeProjectSummary {
  id: string;
  name: string;
  path: string;
  status: string;
  aiTool: string;
  description: string | null;
}

export interface BridgeProjectDetail extends BridgeProjectSummary {
  isImported: boolean;
  templateId: string | null;
}

export function listProjectSummaries(
  db: Database,
  userId: string,
  input: { limit?: number }
): BridgeProjectSummary[] {
  return new ProjectRepository(db, userId).list().slice(0, input.limit ?? 50).map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
    status: project.status,
    aiTool: project.aiTool,
    description: project.description
  }));
}

export function getProjectDetail(
  db: Database,
  userId: string,
  projectId: string
): BridgeProjectDetail | undefined {
  const project = new ProjectRepository(db, userId).getById(projectId);
  if (!project) {
    return undefined;
  }
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    status: project.status,
    aiTool: project.aiTool,
    description: project.description,
    isImported: project.isImported,
    templateId: project.templateId
  };
}

/**
 * Create a project record exactly the way the Copilot `create_project` tool
 * does (blank aiTool, optional description). Path safety classification lives
 * in the security policy ahead of this call on both surfaces.
 */
export function createProjectRecord(
  db: Database,
  userId: string,
  input: { name: string; path: string; description?: string }
): { projectId: string; name: string } {
  const created = new ProjectRepository(db, userId).create({
    name: input.name,
    path: input.path,
    aiTool: "",
    ...(input.description !== undefined ? { description: input.description } : {})
  });
  return { projectId: created.id, name: created.name };
}

/* ------------------------------------------------------------------------ */
/* Memory — shared by the Copilot memory tools and the bridge HTTP API.     */
/* ------------------------------------------------------------------------ */

export interface BridgeMemoryEntry {
  id: string;
  kind: AgentMemoryEntry["kind"];
  scope: AgentMemoryEntry["scope"];
  text: string;
  projectId: string | null;
}

function mapMemoryEntry(entry: AgentMemoryEntry): BridgeMemoryEntry {
  return { id: entry.id, kind: entry.kind, scope: entry.scope, text: entry.text, projectId: entry.projectId ?? null };
}

export function listMemoryEntries(
  db: Database,
  userId: string,
  input: { scope: AgentMemoryScope["scope"]; projectId?: string; limit?: number }
): BridgeMemoryEntry[] {
  const scope: AgentMemoryScope = { scope: input.scope, ...(input.projectId !== undefined ? { projectId: input.projectId } : {}) };
  return new AgentMemoryRepository(db, userId).list(scope, input.limit ?? 50).map(mapMemoryEntry);
}

export function searchMemoryEntries(
  db: Database,
  userId: string,
  input: { query: string; scope: AgentMemoryScope["scope"]; projectId?: string; limit?: number }
): BridgeMemoryEntry[] {
  const scope: AgentMemoryScope = { scope: input.scope, ...(input.projectId !== undefined ? { projectId: input.projectId } : {}) };
  return new AgentMemoryRepository(db, userId).search(input.query, scope, input.limit ?? 10).map(mapMemoryEntry);
}

/** Persist a durable memory entry (redaction and scope rules live in the repository). */
export function writeMemoryEntry(
  db: Database,
  userId: string,
  input: { kind: "fact" | "preference" | "decision" | "project_note"; scope: AgentMemoryScope["scope"]; text: string; projectId?: string; metadata?: Record<string, unknown> }
): { saved: true; id: string } {
  const entry = new AgentMemoryRepository(db, userId).create({
    kind: input.kind,
    scope: input.scope,
    text: input.text,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
  });
  return { saved: true, id: entry.id };
}

// ---- Project graph (read-only CodeGraph index) ----
//
// Thin user-scoped wrappers over the project-graph service. Each resolves the
// tenant-owned project first (404-equivalent: undefined / available:false) so
// neither the internal HTTP surface nor the harness tools can read a foreign
// project's index.

function projectPathForUser(db: Database, userId: string, projectId: string): string | undefined {
  const project = new ProjectRepository(db, userId).getById(projectId);
  return project?.path;
}

export function searchProjectGraphSymbols(
  db: Database,
  userId: string,
  projectId: string,
  options: { q: string; kind?: string; limit?: number }
) {
  const root = projectPathForUser(db, userId, projectId);
  if (!root) return { available: false as const, reason: "not_initialized" as const };
  return searchGraphSymbols(root, options);
}

export function getProjectGraphSymbol(
  db: Database,
  userId: string,
  projectId: string,
  symbolId: string
) {
  const root = projectPathForUser(db, userId, projectId);
  if (!root) return { available: false as const, reason: "not_initialized" as const };
  return getSymbolDetail(root, symbolId);
}

export function getProjectGraphSymbolImpact(
  db: Database,
  userId: string,
  projectId: string,
  symbolId: string,
  depth: number
) {
  const root = projectPathForUser(db, userId, projectId);
  if (!root) return { available: false as const, reason: "not_initialized" as const };
  return getSymbolImpact(root, symbolId, depth);
}

export function getProjectGraphAffectedPaths(
  db: Database,
  userId: string,
  projectId: string,
  paths: string[],
  depth: number
) {
  const root = projectPathForUser(db, userId, projectId);
  if (!root) return { available: false as const, reason: "not_initialized" as const };
  return getChangedPathsImpact(root, paths, depth);
}
