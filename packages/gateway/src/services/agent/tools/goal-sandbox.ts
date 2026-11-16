import { z } from 'zod';
import type { Database } from '../../../db/types.js';
import { ProjectRepository } from '../../../db/repositories/project-repository.js';
import { AgentError } from '../types.js';
import { workStore } from '../work-store.js';
import { editSandboxFile, readSandboxFile, runSandboxCommand, sandboxCommandEnv, writeSandboxFile } from '../goal-sandbox.js';
import { SANDBOX_FAILURE_HINT, goalCheckSandboxMode, prepareCheckSandbox, type GoalCheckIsolation } from '../command-sandbox.js';
import { ensureGoalWorkspace } from '../goal-workspace.js';
import { ensureTaskWorkspace, existingTaskWorkspace, taskWorkspaceIdentity, taskWorkspaceState } from '../goal-task-workspace.js';
import { goalIdForRun } from './goals.js';
import type { AgentTool, AgentToolContext } from '../tool-registry.js';

/**
 * Goal sandbox tools: file read/write/edit and command checks, all inside the
 * goal workspace (a git worktree for git projects, otherwise a project copy).
 * They never touch the real project (merge back is an owner-only console
 * operation), so file tools execute without owner approval. Every path is
 * workspace-relative and guarded against traversal, absolute paths, symlink
 * escapes, Git metadata and CLI configuration writes.
 */

const MAX_OUTPUT_CHARS = 2000;

const fileReadInput = z.object({
  path: z.string().trim().min(1).max(1024),
  /** Read from this task's own worktree (parallel dispatch) instead of the goal tree. */
  taskId: z.string().trim().min(1).max(128).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(5000).optional()
}).strict();

const fileWriteInput = z.object({
  path: z.string().trim().min(1).max(1024),
  content: z.string().max(512 * 1024)
}).strict();

const fileEditInput = z.object({
  path: z.string().trim().min(1).max(1024),
  old_string: z.string().min(1).max(512 * 1024),
  new_string: z.string().max(512 * 1024)
}).strict();

const runChecksInput = z.object({
  command: z.string().trim().min(1).max(4000),
  timeoutMs: z.number().int().min(1).max(600_000).optional(),
  taskId: z.string().trim().min(1).max(128).optional(),
  /** Host run instead of the OS sandbox; only meaningful (and owner-approved per call) when isolation is enabled. */
  unsandboxed: z.boolean().optional()
}).strict();

interface GoalSandboxTarget {
  goalId: string; sandboxDir: string; projectRoot: string;
  /** Which tree `sandboxDir` is. */
  tree: 'goal' | 'task-worktree';
}

/**
 * The goal workspace, or - with a taskId whose task owns a worktree - that
 * task's worktree. `requireTask` refuses instead of falling back to the goal tree.
 */
async function goalSandboxFor(context: AgentToolContext, taskId?: string, requireTask = false): Promise<GoalSandboxTarget> {
  const db = context.db as Database;
  const goalId = goalIdForRun(context);
  const goal = workStore(db, context.userId, goalId).getGoal(goalId);
  if (!goal?.project_id)
    throw new AgentError('COPILOT_GOAL_PROJECT_REQUIRED', 'This goal has no project; sandbox file tools are unavailable');
  const project = new ProjectRepository(db, context.userId).getById(goal.project_id);
  if (!project) throw new AgentError('COPILOT_PROJECT_NOT_FOUND', 'Goal project no longer exists');
  const workspace = await ensureGoalWorkspace(db, context.userId, goal, project);
  if (taskId) {
    const fresh = workStore(db, context.userId, goalId).getGoal(goalId) ?? goal;
    // A task whose directory was deleted but whose branch lives on is restored, never silently run against the goal tree.
    if (await taskWorkspaceState(db, fresh, taskId) === 'lost') await ensureTaskWorkspace(db, context.userId, fresh, taskId);
    const task = existingTaskWorkspace(db, fresh, taskId);
    if (task) return { goalId, sandboxDir: task.path, projectRoot: project.path, tree: 'task-worktree' };
    if (requireTask) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', 'This task has no task worktree; omit taskId to read the goal tree');
  }
  return { goalId, sandboxDir: workspace.path, projectRoot: project.path, tree: 'goal' };
}

function verifySummary(command: string, result: { stdout: string; stderr: string; durationMs: number }, isolation?: GoalCheckIsolation, treeIdentity?: string): string {
  const tail = (result.stdout || result.stderr).trim().slice(-MAX_OUTPUT_CHARS);
  // The isolation marker exists only when isolation is enabled, so records written with it off keep their shape.
  const marker = isolation ? `, ${isolation === 'seatbelt' ? 'sandboxed' : 'unsandboxed'}` : '';
  // The task tree fingerprint at verification time; goal_integrate_task refuses a tree that changed since.
  return `verify: ${command} (exit 0, ${result.durationMs}ms${marker})\n${tail}${treeIdentity ? `\nverified-tree: ${treeIdentity}` : ''}`;
}

/**
 * Run one check under the configured isolation mode. With isolation enabled
 * the default path is the OS sandbox and never falls back; the host path
 * needs `unsandboxed: true`, which the tool gate only lets through with the
 * owner's approval of this exact call (never a grant, never a sub-run).
 */
async function runCheck(context: AgentToolContext, workspace: { sandboxDir: string; projectRoot: string },
  input: { command: string; timeoutMs?: number | undefined; unsandboxed?: boolean | undefined }) {
  const signal = typeof context.signal === 'object' ? context.signal as AbortSignal : undefined;
  if (goalCheckSandboxMode() === 'off')
    return { result: await runSandboxCommand(workspace.sandboxDir, input.command, input.timeoutMs, signal), isolation: undefined };
  if (input.unsandboxed) {
    if (context.executionMode === 'coding' || !context.externalActionId)
      throw new AgentError('COPILOT_GOAL_UNSANDBOXED_APPROVAL', 'unsandboxed checks need the owner to approve this exact call from the parent goal run');
    return { result: await runSandboxCommand(workspace.sandboxDir, input.command, input.timeoutMs, signal), isolation: 'none' as const };
  }
  const plan = prepareCheckSandbox({ workspace: workspace.sandboxDir, projectRoot: workspace.projectRoot, command: input.command.trim(), env: sandboxCommandEnv() });
  try {
    return { result: await runSandboxCommand(workspace.sandboxDir, input.command, input.timeoutMs, signal, plan), isolation: 'seatbelt' as const };
  } finally { plan.cleanup(); }
}

export function createGoalSandboxTools(): AgentTool[] {
  return [
    {
      name: 'goal_file_read',
      description: 'Read a text file inside the goal sandbox by sandbox-relative path. With taskId, reads from the own worktree of that task (tasks dispatched with parallel: true) so you can inspect the work of a member. 读取沙箱内文件。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: fileReadInput,
      async execute(input, context) {
        const { path, offset, limit, taskId } = fileReadInput.parse(input);
        const { sandboxDir } = await goalSandboxFor(context, taskId, true);
        return readSandboxFile(sandboxDir, path, offset ?? 0, limit);
      }
    },
    {
      name: 'goal_file_write',
      description: 'Write a text file inside the goal sandbox (full content, parent directories created automatically). The real project is untouched until the owner merges. 全量写沙箱内文件。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: fileWriteInput,
      async execute(input, context) {
        const { sandboxDir } = await goalSandboxFor(context);
        const { path, content } = fileWriteInput.parse(input);
        return writeSandboxFile(sandboxDir, path, content);
      }
    },
    {
      name: 'goal_file_edit',
      description: 'Exact-string replacement in a sandbox file (old_string must match exactly once). 精确替换沙箱文件内容。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: fileEditInput,
      async execute(input, context) {
        const { sandboxDir } = await goalSandboxFor(context);
        const { path, old_string, new_string } = fileEditInput.parse(input);
        return editSandboxFile(sandboxDir, path, old_string, new_string);
      }
    },
    {
      name: 'goal_run_checks',
      description: 'Run a shell command with the sandbox as working directory; returns exit code, stdout/stderr, timeout status and which tree it ran in (workspace). With taskId the command runs in the own worktree of that task when it has one (verify where the work is), otherwise in the goal tree; with exit code 0, the task verify record is refreshed so the task can be marked passes. Needs owner approval unless the goal holds the sandbox_checks grant. When the result carries isolation (the host has OS isolation enabled) the command ran without network, with Git metadata read-only and no access outside the workspace; unsandboxed: true runs it on the host instead and always needs owner approval of that call, grant or not. 在沙箱内执行校验命令；需审批或 sandbox_checks 授权；退出码 0 时刷新对应任务的 verify 记录；unsandboxed 需逐次审批。',
      // Arbitrary shell (OS isolation is opt-in and macOS-only): operate-class, never auto-run as a read.
      risk: 'operate',
      requiresApproval: true,
      inputSchema: runChecksInput,
      async execute(input, context) {
        const { command, timeoutMs, taskId, unsandboxed } = runChecksInput.parse(input);
        const { goalId, sandboxDir, projectRoot, tree } = await goalSandboxFor(context, taskId);
        const { result, isolation } = await runCheck(context, { sandboxDir, projectRoot }, { command, timeoutMs, unsandboxed });
        let verified: unknown;
        if (taskId && result.exitCode === 0) {
          const store = workStore(context.db as Database, context.userId, goalId);
          const task = store.listTasks(goalId).find(entry => entry.id === taskId);
          if (!task) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
          // The verify gate only accepts the task's declared verify_command:
          // an unrelated green command must not satisfy the gate.
          if (!task.verify_command)
            throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Task '${task.description}' has no verify_command; run it without taskId`);
          if (task.verify_command.trim() !== command.trim())
            throw new AgentError('COPILOT_GOAL_VERIFY_MISMATCH',
              `Command does not match the task verify_command (${task.verify_command}); refusing to record verification`);
          const goal = store.getGoal(goalId);
          const identity = tree === 'task-worktree' && goal ? await taskWorkspaceIdentity(context.db as Database, goal, taskId).catch(() => undefined) : undefined;
          const refreshed = store.markTaskVerified(goalId, taskId, 0, verifySummary(command, result, isolation, identity));
          verified = { taskId: refreshed.id, verifiedAt: refreshed.verified_at };
        }
        return {
          ...result,
          workspace: tree,
          ...(isolation ? { isolation } : {}),
          ...(isolation === 'seatbelt' && result.exitCode !== 0 ? { sandboxHint: SANDBOX_FAILURE_HINT } : {}),
          ...(verified ? { verified } : {})
        };
      }
    }
  ];
}
