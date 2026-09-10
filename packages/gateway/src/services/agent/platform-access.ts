import { ProjectRepository } from "../../db/repositories/project-repository.js";
import { SessionRepository } from "../../db/repositories/session-repository.js";
import type { Database } from "../../db/types.js";
import type { AdapterId } from "../adapter-discovery.js";
import {
  getChangedPathsImpact,
  getSymbolDetail,
  getSymbolImpact,
  searchGraphSymbols
} from "../project-graph.js";
import {
  confirmProgrammaticTaskConsumed,
  DEFAULT_PROGRAMMATIC_CONSUMPTION,
  PROGRAMMATIC_SUBMIT_INDETERMINATE
} from "../programmatic-terminal-submit.js";
import type { InMemorySessionManager } from "../session-manager.js";
import { AgentMemoryRepository, type AgentMemoryScope } from "./memory.js";
import type { AgentMemoryEntry } from "./types.js";

export const COPILOT_DELIVERY_UNCONFIRMED = "COPILOT_DELIVERY_UNCONFIRMED";

export function listSessionSummaries(
  db: Database,
  userId: string,
  input: { projectId?: string; limit?: number; allowedProjectIds?: string[] }
) {
  const repository = new SessionRepository(db, userId);
  const rows = input.projectId ? repository.listByProject(input.projectId) : repository.list();
  return rows.filter(row=>!input.allowedProjectIds||input.allowedProjectIds.includes(row.projectId)).slice(0, input.limit ?? 50).map((session) => ({
    id: session.id,
    name: session.name,
    aiTool: session.aiTool,
    status: session.status,
    projectId: session.projectId,
    projectName: session.projectName ?? null,
    modelId: session.modelId
  }));
}

export function getSessionDetail(db: Database, userId: string, sessionId: string) {
  const session = new SessionRepository(db, userId).getById(sessionId);
  if (!session) return undefined;
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

export async function dispatchSessionInput(
  sessionManager: Pick<InMemorySessionManager, "submitProgrammaticTask" | "captureHistory">,
  sessionId: string,
  adapter: AdapterId,
  message: string
): Promise<{ dispatched: true; sessionId: string; delivery: "consumed" }> {
  let staged;
  try {
    staged = await sessionManager.submitProgrammaticTask(sessionId, { adapter, message });
  } catch (error) {
    if (error instanceof Error && error.message === PROGRAMMATIC_SUBMIT_INDETERMINATE) {
      throw new Error(COPILOT_DELIVERY_UNCONFIRMED);
    }
    throw error;
  }
  const consumed = await confirmProgrammaticTaskConsumed(
    () => sessionManager.captureHistory(sessionId),
    staged.adapter,
    staged.stagedPane,
    staged.needle,
    DEFAULT_PROGRAMMATIC_CONSUMPTION
  );
  if (!consumed) throw new Error(COPILOT_DELIVERY_UNCONFIRMED);
  return { dispatched: true, sessionId, delivery: "consumed" };
}

export function listProjectSummaries(db: Database, userId: string, input: { limit?: number; allowedProjectIds?: string[] }) {
  return new ProjectRepository(db, userId).list().filter(row=>!input.allowedProjectIds||input.allowedProjectIds.includes(row.id)).slice(0, input.limit ?? 50).map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
    status: project.status,
    aiTool: project.aiTool,
    description: project.description
  }));
}

export function getProjectDetail(db: Database, userId: string, projectId: string) {
  const project = new ProjectRepository(db, userId).getById(projectId);
  if (!project) return undefined;
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

export function createProjectRecord(
  db: Database,
  userId: string,
  input: { name: string; path: string; description?: string }
) {
  const created = new ProjectRepository(db, userId).create({
    name: input.name,
    path: input.path,
    aiTool: "",
    ...(input.description !== undefined ? { description: input.description } : {})
  });
  return { projectId: created.id, name: created.name };
}

export function listMemoryEntries(
  db: Database,
  userId: string,
  input: { scope: AgentMemoryScope["scope"]; projectId?: string; conversationId?: string; limit?: number }
) {
  const scope: AgentMemoryScope = {
    scope: input.scope,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {})
  };
  return new AgentMemoryRepository(db, userId).list(scope, input.limit ?? 50).map(mapMemoryEntry);
}

export function searchMemoryEntries(
  db: Database,
  userId: string,
  input: { query: string; scope: AgentMemoryScope["scope"]; projectId?: string; conversationId?: string; limit?: number }
) {
  const scope: AgentMemoryScope = {
    scope: input.scope,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {})
  };
  return new AgentMemoryRepository(db, userId)
    .search(input.query, scope, input.limit ?? 10)
    .map(mapMemoryEntry);
}

export function writeMemoryEntry(
  db: Database,
  userId: string,
  input: {
    kind: "fact" | "preference" | "decision" | "project_note";
    scope: AgentMemoryScope["scope"];
    text: string;
    projectId?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const entry = new AgentMemoryRepository(db, userId).create({
    kind: input.kind,
    scope: input.scope,
    text: input.text,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
  });
  return { saved: true, id: entry.id };
}

function mapMemoryEntry(entry: AgentMemoryEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
    scope: entry.scope,
    text: entry.text,
    projectId: entry.projectId ?? null,
    conversationId: entry.conversationId ?? null
  };
}

function projectPathForUser(db: Database, userId: string, projectId: string): string | undefined {
  return new ProjectRepository(db, userId).getById(projectId)?.path;
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

export function getProjectGraphSymbol(db: Database, userId: string, projectId: string, symbolId: string) {
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
