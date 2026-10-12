import { readProjectGitStatus } from '../../development/project-git-status.js';
import { z } from 'zod';
import type { AgentTool } from '../tool-registry.js';
import { ownedProject } from '../../development/commands.js';
import { readProjectDiff } from '../../development/project-diff.js';
const schema = z.object({ projectId: z.string().min(1).max(128), mode: z.enum(['working','staged']).default('working'),
  includeUntracked: z.boolean().default(false), offset: z.number().int().min(0).max(2000).default(0) }).strict();
export function createProjectDiffTools(): AgentTool[] {
  return [{ name: 'get_project_git_status',
    description: 'Count unique uncommitted Git status paths in a project. 查询项目工作区未提交项总数、已暂存、未暂存、未跟踪、冲突数量。 Use this for counts or clean/dirty status; never count a read_project_diff page. Includes hidden/large/secret files in counts, exposes no paths or contents. Categories can overlap (including staged deletion plus untracked); use total for deduplicated paths. Excludes ignored files and submodule worktree changes. Errors mean unknown, never zero.',
    risk: 'read', requiresApproval: false, inputSchema: z.object({ projectId: z.string().min(1).max(128) }).strict(),
    async execute(raw, context) { const { projectId } = raw as { projectId: string }; return readProjectGitStatus(ownedProject(context, projectId).path, context.signal instanceof AbortSignal ? context.signal : undefined); }
  }, { name: 'read_project_diff', description: 'Read a PAGE of source changes, NOT repository status or total counts (use get_project_git_status). Empty files with truncated=true NEVER means clean. Read source changes: working compares permitted files to the index; staged compares index to HEAD. Optional untracked files. Returns bounded redacted diff hunks and original content hashes. No execution or mutation; skips secrets, hidden files, symlinks, submodules, >64KiB files and unsupported git roots. Continue with nextOffset.',
    risk: 'read', requiresApproval: false, inputSchema: schema,
    async execute(raw, context) { const input = schema.parse(raw); return readProjectDiff(ownedProject(context, input.projectId).path, input, context.signal instanceof AbortSignal ? context.signal : undefined); }
  }];
}
