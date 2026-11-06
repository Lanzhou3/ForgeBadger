import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { ChannelIdentityRepository } from '../../db/repositories/channel-identity-repository.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import { DENIED_ROOTS, validateProjectRoot } from '../../lib/safe-resolve.js';
import { AgentError } from '../agent/types.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';
import type { TurnInput } from '../agent/run-ledger.js';
import type { AgentToolContext } from '../agent/tool-registry.js';
import { loadRunFacts, ParentChainDepthError, parseRunInput, runAncestry } from '../agent/run-authorization.js';
import { ChannelIdentityError, ChannelIdentityService } from './channel-identity-service.js';

const id = z.string().min(1).max(128);
const scopeSchema = z.object({ version: z.literal(1), routeId: id.optional(), routeRevision: z.number().int().positive().optional(),
  identityId: id.optional(), identityRevision: z.number().int().positive().optional(), conversationId: id,
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
  const conversation = new CopilotConversationLog(db, userId).getConversation(conversationId);
  const route = records.conversationRoute(conversationId);
  const channelOwned = records.conversationIsChannelOwned(conversationId);
  if (!route && !channelOwned && !conversation?.project_id) return;
  requireScope(conversation);
  requireScope(route || !channelOwned);
  if (route) requireScope(conversation.project_id);
  const authority = route ? new ChannelIdentityService(db, userId).admitRoute(route.id, conversationId) : undefined;
  const projectIds = conversation.project_id ? [conversation.project_id] : [];
  if (!projectIds.length) return;
  const projects = new ProjectRepository(db, userId);
  return { version: 1,
    ...(authority ? { routeId: authority.routeId, routeRevision: authority.routeRevision,
      identityId: authority.identityId, identityRevision: authority.identityRevision } : {}), conversationId,
    projectIds, roots: projectIds.map(projectId => {
      const project = projects.getById(projectId); requireScope(project);
      return { projectId, path: canonicalRoot(project.path) };
    }) };
}

function prepareConversationProject(db: Database, userId: string, input: TurnInput): TurnInput {
  const conversations = new CopilotConversationLog(db, userId);
  const conversation = conversations.getConversation(input.conversationId);
  if (!conversation) return input;
  const projectId = conversation.project_id;
  const goalProjectId = input.goalId
    ? (db.prepare('SELECT project_id FROM copilot_goals WHERE user_id=? AND id=?').get(userId, input.goalId) as { project_id: string | null } | undefined)?.project_id
    : undefined;
  if (input.projectId && goalProjectId && input.projectId !== goalProjectId)
    throw new AgentError('COPILOT_CONVERSATION_PROJECT_MISMATCH', 'Goal project does not match the message project');
  const requestedProjectId = input.projectId ?? goalProjectId ?? undefined;
  if (projectId && requestedProjectId && requestedProjectId !== projectId)
    throw new AgentError('COPILOT_CONVERSATION_PROJECT_MISMATCH', 'Message project does not match the conversation project');
  if (!projectId && requestedProjectId) conversations.setConversationProject(input.conversationId, requestedProjectId);
  if (!projectId && !requestedProjectId && new ChannelIdentityRepository(db, userId).conversationIsChannelOwned(input.conversationId))
    throw new AgentError('COPILOT_CONVERSATION_PROJECT_REQUIRED', 'Choose a conversation project with /project before sending work');
  const resolvedProjectId = projectId ?? requestedProjectId;
  return { ...input, ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}) };
}

/** Admission is the only place that captures authority. Recovery must never synthesize it. */
export function prepareChannelAdmission(db: Database, userId: string, input: TurnInput): TurnInput {
  input = prepareConversationProject(db, userId, input);
  const snapshot = input.parentRunId
    ? assertChannelRunScope(db, userId, parentInput(db, userId, input.parentRunId))
    : currentScope(db, userId, input.conversationId);
  if (!input.parentRunId && snapshot && new ChannelIdentityRepository(db, userId).conversationIsChannelOwned(input.conversationId)) {
    const previous = db.prepare('SELECT input_json FROM copilot_runs WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 1')
      .get(userId, input.conversationId) as { input_json: string } | undefined;
    if (previous && !parseRunInput(previous).channelScope) throw new ChannelIdentityError();
  }
  let projectId = input.projectId;
  if (snapshot && projectId === undefined) {
    if (snapshot.projectIds.length !== 1) throw new AgentError('COPILOT_CONVERSATION_PROJECT_REQUIRED', 'Conversation run requires an explicit projectId');
    projectId = snapshot.projectIds[0];
  }
  const result = { ...input, ...(snapshot ? { channelScope: snapshot, projectId } : {}) };
  if (!snapshot) delete result.channelScope;
  assertChannelRunScope(db, userId, result);
  return result;
}

/** Durable conversation project/root snapshot and any channel route/identity
 *  revisions must agree with current authority at every ancestor. */
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
  requireScope(raw && typeof raw === 'object' && !Array.isArray(raw));
  const input = raw as Record<string, unknown>;
  const projects = new Set<string>(); const roots: string[] = [];
  if (name.startsWith('goal_') && context.runId) {
    const run = context.db.prepare('SELECT goal_id,input_json FROM copilot_runs WHERE user_id=? AND id=?').get(context.userId, context.runId) as { goal_id: string | null; input_json: string } | undefined;
    const goalId = run?.goal_id ?? parseRunInput(run!).goalId;
    const goal = goalId ? context.db.prepare('SELECT project_id FROM copilot_goals WHERE user_id=? AND id=?').get(context.userId, goalId) as { project_id: string | null } | undefined : undefined;
    if (goal?.project_id) projects.add(goal.project_id);
  }
  if (typeof input.projectId === 'string') projects.add(input.projectId);
  if (typeof input.sessionId === 'string') {
    const session = new SessionRepository(context.db, context.userId).getById(input.sessionId); requireScope(session);
    projects.add(session.projectId); roots.push(session.workingDir);
    if (input.projectId !== undefined) requireScope(input.projectId === session.projectId);
  }
  for (const [field, table] of [['taskId', 'copilot_development_tasks'], ['workItemId', 'project_manager_work_items']] as const) {
    if (name.startsWith('goal_') && field === 'taskId') continue;
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
