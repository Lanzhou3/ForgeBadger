import { z } from 'zod';
import type { Database } from '../../../db/types.js';
import { ProjectRepository } from '../../../db/repositories/project-repository.js';
import { AgentError } from '../types.js';
import { CopilotGoalStore } from '../goal-store.js';
import { editSandboxFile, readSandboxFile, runSandboxCommand, writeSandboxFile } from '../goal-sandbox.js';
import { ensureGoalWorkspace } from '../goal-workspace.js';
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
  taskId: z.string().trim().min(1).max(128).optional()
}).strict();

async function goalSandboxFor(context: AgentToolContext): Promise<{ goalId: string; sandboxDir: string }> {
  const db = context.db as Database;
  const goalId = goalIdForRun(context);
  const goal = new CopilotGoalStore(db, context.userId).getGoal(goalId);
  if (!goal?.project_id)
    throw new AgentError('COPILOT_GOAL_PROJECT_REQUIRED', 'This goal has no project; sandbox file tools are unavailable');
  const project = new ProjectRepository(db, context.userId).getById(goal.project_id);
  if (!project) throw new AgentError('COPILOT_PROJECT_NOT_FOUND', 'Goal project no longer exists');
  const workspace = await ensureGoalWorkspace(db, context.userId, goal, project);
  return { goalId, sandboxDir: workspace.path };
}

function verifySummary(command: string, result: { stdout: string; stderr: string; durationMs: number }): string {
  const tail = (result.stdout || result.stderr).trim().slice(-MAX_OUTPUT_CHARS);
  return `verify: ${command} (exit 0, ${result.durationMs}ms)\n${tail}`;
}

export function createGoalSandboxTools(): AgentTool[] {
  return [
    {
      name: 'goal_file_read',
      description: 'Read a text file inside the goal sandbox by sandbox-relative path. 读取沙箱内文件。',
      risk: 'read',
      requiresApproval: false,
      inputSchema: fileReadInput,
      async execute(input, context) {
        const { sandboxDir } = await goalSandboxFor(context);
        const { path, offset, limit } = fileReadInput.parse(input);
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
      description: 'Run a shell command with the sandbox as working directory; returns exit code, stdout/stderr and timeout status. With taskId and exit code 0, the task verify record is refreshed so the task can be marked passes. Runs a host shell, so it needs owner approval unless the goal holds the sandbox_checks grant. 在沙箱内执行校验命令；需审批或 sandbox_checks 授权；退出码 0 时刷新对应任务的 verify 记录。',
      // Arbitrary host shell (no OS sandbox): operate-class, never auto-run as a read.
      risk: 'operate',
      requiresApproval: true,
      inputSchema: runChecksInput,
      async execute(input, context) {
        const { goalId, sandboxDir } = await goalSandboxFor(context);
        const { command, timeoutMs, taskId } = runChecksInput.parse(input);
        const result = await runSandboxCommand(sandboxDir, command, timeoutMs, typeof context.signal === 'object' ? context.signal as AbortSignal : undefined);
        let verified: unknown;
        if (taskId && result.exitCode === 0) {
          const store = new CopilotGoalStore(context.db as Database, context.userId);
          const task = store.listTasks(goalId).find(entry => entry.id === taskId);
          if (!task) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
          // The verify gate only accepts the task's declared verify_command:
          // an unrelated green command must not satisfy the gate.
          if (!task.verify_command)
            throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Task '${task.description}' has no verify_command; run it without taskId`);
          if (task.verify_command.trim() !== command.trim())
            throw new AgentError('COPILOT_GOAL_VERIFY_MISMATCH',
              `Command does not match the task verify_command (${task.verify_command}); refusing to record verification`);
          const refreshed = store.markTaskVerified(goalId, taskId, 0, verifySummary(command, result));
          verified = { taskId: refreshed.id, verifiedAt: refreshed.verified_at };
        }
        return { ...result, ...(verified ? { verified } : {}) };
      }
    }
  ];
}
