import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../../db/types.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import type { InMemorySessionManager } from '../session-manager.js';
import {
  forkGoalTaskWorktree, goalTaskBranchExists, goalTaskBranchIntegrated, goalTaskBranchName, GoalTaskConflictError, goalTaskTreeIdentity,
  inspectGoalTaskWorktree, integrateGoalTaskWorktree, listGoalTaskWorktreeChanges, removeIntegratedGoalTaskWorktree, restoreGoalTaskWorktree, type GoalWorktreeChange
} from '../collaboration/git-workspaces.js';
import type { GoalRow, GoalTaskRow } from './goal-store.js';
import { workStore } from './work-store.js';
import { GOAL_MANAGED_PATHS, goalGitError, goalWorktreeBase, type GoalWorkspace } from './goal-workspace.js';
import { AgentError } from './types.js';

/**
 * Per-task git worktrees for parallel writers. A task worktree lives at
 * `<goal-worktrees>/tasks-<goalId>/<taskId>` on `forgebadger/goal-task-<taskId>`,
 * forked from the goal branch tip. Nothing is stored: the directory on disk IS
 * the record, so there is no schema and no record to drift. Integration into
 * the goal branch is serialized by the repository lock and never touches the
 * project branch or the project working tree (the owner's HTTP merge keeps
 * that authority). Copy-sandbox goals cannot have task worktrees.
 *
 * Cleanup happens after the owner's merge (`cleanupIntegratedTaskWorkspaces`):
 * a task worktree and its branch are removed only when all of their work is in
 * the goal branch; anything else stays on disk.
 */

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TASKS_DIR_PREFIX = 'tasks-';

const forking = new Map<string, Promise<GoalWorkspace>>();

function unavailable(message: string): AgentError {
  return new AgentError('COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE', message);
}

/** Derived location for a task worktree, or undefined when the goal cannot have one (copy workspace, malformed ids). */
function taskWorktreeLocation(db: Database, goal: GoalRow, taskId: string): { root: string; path: string } | undefined {
  if (goal.workspace_kind !== 'worktree' || !goal.workspace_branch || !UUID.test(goal.id) || !UUID.test(taskId)) return undefined;
  const root = path.join(goalWorktreeBase(db), `${TASKS_DIR_PREFIX}${goal.id}`);
  return { root, path: path.join(root, taskId) };
}

/** Same derived path without a database handle (report path); the goal worktree must sit at `<base>/<goalId>`. */
export function taskWorktreeDirFor(goal: GoalRow, taskId: string): string | undefined {
  if (goal.workspace_kind !== 'worktree' || !goal.workspace_path || !UUID.test(goal.id) || !UUID.test(taskId)) return undefined;
  if (path.basename(goal.workspace_path) !== goal.id) return undefined;
  const directory = path.join(path.dirname(goal.workspace_path), `${TASKS_DIR_PREFIX}${goal.id}`, taskId);
  return isLinkedWorktree(directory) ? directory : undefined;
}

function isLinkedWorktree(directory: string): boolean {
  try { return fs.lstatSync(directory).isDirectory() && fs.lstatSync(path.join(directory, '.git')).isFile(); }
  catch { return false; }
}

function asWorkspace(goal: GoalRow, taskId: string, directory: string): GoalWorkspace {
  return { kind: 'worktree', path: directory, branch: goalTaskBranchName(taskId), targetBranch: goal.workspace_branch! };
}

/** Sync disk-only check without task ownership validation; for callers that already iterate the goal's own tasks. */
export function taskWorktreeExists(db: Database, goal: GoalRow, taskId: string): boolean {
  const location = taskWorktreeLocation(db, goal, taskId);
  return !!location && isLinkedWorktree(location.path);
}

/** The task's worktree when it exists on disk; a task id that is not a task of this goal never resolves. */
export function existingTaskWorkspace(db: Database, goal: GoalRow, taskId: string): GoalWorkspace | undefined {
  const location = taskWorktreeLocation(db, goal, taskId);
  if (!location || !isLinkedWorktree(location.path)) return undefined;
  if (!workStore(db, goal.user_id, goal.id).listTasks(goal.id).some(task => task.id === taskId)) return undefined;
  return asWorkspace(goal, taskId, location.path);
}

function goalTrees(goal: GoalRow): { goalPath: string; goalBranch: string } {
  if (goal.workspace_kind !== 'worktree' || !goal.workspace_path || !goal.workspace_branch)
    throw unavailable('Task worktrees need a git-backed goal workspace; this goal uses a copy workspace');
  return { goalPath: goal.workspace_path, goalBranch: goal.workspace_branch };
}

function isTaskOfGoal(db: Database, goal: GoalRow, taskId: string): boolean {
  return workStore(db, goal.user_id, goal.id).listTasks(goal.id).some(task => task.id === taskId);
}

function assertGoalTask(db: Database, userId: string, goalId: string, taskId: string): GoalRow {
  const store = workStore(db, userId, goalId);
  const goal = store.getGoal(goalId);
  if (!goal || !store.listTasks(goalId).some(task => task.id === taskId)) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
  if (!UUID.test(taskId)) throw unavailable('Task id is not a valid UUID');
  return goal;
}

/**
 * 'present' = directory on disk; 'lost' = directory gone but the task branch
 * (and its committed work) still exists; 'none' = never forked. The branch,
 * not just the directory, decides whether a task owns a workspace.
 */
export type TaskWorkspaceState = 'none' | 'present' | 'lost';

export async function taskWorkspaceState(db: Database, goal: GoalRow, taskId: string): Promise<TaskWorkspaceState> {
  const location = taskWorktreeLocation(db, goal, taskId);
  if (!location) return 'none';
  if (isLinkedWorktree(location.path)) return isTaskOfGoal(db, goal, taskId) ? 'present' : 'none';
  if (!isTaskOfGoal(db, goal, taskId)) return 'none';
  try { return await goalTaskBranchExists({ goalPath: goalTrees(goal).goalPath, taskBranch: goalTaskBranchName(taskId) }) ? 'lost' : 'none'; }
  catch (error) { throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not inspect the task branch'); }
}

/** Sync best-effort variant for the board sync path: true unless the task provably has no directory and no branch. */
export function taskWorkspaceMayExist(goal: GoalRow, taskId: string): boolean {
  if (goal.workspace_kind !== 'worktree' || !goal.workspace_path || !UUID.test(taskId)) return false;
  if (taskWorktreeDirFor(goal, taskId)) return true;
  try {
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'rev-parse', '-q', '--verify', `refs/heads/${goalTaskBranchName(taskId)}^{commit}`], {
      cwd: goal.workspace_path, stdio: 'ignore', timeout: 5000,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' }
    });
    return true;
  } catch (error) { return (error as { status?: number }).status !== 1; }
}

/** Running dispatches whose CLI session works in the shared goal tree (one writer allowed there). */
export function sharedTreeWriters(db: Database, goal: GoalRow): GoalTaskRow[] {
  if (!goal.workspace_path) return [];
  const sessions = new SessionRepository(db, goal.user_id);
  return workStore(db, goal.user_id, goal.id).listTasks(goal.id).filter(task => {
    if (task.dispatch_status !== 'running' || !task.dispatched_session_id) return false;
    const session = sessions.getById(task.dispatched_session_id);
    return session?.status === 'running' && session.workingDir === goal.workspace_path;
  });
}

/** Goal-tree checkpoints would capture a shared-tree CLI's half-done edits: wait instead. */
function assertNoSharedWriter(db: Database, goal: GoalRow): void {
  const writer = sharedTreeWriters(db, goal)[0];
  if (writer) throw new AgentError('COPILOT_GOAL_INPUT_INVALID',
    `Task '${writer.id}' is still writing in the shared goal tree; wait for it to finish before forking or integrating task worktrees`);
}

function journalRecovered(db: Database, goal: GoalRow, recovered: string[]): void {
  if (!recovered.length) return;
  workStore(db, goal.user_id, goal.id).appendJournal(goal.id, null,
    `Aborted an unfinished merge left in the ${recovered.join(' and ')} worktree (probably a crash); the tree was reset to its pre-merge state.`);
}

async function forkTaskWorkspace(db: Database, goal: GoalRow, taskId: string): Promise<GoalWorkspace> {
  const location = taskWorktreeLocation(db, goal, taskId);
  if (!location) throw unavailable('Task worktrees need a git-backed goal workspace; this goal uses a copy workspace');
  assertNoSharedWriter(db, goal);
  const { goalPath, goalBranch } = goalTrees(goal);
  fs.mkdirSync(location.root, { recursive: true, mode: 0o700 });
  try {
    const created = await forkGoalTaskWorktree({
      goalPath, goalBranch, workspacesRoot: fs.realpathSync(location.root), taskId,
      message: `goal: checkpoint before task ${taskId}`, excludePaths: GOAL_MANAGED_PATHS
    });
    journalRecovered(db, goal, created.recovered);
    return asWorkspace(goal, taskId, created.path);
  } catch (error) {
    throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not create the task git worktree');
  }
}

async function restoreTaskWorkspace(db: Database, goal: GoalRow, taskId: string): Promise<GoalWorkspace> {
  const location = taskWorktreeLocation(db, goal, taskId);
  if (!location) throw unavailable('Task worktrees need a git-backed goal workspace; this goal uses a copy workspace');
  fs.mkdirSync(location.root, { recursive: true, mode: 0o700 });
  try {
    const restored = await restoreGoalTaskWorktree({ goalPath: goalTrees(goal).goalPath, workspacesRoot: fs.realpathSync(location.root), taskId });
    return asWorkspace(goal, taskId, restored.path);
  } catch (error) {
    throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not restore the task git worktree from its branch');
  }
}

/**
 * Resolve, restore (directory lost, branch kept) or lazily create the task
 * worktree. Creation is single-flight per task; pending goal-tree edits are
 * checkpoint-committed so the fork includes them (CLI hook files excluded).
 */
export async function ensureTaskWorkspace(db: Database, userId: string, goal: GoalRow, taskId: string): Promise<GoalWorkspace> {
  const fresh = assertGoalTask(db, userId, goal.id, taskId);
  const state = await taskWorkspaceState(db, fresh, taskId);
  if (state === 'present') {
    await taskWorkspaceStatus(db, fresh, taskId);
    return existingTaskWorkspace(db, fresh, taskId)!;
  }
  const key = `${userId}:${goal.id}:${taskId}`;
  const inflight = forking.get(key);
  if (inflight) return inflight;
  const pending = (state === 'lost' ? restoreTaskWorkspace(db, fresh, taskId) : forkTaskWorkspace(db, fresh, taskId)).finally(() => forking.delete(key));
  forking.set(key, pending);
  return pending;
}

function treesOf(db: Database, goal: GoalRow, taskId: string): { goalPath: string; goalBranch: string; taskPath: string; taskBranch: string } {
  const workspace = existingTaskWorkspace(db, goal, taskId);
  if (!workspace) throw unavailable('This task has no worktree');
  return { ...goalTrees(goal), taskPath: workspace.path, taskBranch: workspace.branch! };
}

/** `lost` is set when the directory is gone but the branch is kept; `integrated` is then decided by the branch tip. */
export interface TaskWorkspaceStatus { exists: boolean; dirty: boolean; integrated: boolean; lost?: true }

/** integrated = no uncommitted non-managed edits and the task HEAD is contained in the goal branch. */
export async function taskWorkspaceStatus(db: Database, goal: GoalRow, taskId: string): Promise<TaskWorkspaceStatus> {
  const state = await taskWorkspaceState(db, goal, taskId);
  if (state === 'none') return { exists: false, dirty: false, integrated: false };
  try {
    if (state === 'lost') {
      const { goalPath, goalBranch } = goalTrees(goal);
      return { exists: false, dirty: false, lost: true, integrated: await goalTaskBranchIntegrated({ goalPath, goalBranch, taskBranch: goalTaskBranchName(taskId) }) };
    }
    const result = await inspectGoalTaskWorktree({ ...treesOf(db, goal, taskId), excludePaths: GOAL_MANAGED_PATHS });
    return { exists: true, ...result };
  } catch (error) {
    throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not inspect the task worktree');
  }
}

/** Content hash of the task tree right now; recorded with a verification and compared before integrating. */
export async function taskWorkspaceIdentity(db: Database, goal: GoalRow, taskId: string): Promise<string> {
  try { return await goalTaskTreeIdentity({ ...treesOf(db, goal, taskId), excludePaths: GOAL_MANAGED_PATHS }); }
  catch (error) { throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not fingerprint the task worktree'); }
}

export interface TaskIntegration { commit: string; changes: GoalWorktreeChange[] }

export async function integrateTaskWorkspace(db: Database, userId: string, goal: GoalRow, taskId: string): Promise<TaskIntegration> {
  const fresh = assertGoalTask(db, userId, goal.id, taskId);
  assertNoSharedWriter(db, fresh);
  if (await taskWorkspaceState(db, fresh, taskId) === 'lost') await ensureTaskWorkspace(db, userId, fresh, taskId);
  try {
    const result = await integrateGoalTaskWorktree({
      ...treesOf(db, fresh, taskId), message: `goal: integrate task ${taskId}\n\nForgeBadger Copilot goal ${goal.id}`, excludePaths: GOAL_MANAGED_PATHS
    });
    journalRecovered(db, fresh, result.recovered);
    return { commit: result.commit, changes: result.changes };
  } catch (error) {
    if (error instanceof GoalTaskConflictError) {
      throw new AgentError('COPILOT_GOAL_TASK_CONFLICT',
        `Task changes conflict with the goal branch in: ${error.paths.join(', ')}. Nothing was changed. `
        + 'Options: re-dispatch the same member with instructions to merge the goal branch into its task branch, resolve these files and re-verify; '
        + 'or integrate the tasks in a different order.');
    }
    throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Git refused the task integration; the goal and task worktrees were left as they were');
  }
}

/** Task tree vs. its fork point with the goal branch (committed + uncommitted + untracked, managed hook files excluded). */
export async function listTaskWorkspaceChanges(db: Database, goal: GoalRow, taskId: string): Promise<GoalWorktreeChange[]> {
  try { return await listGoalTaskWorktreeChanges({ ...treesOf(db, goal, taskId), excludePaths: GOAL_MANAGED_PATHS }); }
  catch (error) { throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not read the task worktree changes'); }
}

/** Non-cancelled tasks whose own worktree holds work that is not in the goal branch yet (inspection failures count as unintegrated). */
export async function listUnintegratedTasks(db: Database, goal: GoalRow): Promise<Array<{ taskId: string; description: string }>> {
  if (goal.workspace_kind !== 'worktree') return [];
  const result: Array<{ taskId: string; description: string }> = [];
  for (const task of workStore(db, goal.user_id, goal.id).listTasks(goal.id)) {
    if (task.status === 'cancelled') continue;
    try {
      const status = await taskWorkspaceStatus(db, goal, task.id);
      if ((status.exists || status.lost) && !status.integrated) result.push({ taskId: task.id, description: task.description });
    } catch { result.push({ taskId: task.id, description: task.description }); }
  }
  return result;
}

// --- Cleanup after the owner's merge -----------------------------------------

async function stopSessionsIn(db: Database, sessionManager: InMemorySessionManager | undefined, userId: string, directory: string, sessionId: string | null): Promise<boolean> {
  if (!sessionId) return true;
  const sessions = new SessionRepository(db, userId);
  const session = sessions.getById(sessionId);
  if (!session || session.workingDir !== directory) return true;
  const live = sessionManager?.getSession(session.id);
  const runtimeName = live?.runtimeSessionName ?? session.runtimeSessionName ?? undefined;
  if (!live && !runtimeName) return true;
  // A CLI must not be left running in a directory that is about to disappear.
  if (!sessionManager) return false;
  try {
    await sessionManager.stopSession(session.id, runtimeName, userId);
    sessions.update(session.id, { status: 'exited', attachToken: '', runtimeSessionName: null, lastActive: new Date() });
    return true;
  } catch { return false; }
}

/**
 * Remove every task worktree (and task branch) of the goal whose work is fully
 * in the goal branch, stopping the member session that still sits in it. Never
 * throws and never removes unintegrated or uncommitted work.
 */
export async function cleanupIntegratedTaskWorkspaces(db: Database, deps: { sessionManager?: InMemorySessionManager | undefined }, userId: string, goal: GoalRow): Promise<{ removed: string[]; kept: string[] }> {
  const result = { removed: [] as string[], kept: [] as string[] };
  if (goal.workspace_kind !== 'worktree' || !goal.workspace_path || !goal.workspace_branch) return result;
  const store = workStore(db, userId, goal.id);
  // Re-read each task when it is reached: earlier awaits may have let a dispatch start.
  const current = (taskId: string) => store.listTasks(goal.id).find(entry => entry.id === taskId);
  for (const { id: taskId } of store.listTasks(goal.id)) {
    const task = current(taskId);
    if (!task) continue;
    const location = taskWorktreeLocation(db, goal, task.id);
    if (!location || !fs.existsSync(location.root)) continue;
    try {
      if (task.dispatch_status === 'running' || !(await stopSessionsIn(db, deps.sessionManager, userId, location.path, task.dispatched_session_id))
        || current(taskId)?.dispatch_status === 'running') {
        if (await taskWorkspaceState(db, goal, task.id) !== 'none') result.kept.push(task.id);
        continue;
      }
      const outcome = await removeIntegratedGoalTaskWorktree({
        goalPath: goal.workspace_path, goalBranch: goal.workspace_branch, workspacesRoot: fs.realpathSync(location.root), taskId: task.id, excludePaths: GOAL_MANAGED_PATHS
      });
      if (outcome !== 'absent') result[outcome].push(task.id);
    } catch { result.kept.push(task.id); }
  }
  return result;
}

// --- Owner acceptance on the project board ---------------------------------

const boardAcceptances = new Map<string, Promise<void>>();
const lastBoardNote = new Map<string, string>();

export function boardIntegrationInFlight(goalId: string): boolean {
  for (const key of boardAcceptances.keys()) if (key.startsWith(`${goalId}:`)) return true;
  return false;
}

async function acceptTaskFromBoard(db: Database, userId: string, goal: GoalRow, task: GoalTaskRow, item: { id: string; title: string }): Promise<boolean> {
  const store = workStore(db, userId, goal.id);
  const fresh = store.getGoal(goal.id);
  const current = store.listTasks(goal.id).find(entry => entry.id === task.id);
  if (!fresh || !current || current.status === 'passes' || current.status === 'cancelled') return false;
  // Waiting states: a CLI still writing, or this task's own turn running. The next evaluation retries.
  if (current.dispatch_status === 'running' || sharedTreeWriters(db, fresh).length) return false;
  try {
    await integrateTaskWorkspace(db, userId, fresh, task.id);
  } catch (error) {
    const reason = error instanceof AgentError ? error.message : 'integration failed';
    const note = `Owner accepted work item "${item.title}" on the board, but task '${task.id}' was not marked passes: its task worktree could not be integrated (${reason}).`;
    if (lastBoardNote.get(task.id) !== note) { lastBoardNote.set(task.id, note); store.appendJournal(goal.id, null, note); }
    return false;
  }
  lastBoardNote.delete(task.id);
  const settled = store.settleFromBoard(goal.id, task.id, 'passes', `Accepted on the project board (work item ${item.id}); task worktree integrated.`);
  if (settled) store.appendJournal(goal.id, null, `Owner accepted work item "${item.title}" on the board; its task worktree was integrated and task '${task.id}' passes.`);
  return !!settled;
}

/**
 * Board `done` for a task that owns a worktree: integrate it first (the
 * verify record does not apply; owner acceptance is stronger) and only then
 * settle `passes`. Conflicts leave the task as it is. Fire-and-forget and
 * single-flight per task; `onSettled` lets the goal driver re-evaluate.
 */
export function startBoardAcceptance(db: Database, userId: string, goal: GoalRow, task: GoalTaskRow, item: { id: string; title: string }, onSettled?: () => void): void {
  const key = `${goal.id}:${task.id}`;
  if (boardAcceptances.has(key)) return;
  const run = acceptTaskFromBoard(db, userId, goal, task, item)
    .catch(() => false)
    .then(settled => { boardAcceptances.delete(key); if (settled) onSettled?.(); });
  boardAcceptances.set(key, run);
}
