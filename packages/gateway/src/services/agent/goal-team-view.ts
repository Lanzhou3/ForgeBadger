import type { Database } from '../../db/types.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import type { GoalRow, GoalTaskRow } from './goal-store.js';
import { workStore } from './work-store.js';
import { taskWorkspaceStatus } from './goal-task-workspace.js';
import { MAX_REVIEW_ROUNDS, readReviewState, reportedRounds, type ReviewAttempt } from './goal-review.js';
import { copilotTeamRoster } from './team-roster.js';

/**
 * Owner-facing projection of a goal's team work for the goal page: who works
 * on each task, where its changes live, whether they reached the goal branch,
 * and what reviewers said. Read-only; every per-task lookup degrades to
 * "unknown" instead of failing the page.
 */

export interface GoalTeamMemberView { id: string; name: string; title: string; adapter: string; roles: string[] }
export interface GoalTaskWorkerView { adapter: string; memberId: string | null; memberName: string | null; sessionId: string }
export interface GoalTaskReviewView {
  rounds: number; roundsLeft: number;
  attempts: Array<{
    attempt: number; status: ReviewAttempt['status']; reviewer: ReviewAttempt['reviewer']; startedAt: number; settledAt: number | null; sessionId: string;
    verdict: string | null; summary: string | null; findings: NonNullable<ReviewAttempt['report']>['findings']; droppedFindings: number
  }>;
}
export interface GoalTaskTeamView {
  taskId: string;
  worker: GoalTaskWorkerView | null;
  /** `own` = a dedicated task worktree; `shared` = the goal tree. */
  workspace: 'own' | 'shared';
  /** Own worktree only: its work is in the goal branch. null = shared tree or unknown. */
  integrated: boolean | null;
  review: GoalTaskReviewView | null;
}
export interface GoalTeamView { members: GoalTeamMemberView[]; maxParallelWriters: number; tasks: GoalTaskTeamView[] }

/**
 * Fleet tasks store the member that got the task (`member_id`); prefer it.
 * Goal tasks do not: a dispatched session is named `<member name>: <task id>`,
 * so match that prefix among members on the session's CLI, and fall back to
 * the adapter alone.
 */
function workerOf(db: Database, userId: string, task: GoalTaskRow & { member_id?: string | null }): GoalTaskWorkerView | null {
  if (!task.dispatched_session_id) return null;
  const session = new SessionRepository(db, userId).getById(task.dispatched_session_id);
  if (!session) return null;
  const members = copilotTeamRoster().members;
  if (task.member_id) {
    const stored = members.find(entry => entry.id === task.member_id);
    return { adapter: session.aiTool, memberId: task.member_id, memberName: stored?.name ?? null, sessionId: session.id };
  }
  const member = members.find(entry => entry.adapter === session.aiTool && session.name.startsWith(`${entry.name}: `));
  return { adapter: session.aiTool, memberId: member?.id ?? null, memberName: member?.name ?? null, sessionId: session.id };
}

function reviewOf(db: Database, goalId: string, taskId: string): GoalTaskReviewView | null {
  let state;
  try { state = readReviewState(db, goalId, taskId); } catch { return null; }
  if (!state.attempts.length) return null;
  const rounds = reportedRounds(state);
  return {
    rounds, roundsLeft: Math.max(0, MAX_REVIEW_ROUNDS - rounds),
    attempts: state.attempts.map(attempt => ({
      attempt: attempt.attempt, status: attempt.status, reviewer: attempt.reviewer, startedAt: attempt.startedAt, settledAt: attempt.settledAt,
      sessionId: attempt.sessionId, verdict: attempt.report?.verdict ?? null, summary: attempt.report?.summary ?? null,
      findings: attempt.report?.findings ?? [], droppedFindings: attempt.report?.dropped ?? 0
    }))
  };
}

async function workspaceOf(db: Database, goal: GoalRow, taskId: string): Promise<Pick<GoalTaskTeamView, 'workspace' | 'integrated'>> {
  try {
    const status = await taskWorkspaceStatus(db, goal, taskId);
    return status.exists || status.lost ? { workspace: 'own', integrated: status.integrated } : { workspace: 'shared', integrated: null };
  } catch { return { workspace: 'own', integrated: null }; }
}

export async function goalTeamView(db: Database, userId: string, goal: GoalRow): Promise<GoalTeamView> {
  const roster = copilotTeamRoster();
  const tasks: GoalTaskTeamView[] = [];
  for (const task of workStore(db, userId, goal.id).listTasks(goal.id)) {
    tasks.push({ taskId: task.id, worker: workerOf(db, userId, task), ...await workspaceOf(db, goal, task.id), review: reviewOf(db, goal.id, task.id) });
  }
  return {
    members: roster.members.filter(member => member.enabled)
      .map(member => ({ id: member.id, name: member.name, title: member.title, adapter: member.adapter, roles: [...member.roles] })),
    maxParallelWriters: roster.maxParallelWriters, tasks
  };
}
