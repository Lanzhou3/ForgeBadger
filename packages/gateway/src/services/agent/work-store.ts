import type { Database } from '../../db/types.js';
import {
  CopilotGoalStore, type GoalDispatchStatus, type GoalJournalRow, type GoalRow, type GoalTaskInput, type GoalTaskRow, type GoalTaskStatus,
  type GoalWorkspaceRecord
} from './goal-store.js';
import { FleetStore } from '../fleet/fleet-store.js';

/**
 * Execution scope seam. A run's `copilot_runs.goal_id` / `TurnInput.goalId`
 * is a scope id: a goal id or a fleet id (both UUIDs; whichever table holds
 * the id decides). Member dispatch, task worktrees, verification, review and
 * integration work against this method set, so they serve goals and fleets
 * alike. Pure goal lifecycle code (continuation, ask/answer, notifications,
 * the goal routes) keeps using CopilotGoalStore directly.
 */
export interface WorkStore {
  getGoal(id: string): GoalRow | undefined;
  listTasks(scopeId: string): GoalTaskRow[];
  addTasks(scopeId: string, tasks: ReadonlyArray<string | GoalTaskInput>): GoalTaskRow[];
  updateTask(scopeId: string, taskId: string, status: GoalTaskStatus, evidence?: string): GoalTaskRow | undefined;
  settleFromBoard(scopeId: string, taskId: string, status: 'passes' | 'cancelled' | 'in_progress', note: string): GoalTaskRow | undefined;
  markTaskVerified(scopeId: string, taskId: string, exitCode: number, evidenceSummary: string): GoalTaskRow;
  setWorkspace(scopeId: string, workspace: GoalWorkspaceRecord): GoalRow;
  setWorkspaceBase(scopeId: string, baseCommit: string): void;
  /** `memberId` is recorded by fleets; goals ignore it. */
  setTaskDispatched(scopeId: string, taskId: string, sessionId: string, memberId?: string | null): GoalTaskRow;
  settleDispatch(taskId: string, status: Exclude<GoalDispatchStatus, 'running'>): GoalTaskRow | undefined;
  runningDispatchesForSession(sessionId: string): GoalTaskRow[];
  touchTask(scopeId: string, taskId: string): void;
  appendJournal(scopeId: string, runId: string | null, note: string): GoalJournalRow;
  recentJournal(scopeId: string, limit?: number): GoalJournalRow[];
  hasActiveGoalRun(scopeId: string): boolean;
  hasActiveRun(conversationId: string): boolean;
}

export type ScopeKind = 'goal' | 'fleet';

/** Which table owns the scope id for this tenant, or undefined when neither does. */
export function scopeKind(db: Database, userId: string, scopeId: string): ScopeKind | undefined {
  if (db.prepare('SELECT 1 FROM fleets WHERE user_id=? AND id=?').get(userId, scopeId)) return 'fleet';
  if (db.prepare('SELECT 1 FROM copilot_goals WHERE user_id=? AND id=?').get(userId, scopeId)) return 'goal';
  return undefined;
}

/** The store that owns the scope; unknown ids fall back to the goal store (which then reports "not found"). */
export function workStore(db: Database, userId: string, scopeId: string): WorkStore {
  return scopeKind(db, userId, scopeId) === 'fleet' ? new FleetStore(db, userId) : new CopilotGoalStore(db, userId);
}

export function isFleetStore(store: WorkStore): store is FleetStore {
  return store instanceof FleetStore;
}
