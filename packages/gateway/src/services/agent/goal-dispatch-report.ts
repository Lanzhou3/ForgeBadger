import { execFileSync } from 'node:child_process';
import type { ForgeBadgerEvent } from '../event-bus.js';
import { cliText, type CliSummary } from '../notifications/cli-observation.js';
import type { GoalRow } from './goal-store.js';
import { taskWorktreeDirFor } from './goal-task-workspace.js';
import { GOAL_MANAGED_PATHS } from './goal-workspace.js';

/**
 * Handoff report appended to the journal when a dispatched CLI turn settles:
 * the CLI's own final message (untrusted, already redacted upstream) and a
 * changed-files summary of the goal workspace. Nothing here may throw.
 */

const MAX_MESSAGE_CHARS = 520;
const MAX_FILE_LIST_CHARS = 600;
const MAX_PATHS = 30;
const MAX_PATH_CHARS = 160;
const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 1024 * 1024;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const GIT_SAFETY_ARGS = ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
  '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.quotepath=false'];

type SessionNotification = Extract<ForgeBadgerEvent, { type: 'session_notification' }>;

export function describeCliMessage(summary: CliSummary | undefined, notificationType: string): string {
  const failed = notificationType === 'task_failed';
  const excerpt = (failed ? summary?.error : summary?.result) ?? summary?.result ?? summary?.error;
  const text = excerpt ? cliText(excerpt.text, MAX_MESSAGE_CHARS) : '';
  if (!text) return 'no final message reported by this adapter';
  return `CLI report (unverified, from the CLI): ${JSON.stringify(text)}`;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', [...GIT_SAFETY_ARGS, ...args], {
    cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' }
  });
}

/** Paths changed vs. the base commit, including uncommitted and untracked; managed hook paths excluded. */
export function listWorktreeChanges(workspacePath: string, baseCommit: string): string[] {
  const split = (out: string): string[] => out.split('\0').filter(Boolean);
  const tracked = split(runGit(workspacePath, ['diff', '--name-only', '-z', '--no-ext-diff', '--no-renames', baseCommit, '--']));
  const untracked = split(runGit(workspacePath, ['ls-files', '--others', '--exclude-standard', '-z']));
  // Hook files ForgeBadger materializes for the CLI are never the goal's work.
  const managed = (path: string) => GOAL_MANAGED_PATHS.some(entry => path === entry || path.startsWith(`${entry.replace(/\/$/, '')}/`));
  return [...new Set([...tracked, ...untracked])].filter(path => !managed(path)).sort();
}

export function formatChangedFiles(paths: string[]): string {
  if (paths.length === 0) return 'changed files: none';
  const shown: string[] = [];
  let used = 0;
  for (const raw of paths.slice(0, MAX_PATHS)) {
    const entry = cliText(raw, MAX_PATH_CHARS, true);
    if (used + entry.length + 2 > MAX_FILE_LIST_CHARS) break;
    shown.push(entry);
    used += entry.length + 2;
  }
  const more = paths.length - shown.length;
  return `changed files (${paths.length}): ${shown.join(', ')}${more > 0 ? `, … ${more} more` : ''}`;
}

/** A task with its own worktree reports that tree's work (vs. its fork point with the goal branch), not the shared goal tree's. */
function describeTaskChangedFiles(goal: GoalRow, taskId: string): string | undefined {
  const directory = taskWorktreeDirFor(goal, taskId);
  if (!directory || !goal.workspace_branch) return undefined;
  try {
    const forkPoint = runGit(directory, ['merge-base', 'HEAD', `refs/heads/${goal.workspace_branch}`]).trim();
    if (!COMMIT.test(forkPoint)) return 'changed files: unavailable';
    return `task worktree ${formatChangedFiles(listWorktreeChanges(directory, forkPoint))}`;
  } catch { return 'changed files: unavailable'; }
}

export function describeChangedFiles(goal: GoalRow | undefined, taskId?: string): string {
  if (!goal?.workspace_kind) return 'changed files: unavailable';
  if (goal.workspace_kind !== 'worktree') return 'changed files: not available for copy workspaces';
  const taskReport = taskId ? describeTaskChangedFiles(goal, taskId) : undefined;
  if (taskReport) return taskReport;
  if (!goal.workspace_path || !goal.workspace_base_commit || !COMMIT.test(goal.workspace_base_commit)) return 'changed files: unavailable';
  try { return formatChangedFiles(listWorktreeChanges(goal.workspace_path, goal.workspace_base_commit)); }
  catch { return 'changed files: unavailable'; }
}

/** Suffix for the settle journal note (hook path). Never throws. */
export function buildHookReportSuffix(goal: GoalRow | undefined, event: SessionNotification, taskId?: string): string {
  let message: string;
  try { message = describeCliMessage(event.cliSummary, event.notificationType); }
  catch { message = 'no final message reported by this adapter'; }
  return ` ${message}. ${describeChangedFiles(goal, taskId)}.`;
}

/** Suffix for the dead-session / timeout path (no CLI message exists). */
export function buildEndedReportSuffix(goal: GoalRow | undefined, taskId?: string): string {
  return ` ${describeChangedFiles(goal, taskId)}.`;
}
