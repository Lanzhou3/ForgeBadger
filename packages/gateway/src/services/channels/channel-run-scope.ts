import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { ChannelIdentityRepository } from '../../db/repositories/channel-identity-repository.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import { DENIED_ROOTS, validateProjectRoot } from '../../lib/safe-resolve.js';
import { AgentError } from '../agent/types.js';
import type { TurnInput } from '../agent/run-ledger.js';
import type { AgentToolContext } from '../agent/tool-registry.js';
import { loadRunFacts, ParentChainDepthError, parseRunInput, runAncestry } from '../agent/run-authorization.js';
import { CHANNEL_TOOLS } from '../agent/tool-surface.js';
import { ChannelIdentityError, ChannelIdentityService } from './channel-identity-service.js';

const id = z.string().min(1).max(128);
const scopeSchema = z.object({ version: z.literal(1), routeId: id, routeRevision: z.number().int().positive(),
  identityId: id, identityRevision: z.number().int().positive(), conversationId: id,
  projectIds: z.array(id).min(1).max(100), roots: z.array(z.object({ projectId: id, path: z.string().min(1) }).strict()).min(1).max(100) }).strict();
export type ChannelRunScope = z.infer<typeof scopeSchema>;
export interface ChannelResources { projectIds: readonly string[]; rootPaths?: readonly string[]; conversationId?: string }

function requireScope(condition: unknown): asserts condition { if (!condition) throw new ChannelIdentityError(); }
function canonicalRoot(value: string): string {
  const full = path.resolve(value); let ancestor = full; const tail: string[] = [];
  while (!existsSync(ancestor)) { tail.unshift(path.basename(ancestor)); const parent = path.dirname(ancestor); requireScope(parent !== ancestor); ancestor = parent; }
  const resolved = path.join(realpathSync(ancestor), ...tail);
  for (const denied of DENIED_ROOTS) requireScope(resolved !== denied && (denied === '/' || !resolved.startsWith(denied + path.sep)));
  if (existsSync(resolved)) validateProjectRoot(resolved);
  return resolved;
}
function parentInput(db: Database, userId: string, runId: string): TurnInput {
  const row = db.prepare('SELECT input_json FROM copilot_runs WHERE user_id=? AND id=?').get(userId, runId) as { input_json: string } | undefined;
  requireScope(row); return parseRunInput(row);
}
function currentScope(db: Database, userId: string, conversationId: string): ChannelRunScope | undefined {
  const records = new ChannelIdentityRepository(db, userId);
  const route = records.conversationRoute(conversationId);
  if (!route && !records.conversationIsChannelOwned(conversationId)) return;
  requireScope(route);
  const authority = new ChannelIdentityService(db, userId).admitRoute(route.id, conversationId);
  const projects = new ProjectRepository(db, userId);
  return { version: 1, routeId: authority.routeId, routeRevision: authority.routeRevision,
    identityId: authority.identityId, identityRevision: authority.identityRevision, conversationId,
    projectIds: authority.projectIds, roots: authority.projectIds.map(projectId => {
      const project = projects.getById(projectId); requireScope(project);
      return { projectId, path: canonicalRoot(project.path) };
    }) };
}

/** Admission is the only place that captures authority. Recovery must never synthesize it. */
export function prepareChannelAdmission(db: Database, userId: string, input: TurnInput): TurnInput {
  let snapshot: ChannelRunScope | undefined;
  if (input.parentRunId) snapshot = assertChannelRunScope(db, userId, parentInput(db, userId, input.parentRunId));
  else {
    const current = currentScope(db, userId, input.conversationId);
    if (current) {
      // Every run admitted into a channel-owned conversation inherits channel
      // scope — including owner-originated web follow-ups (source 'user'),
      // whose output may be relayed to the channel. The previous run's
      // snapshot is only accepted while it still equals current route,
      // identity and root authority; any drift fails closed below.
      const previous = db.prepare('SELECT input_json FROM copilot_runs WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 1')
        .get(userId, input.conversationId) as { input_json: string } | undefined;
      snapshot = previous ? assertChannelRunScope(db, userId, parseRunInput(previous)) : current;
    }
  }
  let projectId = input.projectId;
  if (snapshot && projectId === undefined) {
    // Defaulting is unambiguous only for a single-project snapshot; with
    // multiple bound projects the caller must choose explicitly.
    if (snapshot.projectIds.length !== 1) throw new AgentError('COPILOT_CHANNEL_PROJECT_REQUIRED', 'Channel run requires an explicit projectId');
    projectId = snapshot.projectIds[0];
  }
  const result = { ...input, ...(snapshot ? { channelScope: snapshot, projectId } : {}) };
  // Caller-supplied trusted fields cannot create channel authority on an owner conversation.
  if (!snapshot) delete result.channelScope;
  assertChannelRunScope(db, userId, result);
  return result;
}

/** Durable snapshot AND current route/identity/root authority must agree; every
 *  ancestor must carry the same snapshot. The walk is the shared iterative,
 *  depth-8-capped runAncestry (was an uncapped-style recursion capped only here). */
function assertChannelLevel(db: Database, userId: string,
  input: Pick<TurnInput, 'conversationId' | 'channelScope' | 'parentRunId' | 'projectId'>,
  resources: ChannelResources | undefined, inherited: ChannelRunScope | undefined): ChannelRunScope | undefined {
  const current = currentScope(db, userId, input.channelScope?.conversationId ?? input.conversationId);
  if (!current && !inherited && !input.channelScope) return undefined;
  requireScope(current && input.channelScope);
  const parsed = scopeSchema.safeParse(input.channelScope); requireScope(parsed.success);
  const snapshot = parsed.data;
  requireScope(JSON.stringify(snapshot) === JSON.stringify(current));
  if (inherited) requireScope(JSON.stringify(inherited) === JSON.stringify(snapshot));
  else requireScope(snapshot.conversationId === input.conversationId);
  if (input.projectId) requireScope(snapshot.projectIds.includes(input.projectId));
  if (resources) {
    requireScope(resources.projectIds.every(project => snapshot.projectIds.includes(project)));
    if (resources.conversationId) requireScope(resources.conversationId === input.conversationId);
    for (const root of resources.rootPaths ?? []) {
      const actual = canonicalRoot(root);
      requireScope(snapshot.roots.some(bound => actual === bound.path || actual.startsWith(bound.path + path.sep)));
    }
  }
  return snapshot;
}

export function assertChannelRunScope(db: Database, userId: string, input: Pick<TurnInput, 'conversationId' | 'channelScope' | 'parentRunId' | 'projectId'>,
  resources?: ChannelResources): ChannelRunScope | undefined {
  // Farthest ancestor first, like the old recursion: each level's snapshot must
  // equal the inherited one, so the deepest level anchors the conversationId check.
  const levels: TurnInput[] = [];
  try {
    for (const level of runAncestry(db, userId, input as TurnInput)) levels.push(level);
  } catch (error) {
    if (error instanceof ParentChainDepthError) throw new ChannelIdentityError();
    throw error;
  }
  // A parentRunId without a row must fail closed like parentInput's requireScope.
  if (levels.at(-1)?.parentRunId) throw new ChannelIdentityError();
  let inherited: ChannelRunScope | undefined;
  for (let index = levels.length - 1; index >= 0; index -= 1)
    inherited = assertChannelLevel(db, userId, levels[index]!, index === 0 ? resources : undefined, inherited);
  return inherited;
}

export { channelToolAllowed } from '../agent/tool-surface.js';

function contextScope(context: AgentToolContext): ChannelRunScope | undefined {
  if (typeof context.runId === 'string') {
    const facts = loadRunFacts(context.db, context.userId, context.runId);
    if (facts) {
      const input = facts.input;
      requireScope(input.userId === context.userId && (context.conversationId === undefined || input.conversationId === context.conversationId));
      return assertChannelRunScope(context.db, context.userId, input);
    }
  }
  if (context.conversationId) requireScope(!currentScope(context.db, context.userId, context.conversationId));
}
export function channelToolContext(context: AgentToolContext): AgentToolContext {
  const scope = contextScope(context);
  return scope ? { ...context, channelScope: scope, allowedProjectIds: scope.projectIds } : context;
}

/** Resolve resource IDs against their actual rows, never trust a supplied project hint. */
export function assertChannelToolScope(context: AgentToolContext, name: string, raw: unknown): void {
  const scope = contextScope(context); if (!scope) return;
  requireScope(CHANNEL_TOOLS.has(name) || context.executionMode === 'repair' && name === 'submit_development_task');
  requireScope(raw && typeof raw === 'object' && !Array.isArray(raw));
  const input = raw as Record<string, unknown>;
  const projects = new Set<string>(); const roots: string[] = [];
  if (typeof input.projectId === 'string') projects.add(input.projectId);
  if (typeof input.sessionId === 'string') {
    const session = new SessionRepository(context.db, context.userId).getById(input.sessionId); requireScope(session);
    projects.add(session.projectId); roots.push(session.workingDir);
    if (input.projectId !== undefined) requireScope(input.projectId === session.projectId);
  }
  for (const [field, table] of [['taskId', 'copilot_development_tasks'], ['workItemId', 'project_manager_work_items']] as const) {
    if (typeof input[field] !== 'string') continue;
    const query = table === 'copilot_development_tasks'
      ? 'SELECT project_id,project_root FROM copilot_development_tasks WHERE user_id=? AND id=?'
      : 'SELECT project_id,details_json FROM project_manager_work_items WHERE user_id=? AND id=?';
    const row = context.db.prepare(query).get(context.userId, input[field]) as { project_id: string; project_root?: string; details_json?: string } | undefined;
    requireScope(row); projects.add(row.project_id);
    if (input.projectId !== undefined) requireScope(input.projectId === row.project_id);
    if (row.project_root) roots.push(row.project_root);
    if (row.details_json) {
      const details = JSON.parse(row.details_json) as { taskPacket?: { sessionId?: unknown } };
      if (typeof details.taskPacket?.sessionId === 'string') {
        const linked = new SessionRepository(context.db, context.userId).getById(details.taskPacket.sessionId);
        requireScope(linked && linked.projectId === row.project_id); roots.push(linked.workingDir);
      }
    }
  }
  if (['search_memory', 'list_memory', 'write_memory'].includes(name)) {
    requireScope(input.scope === 'project' && typeof input.projectId === 'string' || input.scope === 'session' && input.projectId === undefined);
    if (input.conversationId !== undefined) requireScope(input.conversationId === context.conversationId);
  } else if (!['list_projects', 'list_sessions', 'pm_overview', 'discover_tools', 'read_tool_result'].includes(name)) requireScope(projects.size > 0);
  requireScope([...projects].every(project => scope.projectIds.includes(project)));
  for (const root of roots) {
    const canonical = canonicalRoot(root);
    requireScope(scope.roots.some(bound => canonical === bound.path || canonical.startsWith(bound.path + path.sep)));
  }
}

/** List projection is applied before pagination; an inaccessible session is omitted. */
export function channelSessionAllowed(context: AgentToolContext, sessionId: string): boolean {
  try { assertChannelToolScope(context, 'get_session', { sessionId }); return true; }
  catch { return false; }
}
