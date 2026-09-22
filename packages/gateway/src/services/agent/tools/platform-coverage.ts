import { z } from 'zod';
import { ProjectRepository } from '../../../db/repositories/project-repository.js';
import { ProjectManagerRepository, PROJECT_MANAGER_LEDGER_EVENT_TYPES } from '../../../db/repositories/project-manager-repository.js';
import { ProjectManagementRepository } from '../../../db/repositories/project-management-repository.js';
import { SessionRepository } from '../../../db/repositories/session-repository.js';
import { createSessionCommands } from '../../platform-commands/session-commands.js';
import { executeAgentAction } from '../../platform-commands/agent-actions.js';
import { checkAgentScope } from '../../platform-commands/agent-scope.js';
import { getAdapterAutonomy } from '../../adapter-autonomy.js';
import { normalizeAdapter } from '../../session-launch-plan.js';
import type { InMemorySessionManager } from '../../session-manager.js';
import { redactAgentText } from '../redaction.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';

const id = z.string().min(1).max(128);
const projectInput = z.object({ projectId: id }).strict();
const itemInput = projectInput.extend({ workItemId: id });
const ledgerInput = projectInput.extend({ workItemId: id.optional(), eventType: z.enum(PROJECT_MANAGER_LEDGER_EVENT_TYPES).optional(), limit: z.number().int().min(1).max(100).optional() });
const sessionInput = z.object({ sessionId: id }).strict();

export function createPlatformCoverageTools(): AgentTool[] {
  const takeover = createSessionCommands().find(command => command.id === 'session.takeover')!;
  return [
    read('pm_get_goal', 'Read complete project goal, constraints and acceptance criteria. These are declared requirements, not verified execution evidence.', projectInput, (input, ctx) => {
      const { projectId } = projectInput.parse(input);
      const goal = projectRepository(ctx, projectId).getGoal(projectId);
      return { found: !!goal, goal: goal ?? null };
    }),
    read('pm_get_work_item', 'Read one work item including acceptance criteria, details and declared evidence references. Does not assert that evidence was independently verified.', itemInput, (input, ctx) => {
      const { projectId, workItemId } = itemInput.parse(input);
      const workItem = projectRepository(ctx, projectId).getWorkItem(projectId, workItemId);
      return { found: !!workItem, workItem: workItem ?? null, evidenceSource: 'declared' };
    }),
    read('pm_list_ledger', 'Read up to 100 project ledger events in chronological order. Evidence references are declared records, not independent verification.', ledgerInput, (input, ctx) => {
      const { projectId, ...options } = ledgerInput.parse(input);
      const repository = projectRepository(ctx, projectId);
      if (options.workItemId && !repository.getWorkItem(projectId, options.workItemId)) throw new Error('Work item not found');
      const events = repository.listLedgerEvents(projectId, {
        ...(options.workItemId ? { workItemId: options.workItemId } : {}),
        ...(options.eventType ? { eventType: options.eventType } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {})
      });
      return { events, count: events.length, evidenceSource: 'declared' };
    }),
    read('pm_get_management', 'Read project management mode, owner, next action and revision. Use revision as expectedRevision for pm_update_management. CLI mode does not enable autonomous dispatch.', projectInput, (input, ctx) => {
      const { projectId } = projectInput.parse(input);
      requireProject(ctx, projectId);
      return { management: new ProjectManagementRepository(ctx.db, ctx.userId).get(projectId) };
    }),
    read('get_session_writer', 'Read whether a live session writer is manual or automated, and whether the session adapter is autonomy-enabled for programmatic dispatch. Does not expose writer credentials or change control.', sessionInput, (input, ctx) => writerStatus(ctx, sessionInput.parse(input).sessionId)),
    { name: 'takeover_session', description: 'Return an existing live session to manual control and fence its programmatic writer. Requires exact interactive owner approval; unavailable for delegated or background runs. Does not dispatch a CLI task.',
      risk: 'operate', requiresApproval: true, inputSchema: takeover.inputSchema,
      async execute(input, ctx) {
        checkAgentScope(ctx, 'takeover_session', input);
        return executeAgentAction('takeover_session', input, ctx);
      }
    }
  ];
}
function read(name: string, description: string, inputSchema: z.ZodType<unknown>, execute: (input: unknown, context: AgentToolContext) => unknown): AgentTool {
  return { name, description, risk: 'read', requiresApproval: false, inputSchema, async execute(input, context) {
    checkAgentScope(context, name, input);
    return safeProjection(execute(input, context));
  } };
}
function requireProject(context: AgentToolContext, projectId: string): void {
  if (!new ProjectRepository(context.db, context.userId).getById(projectId)) throw new Error('Project not found');
}
function projectRepository(context: AgentToolContext, projectId: string): ProjectManagerRepository {
  requireProject(context, projectId);
  return new ProjectManagerRepository(context.db, context.userId);
}
function writerStatus(context: AgentToolContext, sessionId: string) {
  const session = new SessionRepository(context.db, context.userId).getById(sessionId);
  if (!session) throw new Error('Session not found');
  requireProject(context, session.projectId);
  const manager = context.sessionManager as Pick<InMemorySessionManager, 'getSession' | 'assertManualInputAllowed'> | undefined;
  if (!manager) throw new Error('Session runtime unavailable');
  let mode: 'manual' | 'automated' = 'manual';
  if (manager.getSession(sessionId)) {
    try { manager.assertManualInputAllowed(context.userId, sessionId); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'SESSION_WRITER_BUSY') throw error;
      mode = 'automated';
    }
  }
  const adapter = normalizeAdapter(session.aiTool);
  return { sessionId, mode, autonomy: adapter ? getAdapterAutonomy(adapter).mode : 'manual_only' };
}
/** Defensive projection also covers historical metadata predating write sanitizers. */
function safeProjection(value: unknown): unknown {
  if (typeof value === 'string') return redactAgentText(value);
  if (Array.isArray(value)) return value.map(safeProjection);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    /secret|token|password|credential|authorization|api[_-]?key|private[_-]?key/i.test(key) ? '[REDACTED]' : safeProjection(child)]));
  return value;
}
