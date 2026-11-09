import type { Database } from '../../db/types.js';
import { ProjectRepository } from '../../db/repositories/project-repository.js';
import {
  ProjectManagerRepository, type ProjectManagerWorkItem, type ProjectManagerWorkItemStatus
} from '../../db/repositories/project-manager-repository.js';
import { governedProject } from '../project-manager/access.js';
import { readTaskDispatchAttempt } from '../project-manager/task-execution.js';
import { CopilotGoalStore, type GoalRow, type GoalTaskInput, type GoalTaskRow, type GoalTaskStatus } from './goal-store.js';
import { AgentError } from './types.js';

/**
 * Goal ↔ project board linkage. For goals on a personal project the board is
 * the shared plan: every goal task is backed by a work item (created on
 * goal_add_tasks, or an existing item adopted by id) and goal task progress is
 * mirrored onto it. The owner's board decisions flow back: a work item moved
 * to `done` passes its goal task, a `cancelled` one stops gating the goal.
 * Acceptance (`done`) is never written from here. Shared/team projects keep
 * their delivery workflow and are not linked.
 */

const GOAL_TO_BOARD: Record<Exclude<GoalTaskStatus, 'cancelled'>, ProjectManagerWorkItemStatus> = {
  pending: 'todo', in_progress: 'in_progress', passes: 'ready_for_review', failed: 'blocked'
};
const FINAL_BOARD_STATUSES: readonly ProjectManagerWorkItemStatus[] = ['done', 'cancelled'];
const MAX_TITLE = 256;

/** The goal's project id when it has a personal board to link with. */
export function goalBoardProject(db: Database, userId: string, goal: GoalRow): string | undefined {
  if (!goal.project_id || governedProject(db, goal.project_id)) return undefined;
  return new ProjectRepository(db, userId).getById(goal.project_id) ? goal.project_id : undefined;
}

function newWorkItemFor(goal: GoalRow, task: GoalTaskInput) {
  const verify = task.verifyCommand?.trim();
  return {
    title: Array.from(task.description).slice(0, MAX_TITLE).join(''),
    description: `${task.description}${verify ? `\n\nVerify: \`${verify}\` exits 0.` : ''}\n\nCopilot goal: ${goal.title}`,
    acceptanceCriteria: [verify ? `\`${verify}\` exits 0` : task.description.slice(0, 1000)],
    details: { copilotGoal: { goalId: goal.id } }
  };
}

/**
 * Resolve board links for new goal tasks inside the caller's transaction:
 * adopted items must exist, be open and not already linked to this goal;
 * new tasks get a fresh work item. Without a board, adoption is refused and
 * plain tasks pass through unlinked.
 */
export type GoalTaskDraft = Omit<GoalTaskInput, 'description'> & { description?: string | undefined };

export function linkGoalTasksToBoard(db: Database, userId: string, goal: GoalRow, drafts: GoalTaskDraft[]): GoalTaskInput[] {
  const projectId = goalBoardProject(db, userId, goal);
  if (!projectId) {
    if (drafts.some(draft => draft.workItemId))
      throw new AgentError('COPILOT_GOAL_BOARD_UNAVAILABLE', 'This goal has no personal project board; workItemId cannot be linked');
    return drafts.map(draft => {
      if (!draft.description) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', 'Each task needs a description');
      return { ...draft, description: draft.description };
    });
  }
  const repo = new ProjectManagerRepository(db, userId);
  // One live goal per work item: two goals mirroring the same item would fight.
  const linked = new Set((db.prepare(`SELECT t.work_item_id FROM copilot_goal_tasks t JOIN copilot_goals g ON g.id=t.goal_id AND g.user_id=t.user_id
      WHERE t.user_id=? AND t.work_item_id IS NOT NULL AND (g.id=? OR g.status NOT IN ('completed','cancelled'))`)
    .all(userId, goal.id) as { work_item_id: string }[]).map(row => row.work_item_id));
  return drafts.map(draft => {
    if (!draft.workItemId) {
      if (!draft.description) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', 'A new task needs a description');
      const input = { ...draft, description: draft.description };
      return { ...input, workItemId: repo.createWorkItem(projectId, newWorkItemFor(goal, input)).id };
    }
    const item = repo.getWorkItem(projectId, draft.workItemId);
    if (!item) throw new AgentError('COPILOT_NOT_FOUND', `Work item ${draft.workItemId} is not on this goal's project board`);
    if (FINAL_BOARD_STATUSES.includes(item.status))
      throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Work item "${item.title}" is already ${item.status}`);
    if (linked.has(item.id)) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Work item "${item.title}" is already linked to this or another open goal`);
    linked.add(item.id);
    return { ...draft, description: draft.description ?? Array.from(item.title).slice(0, 500).join(''), workItemId: item.id };
  });
}

/** Shortest legal board path to `target` (the transition table only allows single steps). */
function boardPath(from: ProjectManagerWorkItemStatus, target: ProjectManagerWorkItemStatus): ProjectManagerWorkItemStatus[] {
  const direct: Record<ProjectManagerWorkItemStatus, ProjectManagerWorkItemStatus[]> = {
    todo: ['in_progress', 'blocked'], in_progress: ['blocked', 'ready_for_review'], blocked: ['todo', 'in_progress'],
    ready_for_review: ['in_progress'], done: [], cancelled: []
  };
  const queue: ProjectManagerWorkItemStatus[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const route = queue.shift()!;
    const last = route[route.length - 1]!;
    if (last === target) return route.slice(1);
    for (const next of direct[last]) if (!seen.has(next)) { seen.add(next); queue.push([...route, next]); }
  }
  return [];
}

/**
 * A board dispatch owns the item while it is in flight or uncertain; a
 * reconciled one (turn report consumed) or a not-sent one releases it. An
 * attempt that no longer parses is treated as live (conservative).
 */
function liveBoardDispatch(item: ProjectManagerWorkItem): boolean {
  const packet = item.details.taskPacket;
  const raw = packet && typeof packet === 'object' ? (packet as { attempt?: unknown }).attempt : undefined;
  if (raw === undefined) return false;
  const attempt = readTaskDispatchAttempt(item);
  if (!attempt) return true;
  if (attempt.status === 'not_sent') return false;
  return attempt.status !== 'dispatched' || !attempt.consumedNotificationId;
}

/**
 * Mirror one goal task's status onto its work item. Best effort: board
 * conflicts (final items, a live board dispatch owning the item, concurrent
 * edits) are journaled and never fail the goal tool.
 */
export function mirrorGoalTaskToBoard(db: Database, userId: string, goal: GoalRow, task: GoalTaskRow): void {
  if (!task.work_item_id || task.status === 'cancelled') return;
  const projectId = goalBoardProject(db, userId, goal);
  if (!projectId) return;
  const store = new CopilotGoalStore(db, userId);
  try {
    const repo = new ProjectManagerRepository(db, userId);
    const item = repo.getWorkItem(projectId, task.work_item_id);
    if (!item || FINAL_BOARD_STATUSES.includes(item.status) || liveBoardDispatch(item)) return;
    const target = GOAL_TO_BOARD[task.status];
    if (item.status === target) return;
    const steps = boardPath(item.status, target);
    db.transaction(() => {
      steps.forEach((status, index) => {
        const last = index === steps.length - 1;
        repo.updateWorkItemStatus(projectId, item.id, {
          status,
          ...(last && task.status === 'passes'
            ? { evidenceRefs: [{ kind: 'copilot_goal', label: 'Copilot goal task passed', ref: `copilot-goal:${goal.id}/task:${task.id}` }] }
            : {}),
          details: { copilotGoal: { goalId: goal.id, taskId: task.id, taskStatus: task.status } }
        });
      });
    })();
  } catch (error) {
    store.appendJournal(goal.id, null, `Board sync skipped for task '${task.id}': ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}.`);
  }
}

const REOPENED_BOARD_STATUSES: readonly ProjectManagerWorkItemStatus[] = ['todo', 'in_progress', 'blocked'];

/**
 * Pull the owner's board decisions into the goal: `done` passes the linked
 * task (owner acceptance), `cancelled` cancels it, and a passes task whose
 * item the board moved back after it passed (changes requested) reopens as
 * in_progress — a completed goal is paused so the owner decides on resuming.
 * Idempotent; returns how many tasks changed.
 */
export function syncGoalFromBoard(db: Database, userId: string, goal: GoalRow): number {
  const projectId = goalBoardProject(db, userId, goal);
  if (!projectId) return 0;
  const store = new CopilotGoalStore(db, userId);
  const repo = new ProjectManagerRepository(db, userId);
  let changed = 0;
  let reopened = false;
  for (const task of store.listTasks(goal.id)) {
    if (!task.work_item_id || task.status === 'cancelled') continue;
    const item = repo.getWorkItem(projectId, task.work_item_id);
    if (item?.status === 'done' && task.status !== 'passes') {
      if (store.settleFromBoard(goal.id, task.id, 'passes', `Accepted on the project board (work item ${item.id}).`)) {
        store.appendJournal(goal.id, null, `Owner accepted work item "${item.title}" on the board; task '${task.id}' passes.`);
        changed += 1;
      }
    } else if (item && task.status === 'passes' && REOPENED_BOARD_STATUSES.includes(item.status) && item.updatedAt > task.updated_at) {
      if (store.settleFromBoard(goal.id, task.id, 'in_progress', `Board moved work item ${item.id} back to ${item.status} after it passed.`)) {
        store.appendJournal(goal.id, null, `Work item "${item.title}" went back to ${item.status} on the board; task '${task.id}' reopened.`);
        changed += 1;
        reopened = true;
      }
    } else if (item?.status === 'cancelled') {
      if (store.settleFromBoard(goal.id, task.id, 'cancelled', `Cancelled on the project board (work item ${item.id}).`)) {
        store.appendJournal(goal.id, null, `Work item "${item.title}" was cancelled on the board; task '${task.id}' no longer gates the goal.`);
        changed += 1;
      }
    }
  }
  if (reopened && store.getGoal(goal.id)?.status === 'completed') {
    store.setStatus(goal.id, 'paused');
    store.appendJournal(goal.id, null, 'Goal reopened as paused: the board sent completed work back. Resume to continue.');
  }
  return changed;
}

/** Board view of a linked task for the model context and the goal DTO. */
export function boardStatusOf(db: Database, userId: string, goal: GoalRow, task: GoalTaskRow): ProjectManagerWorkItemStatus | null {
  const projectId = goalBoardProject(db, userId, goal);
  if (!projectId || !task.work_item_id) return null;
  return new ProjectManagerRepository(db, userId).getWorkItem(projectId, task.work_item_id)?.status ?? null;
}

/** The linked work item of a goal task, when the goal has a board. */
export function linkedWorkItem(db: Database, userId: string, goal: GoalRow, task: GoalTaskRow): { repo: ProjectManagerRepository; item: ProjectManagerWorkItem } | undefined {
  const projectId = goalBoardProject(db, userId, goal);
  if (!projectId || !task.work_item_id) return undefined;
  const repo = new ProjectManagerRepository(db, userId);
  const item = repo.getWorkItem(projectId, task.work_item_id);
  return item ? { repo, item } : undefined;
}
