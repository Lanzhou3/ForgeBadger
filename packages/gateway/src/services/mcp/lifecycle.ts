import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import { ProjectManagerRepository } from '../../db/repositories/project-manager-repository.js';
import { McpTokenRepository, parseMcpTokenScopes } from '../../db/repositories/mcp-token-repository.js';
import { hasDeliveryHistory, assertProjectPathAccess } from '../../db/repositories/managed-project-access.js';
import { assertLegacyTaskExecution, assertProjectManagerWrite } from '../project-manager/access.js';
import { mutateAssignedTask } from '../project-manager/tasks.js';
import { resolveTaskPacketSession } from '../project-manager/task-packets.js';
import { sessionRuntimeRevision } from '../session-stop-target.js';
import { canonical } from '../platform-commands/actions.js';
import type { CommandContext, PlatformCommand } from '../platform-commands/types.js';
import { assertMcpTokenAuthority } from './token-authority.js';
import { containsSensitiveAgentValue } from '../agent/redaction.js';

const id = z.string().min(1).max(128);
const projectInput = z.object({ projectId: id }).strict();
const planInput = projectInput.extend({ expectedPlanDigest: z.string().regex(/^[0-9a-f]{64}$/) });
const taskInput = projectInput.extend({ workItemId: id, expectedRevision: z.number().int().positive() });
const evidence = z.object({ kind: z.literal('declared').default('declared'),
  label: z.string().trim().min(1).max(256).optional(), ref: z.string().trim().min(1).max(512) }).strict();

const lifecycleInputSchemas = {
  pm_set_goal: planInput.extend({ summary: z.string().trim().min(1).max(1000),
    constraints: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).max(50).optional() }).strict(),
  pm_update_task_plan: taskInput.extend({ title: z.string().trim().min(1).max(256).optional(),
    description: z.string().max(4000).nullable().optional(), priority: z.number().int().min(0).max(100).optional(),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).max(50).optional(), stageId: id.nullable().optional() }).strict(),
  pm_manage_stage: z.union([
    planInput.extend({ action: z.literal('create'), name: z.string().trim().min(1).max(128), description: z.string().max(1000).nullable().optional() }).strict(),
    planInput.extend({ action: z.literal('update'), stageId: id, name: z.string().trim().min(1).max(128).optional(), description: z.string().max(1000).nullable().optional(), status: z.enum(['active', 'completed', 'archived']).optional() }).strict(),
    planInput.extend({ action: z.literal('delete'), stageId: id, confirm: z.literal(true) }).strict(),
    planInput.extend({ action: z.literal('reorder'), stageIds: z.array(id).max(200).refine(v => new Set(v).size === v.length, 'Duplicate stage IDs') }).strict()
  ]),
  pm_manage_dependency: planInput.extend({ workItemId: id, blockerWorkItemId: id, action: z.enum(['add', 'remove']) }).strict(),
  pm_attach_evidence: taskInput.extend({ evidenceRefs: z.array(evidence.extend({ kind: z.string().trim().min(1).max(64).refine(v => !/^(delivery|verified|verification|integrated)$/i.test(v)).optional() })).min(1).max(20) }).strict(),
  pm_review_task: taskInput.extend({ decision: z.enum(['accepted', 'changes_requested']), note: z.string().trim().min(1).max(1000),
    criteria: z.array(z.object({ index: z.number().int().min(0).max(49), evidenceRef: z.string().trim().min(1).max(512) }).strict()).max(50).optional() }).strict(),
  pm_delete_work_item: taskInput.extend({ confirm: z.literal(true) }).strict()
};

/** Shared by MCP admission and PlatformActions, before any intent is persisted. */
function credentialFree<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return schema.refine(input => !containsSensitiveAgentValue(input), 'Lifecycle input contains credential-shaped content');
}
export const lifecycleSchemas = {
  pm_set_goal: credentialFree(lifecycleInputSchemas.pm_set_goal),
  pm_update_task_plan: credentialFree(lifecycleInputSchemas.pm_update_task_plan),
  pm_manage_stage: credentialFree(lifecycleInputSchemas.pm_manage_stage),
  pm_manage_dependency: credentialFree(lifecycleInputSchemas.pm_manage_dependency),
  pm_attach_evidence: credentialFree(lifecycleInputSchemas.pm_attach_evidence),
  pm_review_task: credentialFree(lifecycleInputSchemas.pm_review_task),
  pm_delete_work_item: credentialFree(lifecycleInputSchemas.pm_delete_work_item)
};
export const MCP_LIFECYCLE_WRITE_TOOLS = new Set(Object.keys(lifecycleSchemas));

export function assertLifecycleAuthority(ctx: Pick<CommandContext, 'db' | 'userId' | 'mcpTokenId'>): void {
  if (!ctx.mcpTokenId) throw new Error('MCP_LIFECYCLE_AUTHORITY_REQUIRED');
  const token = new McpTokenRepository(ctx.db).findActiveById(ctx.mcpTokenId, ctx.userId);
  const scopes = token ? parseMcpTokenScopes(token.scopes) : [];
  if (!token || !scopes.includes('lifecycle') || !scopes.includes('operate') || !token.allowedProjects)
    throw new Error('MCP_LIFECYCLE_REQUIRES_SCOPED_AUTHORITY');
  assertMcpTokenAuthority(ctx.db, ctx.userId, ctx.mcpTokenId);
}

function owned(ctx: CommandContext, projectId: string) {
  const project = new ProjectRepository(ctx.db, ctx.userId).getById(projectId);
  if (!project) throw new Error('Project not found');
  assertProjectPathAccess(ctx.db, ctx.userId, project.path);
  return { project, repo: new ProjectManagerRepository(ctx.db, ctx.userId) };
}
export function planDigest(ctx: CommandContext, projectId: string): string {
  const { repo } = owned(ctx, projectId);
  return createHash('sha256').update(canonical(repo.planningState(projectId))).digest('hex');
}
function goalSummary(repo: ProjectManagerRepository, projectId: string) {
  const goal = repo.getGoal(projectId);
  return goal ? { id: goal.id, summary: goal.summary, status: goal.status,
    constraintCount: goal.constraints.length, acceptanceCriteriaCount: goal.acceptanceCriteria.length } : null;
}
export function readLifecyclePlan(ctx: CommandContext, projectId: string, offset = 0, limit = 50) {
  const { repo } = owned(ctx, projectId);
  const stages = repo.listStages(projectId), dependencies = repo.listWorkItemLinks(projectId), summary = repo.getSummary(projectId);
  const taskCount = Object.values(summary.workItemCountsByStatus).reduce((total, n) => total + n, 0);
  const total = Math.max(taskCount, stages.length, dependencies.length);
  return { projectId, planDigest: planDigest(ctx, projectId), goal: goalSummary(repo, projectId),
    stages: stages.slice(offset, offset + limit).map(v => ({ id: v.id, name: v.name.slice(0, 32), position: v.position, status: v.status })),
    dependencies: dependencies.slice(offset, offset + limit).map(v => ({ id: v.id, blockerWorkItemId: v.blockerWorkItemId, blockedWorkItemId: v.blockedWorkItemId })), summary,
    tasks: repo.listPlanningItems(projectId, offset, limit).map(item => ({ id: item.id, title: item.title.slice(0, 64), status: item.status,
      stageId: item.stageId, acceptanceCriteriaCount: item.acceptanceCriteria.length, ...repo.taskMetadata(projectId, item.id) })),
    offset, limit, nextOffset: offset + limit < total ? offset + limit : null,
    counts: { tasks: taskCount, stages: stages.length, dependencies: dependencies.length },
    labelsTruncated: true, evidenceSource: 'operator_declared' };
}
export function readLifecycleHandoff(ctx: CommandContext, projectId: string, workItemId: string, offset = 0, limit = 5) {
  const { repo } = owned(ctx, projectId), item = repo.getWorkItem(projectId, workItemId);
  if (!item) throw new Error('Work item not found');
  const total = Math.max(item.acceptanceCriteria.length, item.evidenceRefs.length);
  return { projectId, workItemId, goal: goalSummary(repo, projectId),
    workItem: { id: item.id, title: item.title, status: item.status, stageId: item.stageId,
      description: item.description?.slice(0, 2000) ?? null, descriptionTruncated: (item.description?.length ?? 0) > 2000,
      acceptanceCriteria: item.acceptanceCriteria.slice(offset, offset + limit), evidenceRefs: item.evidenceRefs.slice(offset, offset + limit) },
    ...repo.taskMetadata(projectId, workItemId), offset, limit,
    counts: { acceptanceCriteria: item.acceptanceCriteria.length, evidenceRefs: item.evidenceRefs.length },
    nextOffset: offset + limit < total ? offset + limit : null,
    evidenceSource: 'operator_declared', gitIntegration: 'not_verified', deployment: 'not_verified',
    deliveryGates: ['Run checks against exact code revision', 'Review exact patch', 'Commit and integrate through authorized Git workflow', 'Approve and verify target-specific release'] };
}

function resolveLifecycle(ctx: CommandContext, raw: unknown) {
  assertLifecycleAuthority(ctx);
  const input = raw as { projectId: string; workItemId?: string; expectedRevision?: number; expectedPlanDigest?: string };
  const { project, repo } = owned(ctx, input.projectId);
  assertProjectManagerWrite(ctx.db, ctx.userId, project.id, true);
  assertLegacyTaskExecution(ctx.db, project.id);
  if (hasDeliveryHistory(ctx.db, 'project', project.id)) throw new Error('MCP_MANAGED_DELIVERY_REQUIRES_NATIVE_WORKFLOW');
  const revision = planDigest(ctx, project.id);
  if (input.expectedPlanDigest && input.expectedPlanDigest !== revision) throw new Error('STALE_PLAN_DIGEST');
  let session;
  if (input.workItemId) {
    const item = repo.getWorkItem(project.id, input.workItemId);
    if (!item) throw new Error('Work item not found');
    repo.assertRevision(project.id, input.workItemId, input.expectedRevision);
    session = resolveTaskPacketSession(ctx.db, ctx.userId, project.id, item);
  }
  const resources = { projectIds: [project.id], rootPaths: session ? [project.path, session.workingDir] : [project.path],
    revision: session ? createHash('sha256').update(canonical([revision, session.status, sessionRuntimeRevision(session, ctx.sessionManager)])).digest('hex') : revision };
  assertMcpTokenAuthority(ctx.db, ctx.userId, ctx.mcpTokenId!, resources);
  return resources;
}

function reviewTask(ctx: CommandContext, raw: unknown) {
  const input = lifecycleSchemas.pm_review_task.parse(raw);
  const repo = new ProjectManagerRepository(ctx.db, ctx.userId), item = repo.getWorkItem(input.projectId, input.workItemId)!;
  if (item.status !== 'ready_for_review') throw new Error('TASK_REVIEW_STATE_REQUIRED');
  if (input.decision === 'accepted') {
    const coverage = input.criteria ?? [];
    if (!item.acceptanceCriteria.length || coverage.length !== item.acceptanceCriteria.length ||
      new Set(coverage.map(v => v.index)).size !== coverage.length || coverage.some(v =>
        v.index >= item.acceptanceCriteria.length || !item.evidenceRefs.some(ref => ref.ref === v.evidenceRef)))
      throw new Error('TASK_ACCEPTANCE_REQUIRES_COMPLETE_DECLARED_EVIDENCE');
    const links = repo.listWorkItemLinks(input.projectId).filter(v => v.blockedWorkItemId === item.id);
    if (links.some(v => repo.getWorkItem(input.projectId, v.blockerWorkItemId)?.status !== 'done')) throw new Error('TASK_DEPENDENCIES_NOT_DONE');
  }
  const workItem = repo.updateWorkItemStatus(input.projectId, item.id, {
    expectedRevision: input.expectedRevision, status: input.decision === 'accepted' ? 'done' : 'in_progress',
    ...(input.decision === 'accepted' ? { manualCompletionReason: input.note } : {}),
    details: { declaredReview: { actorId: ctx.userId, decision: input.decision, note: input.note.slice(0, 512), noteTruncated: input.note.length > 512,
      criterionCount: input.criteria?.length ?? 0,
      criteriaDigest: createHash('sha256').update(canonical(input.criteria ?? [])).digest('hex'), source: 'operator_declared' } }
  });
  return { workItem, completionSource: 'operator_declared', ...repo.taskMetadata(input.projectId, item.id) };
}

function executeStage(ctx: CommandContext, raw: unknown) {
  const input = lifecycleSchemas.pm_manage_stage.parse(raw), repo = new ProjectManagerRepository(ctx.db, ctx.userId);
  if (input.action === 'create') return repo.createStage(input.projectId, input);
  if (input.action === 'update') return repo.updateStage(input.projectId, input.stageId, input);
  if (input.action === 'delete') return repo.deleteStage(input.projectId, input.stageId);
  return { stages: repo.reorderStages(input.projectId, input.stageIds) };
}

async function preflightDelete(ctx: CommandContext, raw: unknown): Promise<void> {
  const input = lifecycleSchemas.pm_delete_work_item.parse(raw);
  const { project, repo } = owned(ctx, input.projectId), item = repo.getWorkItem(project.id, input.workItemId)!;
  const session = resolveTaskPacketSession(ctx.db, ctx.userId, project.id, item);
  if (!session) return;
  if (!ctx.sessionManager) throw new Error('TASK_RUNTIME_STATE_UNVERIFIED');
  if (session.runtimeSessionName && await ctx.sessionManager.hasRuntimeTerminal(session.runtimeSessionName)) throw new Error('TASK_RUNTIME_MUST_BE_STOPPED');
  if (session.status === 'running' || ctx.sessionManager.getSession(session.id)) throw new Error('TASK_RUNTIME_MUST_BE_STOPPED');
  if (session.runtimeSessionName && !await ctx.sessionManager.isSessionExecutionStopped(ctx.userId, session.id, session.runtimeSessionName))
    throw new Error('TASK_RUNTIME_STATE_UNVERIFIED');
}

function assertTaskPlanMutable(repo: ProjectManagerRepository, projectId: string, workItemId: string): void {
  const item = repo.getWorkItem(projectId, workItemId);
  if (!item) throw new Error('Work item not found');
  if (['done', 'cancelled'].includes(item.status)) throw new Error('FINAL_TASK_PLAN_IMMUTABLE');
}

export function createMcpLifecycleCommands(): PlatformCommand[] {
  const execute: Record<string, (ctx: CommandContext, raw: unknown) => unknown> = {
    pm_set_goal(ctx, raw) { const v = lifecycleSchemas.pm_set_goal.parse(raw); return new ProjectManagerRepository(ctx.db, ctx.userId).upsertGoal(v.projectId, v); },
    pm_update_task_plan(ctx, raw) {
      const v = lifecycleSchemas.pm_update_task_plan.parse(raw);
      assertTaskPlanMutable(new ProjectManagerRepository(ctx.db, ctx.userId), v.projectId, v.workItemId);
      return mutateAssignedTask(ctx.db, ctx.userId, v.projectId, v.workItemId, v);
    },
    pm_manage_stage: executeStage,
    pm_manage_dependency(ctx, raw) { const v = lifecycleSchemas.pm_manage_dependency.parse(raw), repo = new ProjectManagerRepository(ctx.db, ctx.userId);
      assertTaskPlanMutable(repo, v.projectId, v.workItemId);
      if (v.action === 'add') return repo.addWorkItemDependency(v.projectId, v.workItemId, v.blockerWorkItemId);
      repo.removeWorkItemDependency(v.projectId, v.workItemId, v.blockerWorkItemId); return { removed: true }; },
    pm_attach_evidence(ctx, raw) { const v = lifecycleSchemas.pm_attach_evidence.parse(raw); return new ProjectManagerRepository(ctx.db, ctx.userId).attachEvidence(v.projectId, v.workItemId, v); },
    pm_review_task: reviewTask,
    pm_delete_work_item(ctx, raw) { const v = lifecycleSchemas.pm_delete_work_item.parse(raw); return { deleted: true,
      workItem: new ProjectManagerRepository(ctx.db, ctx.userId).deleteWorkItem(v.projectId, v.workItemId, v) }; }
  };
  return Object.entries(lifecycleSchemas).map(([name, schema]) => ({ id: `mcp.lifecycle.${name}`, capability: `mcp.lifecycle.${name}`,
    effect: 'database', inputSchema: schema, resolve: resolveLifecycle,
    ...(name === 'pm_delete_work_item' ? { prepare: preflightDelete } : {}),
    execute(ctx, input) { resolveLifecycle(ctx, input); return execute[name]!(ctx, input); } }));
}
