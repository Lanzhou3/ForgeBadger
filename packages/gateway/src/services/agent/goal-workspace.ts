import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../../db/types.js';
import { canUseProjectPath } from '../../db/repositories/managed-project-access.js';
import {
  adoptGoalWorktree, commitGoalWorktree, integrateGoalWorktree, listGoalWorktreeChanges, provisionWorktree, readGoalWorktreeDiff
} from '../collaboration/git-workspaces.js';
import { CollaborationError } from '../collaboration/types.js';
import { FORGEBADGER_OPENCODE_PLUGIN_RELATIVE } from '../opencode-notification-settings.js';
import { governedProject } from '../project-manager/access.js';
import {
  diffGoalSandbox, ensureGoalSandbox, goalSandboxBase, goalSandboxDir, isBinary, mergeGoalSandbox, unifiedDiff,
  type GoalFileChange, type GoalMergeResult
} from './goal-sandbox.js';
import { CopilotGoalStore, type GoalRow, type GoalWorkspaceRecord } from './goal-store.js';
import { AgentError } from './types.js';

/**
 * Goal workspace: where every goal edit lands before the owner merges it.
 * Git-backed projects get a managed worktree on `forgebadger/goal-<goalId>`
 * so sandbox file tools, verify commands and dispatched CLI sessions all work
 * on one tree; non-git projects keep the copy sandbox. Legacy goals that
 * already own a copy sandbox stay on it. Shared/team projects are refused:
 * they must go through the delivery workflow.
 */

export type GoalWorkspace = GoalWorkspaceRecord;

/** Project-local files ForgeBadger writes for CLI hooks: never committed or merged from a goal worktree. */
export const GOAL_MANAGED_PATHS: readonly string[] = [
  '.claude/settings.local.json', '.codex/hooks.json', '.codex/hooks/forgebadger-notify.mjs', FORGEBADGER_OPENCODE_PLUGIN_RELATIVE
];
const GOAL_BRANCH_PREFIX = 'forgebadger/goal-';
const MAX_DIFF_RESPONSE_BYTES = 512 * 1024;
const MAX_UNTRACKED_DIFF_BYTES = 512 * 1024;

const worktreeBases = new WeakMap<Database, string>();
const provisioning = new Map<string, Promise<GoalWorkspace>>();

/** Sibling of the copy-sandbox root: `<state>/goal-worktrees` (0700, canonical). */
export function goalWorktreeBase(db: Database): string {
  const existing = worktreeBases.get(db);
  if (existing) return existing;
  const raw = path.join(path.dirname(goalSandboxBase(db)), 'goal-worktrees');
  fs.mkdirSync(raw, { recursive: true, mode: 0o700 });
  const base = fs.realpathSync(raw);
  fs.chmodSync(base, 0o700);
  worktreeBases.set(db, base);
  return base;
}

/** Personal projects only: shared/managed roots belong to the delivery workflow. */
export function assertGoalProjectWritable(db: Database, userId: string, projectId: string, projectPath: string): void {
  if (governedProject(db, projectId) || !canUseProjectPath(db, userId, projectPath))
    throw new AgentError('COPILOT_GOAL_SHARED_PROJECT', 'Goal workspaces are limited to personal projects; shared projects use the team delivery workflow');
}

/** The goal's recorded (or legacy copy) workspace, without creating one. */
export function existingGoalWorkspace(db: Database, goal: GoalRow): GoalWorkspace | undefined {
  if (goal.workspace_kind && goal.workspace_path) {
    return {
      kind: goal.workspace_kind, path: goal.workspace_path,
      ...(goal.workspace_branch ? { branch: goal.workspace_branch } : {}),
      ...(goal.workspace_base_commit ? { baseCommit: goal.workspace_base_commit } : {}),
      ...(goal.workspace_target_branch ? { targetBranch: goal.workspace_target_branch } : {})
    };
  }
  const legacy = goalSandboxDir(db, goal.id);
  return fs.existsSync(legacy) ? { kind: 'copy', path: legacy } : undefined;
}

function assertPresent(workspace: GoalWorkspace): GoalWorkspace {
  if (!fs.existsSync(workspace.path))
    throw new AgentError('COPILOT_GOAL_SANDBOX_MISSING', 'The goal workspace was removed from disk; it cannot be recreated without losing its history');
  return workspace;
}

function isGitRoot(projectRoot: string): boolean {
  try { fs.lstatSync(path.join(projectRoot, '.git')); return true; } catch { return false; }
}

async function provisionGoalWorkspace(db: Database, userId: string, goal: GoalRow, projectRoot: string): Promise<GoalWorkspace> {
  const store = new CopilotGoalStore(db, userId);
  const source = fs.realpathSync(projectRoot);
  if (!isGitRoot(source)) {
    const directory = ensureGoalSandbox(source, goalSandboxDir(db, goal.id));
    return existingGoalWorkspace(db, store.setWorkspace(goal.id, { kind: 'copy', path: directory }))!;
  }
  const workspacesRoot = goalWorktreeBase(db);
  const target = path.join(workspacesRoot, goal.id);
  const branch = `${GOAL_BRANCH_PREFIX}${goal.id}`;
  try {
    let record: GoalWorkspaceRecord;
    if (fs.existsSync(target)) {
      const adopted = await adoptGoalWorktree({ sourcePath: source, path: target, branch });
      record = { kind: 'worktree', path: target, branch, ...adopted };
    } else {
      const created = await provisionWorktree({ sourcePath: source, workspacesRoot, runId: goal.id, branchPrefix: 'forgebadger/goal-' });
      record = { kind: 'worktree', path: created.path, branch: created.branch, baseCommit: created.baseCommit, targetBranch: created.targetBranch };
    }
    return existingGoalWorkspace(db, store.setWorkspace(goal.id, record))!;
  } catch (error) {
    throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED',
      'Could not create the goal git worktree (the project needs a commit on a checked-out branch)');
  }
}

/**
 * Resolve or lazily create the goal workspace. Creation is single-flight per
 * goal and the database record is written once, so concurrent tool calls
 * converge on the same tree.
 */
export async function ensureGoalWorkspace(db: Database, userId: string, goal: GoalRow, project: { id: string; path: string }): Promise<GoalWorkspace> {
  const existing = existingGoalWorkspace(db, goal);
  if (existing) {
    if (!goal.workspace_kind) new CopilotGoalStore(db, userId).setWorkspace(goal.id, existing);
    return assertPresent(existing);
  }
  assertGoalProjectWritable(db, userId, project.id, project.path);
  const key = `${userId}:${goal.id}`;
  const inflight = provisioning.get(key);
  if (inflight) return inflight;
  const pending = provisionGoalWorkspace(db, userId, goal, project.path).finally(() => provisioning.delete(key));
  provisioning.set(key, pending);
  return pending;
}

function goalGitError(error: unknown, code: string, fallback: string): AgentError {
  if (error instanceof AgentError) return error;
  if (error instanceof CollaborationError) {
    const message = error.code === 'COLLABORATION_GIT_FAILED' ? fallback : error.message;
    return new AgentError(code, message);
  }
  return new AgentError(code, fallback);
}

function worktreeParts(workspace: GoalWorkspace): { branch: string; baseCommit: string; targetBranch: string } {
  if (!workspace.branch || !workspace.baseCommit || !workspace.targetBranch)
    throw new AgentError('COPILOT_GOAL_WORKSPACE_FAILED', 'Goal worktree record is incomplete');
  return { branch: workspace.branch, baseCommit: workspace.baseCommit, targetBranch: workspace.targetBranch };
}

function untrackedDiff(workspace: GoalWorkspace, relative: string): string {
  const file = path.join(workspace.path, relative);
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) return `--- /dev/null\n+++ b/${relative}\n@@ non-regular file omitted @@\n`;
  if (stat.size > MAX_UNTRACKED_DIFF_BYTES) return `--- /dev/null\n+++ b/${relative}\n@@ file too large to diff @@\n`;
  const buffer = fs.readFileSync(file);
  if (isBinary(buffer)) return `--- /dev/null\n+++ b/${relative}\n@@ binary file omitted @@\n`;
  return unifiedDiff('', buffer.toString('utf8'), relative).diff;
}

/** What an owner merge would apply, per file, capped at 512 KiB per response. */
export async function diffGoalWorkspace(workspace: GoalWorkspace, projectRoot: string): Promise<{ files: GoalFileChange[]; truncated: boolean }> {
  if (workspace.kind === 'copy') return diffGoalSandbox(workspace.path, projectRoot);
  const { baseCommit } = worktreeParts(assertPresent(workspace));
  try {
    const changes = await listGoalWorktreeChanges({ path: workspace.path, baseCommit, excludePaths: GOAL_MANAGED_PATHS });
    const files: GoalFileChange[] = [];
    let bytes = 0;
    for (const change of changes) {
      let diff = change.status === 'deleted' || fs.existsSync(path.join(workspace.path, change.path))
        ? await readGoalWorktreeDiff({ path: workspace.path, baseCommit, filePath: change.path })
        : '';
      if (!diff && change.status === 'added') diff = untrackedDiff(workspace, change.path);
      bytes += Buffer.byteLength(diff) + change.path.length + 32;
      if (bytes > MAX_DIFF_RESPONSE_BYTES) return { files, truncated: true };
      files.push({ path: change.path, status: change.status, diff, truncated: false });
    }
    return { files, truncated: false };
  } catch (error) {
    throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not read the goal worktree diff');
  }
}

export interface GoalWorkspaceMergeResult extends GoalMergeResult { commit?: string }

function commitMessage(goal: GoalRow): string {
  const title = goal.title.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, 120) || 'goal changes';
  return `goal: ${title}\n\nForgeBadger Copilot goal ${goal.id}`;
}

/**
 * Owner merge. Copy sandboxes keep the three-way file merge; worktrees commit
 * pending edits on the goal branch and fast-forward the project branch (see
 * integrateGoalWorktree), then advance the recorded merge base.
 */
export async function mergeGoalWorkspace(db: Database, userId: string, goal: GoalRow, workspace: GoalWorkspace, project: { id: string; path: string }): Promise<GoalWorkspaceMergeResult> {
  assertGoalProjectWritable(db, userId, project.id, project.path);
  assertPresent(workspace);
  if (workspace.kind === 'copy') return mergeGoalSandbox(workspace.path, project.path);
  const { branch, targetBranch } = worktreeParts(workspace);
  try {
    await commitGoalWorktree({ path: workspace.path, branch, message: commitMessage(goal), excludePaths: GOAL_MANAGED_PATHS });
    const integration = await integrateGoalWorktree({
      sourcePath: fs.realpathSync(project.path), path: workspace.path, branch, targetBranch, excludePaths: GOAL_MANAGED_PATHS
    });
    new CopilotGoalStore(db, userId).setWorkspaceBase(goal.id, integration.commit);
    return {
      merged: integration.changes.filter(change => change.status !== 'deleted').map(change => change.path).sort(),
      deleted: integration.changes.filter(change => change.status === 'deleted').map(change => change.path).sort(),
      kept: [],
      ...(integration.changes.length ? { commit: integration.commit } : {})
    };
  } catch (error) {
    throw goalGitError(error, 'COPILOT_GOAL_MERGE_CONFLICT', 'Git refused the goal merge; inspect the goal branch manually');
  }
}
