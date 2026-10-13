import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../../db/types.js';
import { ProjectRepository } from '../../../db/repositories/project-repository.js';
import { SessionRepository } from '../../../db/repositories/session-repository.js';
import { isAdapterId, type AdapterId } from '../../adapter-discovery.js';
import { createLaunchPlan, normalizeAdapter } from '../../session-launch-plan.js';
import type { InMemorySessionManager } from '../../session-manager.js';
import { dispatchSessionInput } from '../platform-access.js';
import { assertAdapterAutonomy } from '../goal-grants.js';
import { CopilotGoalStore } from '../goal-store.js';
import { AgentError } from '../types.js';
import { goalIdForRun } from './goals.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';

/**
 * Goal delegation tools (M3).
 *
 * - `goal_delegate` spawns a write-capable coding sub-run whose tool surface
 *   is the goal sandbox tools plus read-only platform tools, budgeted from
 *   the parent run. The sub-run is orchestration-owned (context
 *   `runCodingDelegate`), so it executes on the real ReAct loop with durable
 *   steps and trace, and its report returns as this tool's result.
 * - `goal_dispatch_task` hands a task to a real CLI session: create-or-reuse
 *   a session for the goal's project + adapter and submit the instructions
 *   through the existing programmatic-terminal-submit path with delivery
 *   confirmation. It is operate-risk: without the `pm_dispatch` grant it goes
 *   through the normal pending-action approval; the adapter must also be
 *   listed in FORGEBADGER_CLI_AUTONOMY_ADAPTERS.
 */

const delegateInput = z.object({
  taskId: z.string().trim().min(1).max(128),
  instructions: z.string().trim().min(1).max(8000)
}).strict();

const dispatchInput = z.object({
  taskId: z.string().trim().min(1).max(128),
  aiTool: z.string().trim().min(1).max(64),
  instructions: z.string().trim().min(1).max(4000)
}).strict();

function goalContextFor(context: AgentToolContext): { goalId: string; store: CopilotGoalStore; projectId: string } {
  const db = context.db as Database;
  const goalId = goalIdForRun(context);
  const store = new CopilotGoalStore(db, context.userId);
  const goal = store.getGoal(goalId);
  if (!goal?.project_id)
    throw new AgentError('COPILOT_GOAL_PROJECT_REQUIRED', 'This goal has no project; delegation and dispatch are unavailable');
  return { goalId, store, projectId: goal.project_id };
}

function taskOf(store: CopilotGoalStore, goalId: string, taskId: string) {
  const task = store.listTasks(goalId).find(entry => entry.id === taskId);
  if (!task) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
  return task;
}

export interface CodingDelegateResult { runId: string; status: string; report: string }

export function createGoalDelegateTools(): AgentTool[] {
  return [
    {
      name: 'goal_delegate',
      description: 'Delegate one goal task to a write-capable coding sub-run that works inside the goal sandbox (goal_file_*/goal_run_checks, read-only platform reads; 24 steps; budget inherited from this run). The sub-run report returns as the tool result; a failed delegate does not block the goal. 把单个任务委派给沙箱内的 coding 子 run。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: delegateInput,
      async execute(input, context) {
        const { goalId, store, projectId } = goalContextFor(context);
        const { taskId, instructions } = delegateInput.parse(input);
        taskOf(store, goalId, taskId);
        const runCodingDelegate = context.runCodingDelegate as
          | ((delegate: { goalId: string; projectId: string; taskId: string; instructions: string }) => Promise<CodingDelegateResult>)
          | undefined;
        if (typeof runCodingDelegate !== 'function')
          throw new AgentError('COPILOT_GOAL_CONTEXT_REQUIRED', 'goal_delegate is only available inside an orchestrated goal run');
        return runCodingDelegate({ goalId, projectId, taskId, instructions });
      }
    },
    {
      name: 'goal_dispatch_task',
      description: 'Dispatch one goal task to a real CLI session: creates a dedicated session for the goal project + adapter and submit the instructions with delivery confirmation. Requires the pm_dispatch grant (otherwise owner approval) and the adapter listed in FORGEBADGER_CLI_AUTONOMY_ADAPTERS. Dispatch is not completion: the task still needs its verify_command to pass. 把任务派发给真实 CLI 会话执行。',
      risk: 'operate',
      requiresApproval: true,
      inputSchema: dispatchInput,
      async execute(input, context) {
        const db = context.db as Database;
        const { goalId, store, projectId } = goalContextFor(context);
        const { taskId, aiTool, instructions } = dispatchInput.parse(input);
        if (!isAdapterId(aiTool)) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Unknown adapter '${aiTool}'`);
        assertAdapterAutonomy(aiTool);
        taskOf(store, goalId, taskId);
        const sessionManager = context.sessionManager as InMemorySessionManager | undefined;
        if (!sessionManager) throw new AgentError('SESSION_RUNTIME_UNAVAILABLE', 'Session runtime unavailable');
        const project = new ProjectRepository(db, context.userId).getById(projectId);
        if (!project) throw new AgentError('COPILOT_PROJECT_NOT_FOUND', 'Goal project no longer exists');
        const repository = new SessionRepository(db, context.userId);
        // Always a fresh, dedicated session: reusing an owner-interactive
        // running session would interleave goal instructions with the user's
        // own composer state.
        const row = repository.create({
          projectId: project.id, name: `Goal task: ${taskId.slice(0, 24)}`, aiTool,
          workingDir: project.path, credentialMode: 'host_environment'
        });
        const launchPlan = createLaunchPlan({ adapter: aiTool as AdapterId, projectRoot: project.path, sessionId: row.id });
        const attachToken = randomUUID();
        repository.update(row.id, { attachToken });
        const started = await sessionManager.createSession({ userId: context.userId, sessionId: row.id, launchPlan, attachToken });
        repository.update(row.id, { status: 'running', runtimeSessionName: started.runtimeSessionName, attachToken: started.attachToken });
        const session = repository.getById(row.id)!;
        const created = true;
        const adapter = normalizeAdapter(session.aiTool);
        if (!adapter) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Unsupported session adapter '${session.aiTool}'`);
        const result = await dispatchSessionInput(sessionManager, session.id, adapter, instructions, {});
        store.setTaskDispatched(goalId, taskId, session.id);
        store.appendJournal(goalId, typeof context.runId === 'string' ? context.runId : null,
          `Dispatched task '${taskId}' to CLI session ${session.id} (adapter ${aiTool}, ${created ? 'created' : 'reused'}).`);
        return { ...result, adapter: aiTool, sessionCreated: created };
      }
    }
  ];
}
