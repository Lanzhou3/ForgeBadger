import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/types.js';
import { CopilotConversationLog } from '../agent/conversation-log.js';
import { GOAL_GRANTS, parseGoalGrants, type GoalGrant } from '../agent/goal-grants.js';
import {
  GOAL_TASK_STATUSES, normalizeTaskInputs, type GoalDispatchStatus, type GoalJournalRow, type GoalRow, type GoalTaskInput, type GoalTaskRow,
  type GoalTaskStatus, type GoalWorkspaceKind, type GoalWorkspaceRecord
} from '../agent/goal-store.js';
import { assertGoalProjectWritable } from '../agent/goal-workspace.js';
import { AgentError } from '../agent/types.js';
import type { WorkStore } from '../agent/work-store.js';

/**
 * Fleet persistence: one standing agent team per (user, project) with its own
 * task board and handover journal. The execution methods implement WorkStore
 * and return rows structurally compatible with GoalRow / GoalTaskRow, so the
 * goal execution machinery (dispatch, task worktrees, verification, review,
 * integration) works on a fleet unchanged. All statements are parameterized
 * and tenant scoped by user_id.
 */

export const FLEET_STATUSES = ['active', 'paused'] as const;
export type FleetStatus = (typeof FLEET_STATUSES)[number];
export type FleetTaskCreator = 'owner' | 'lead';

export interface FleetRow {
  id: string; user_id: string; project_id: string; conversation_id: string;
  title: string; instructions: string; status: FleetStatus; paused_reason: string | null; idle_lead_runs: number;
  grants_json: string;
  workspace_kind: GoalWorkspaceKind | null; workspace_path: string | null; workspace_branch: string | null;
  workspace_base_commit: string | null; workspace_target_branch: string | null;
  created_at: number; updated_at: number;
}
export interface FleetListRow extends FleetRow {
  project_name: string; task_total: number; task_done: number; task_held: number; task_running: number;
}
/** A fleet board task; `goal_id` repeats `fleet_id` so goal execution code can read it. */
export interface FleetTaskRow extends GoalTaskRow {
  fleet_id: string; details: string | null; member_id: string | null; file_scope_json: string | null;
  hold_question: string | null; hold_asked_at: number | null; created_by: FleetTaskCreator;
}
export interface FleetJournalRow extends GoalJournalRow { fleet_id: string; task_id: string | null }
export interface FleetTaskDraft {
  description: string; details?: string | undefined; verifyCommand?: string | undefined;
  fileScope?: readonly string[] | undefined; workItemId?: string | undefined; createdBy: FleetTaskCreator;
}

const MAX_TITLE = 200;
const MAX_INSTRUCTIONS = 8000;
const MAX_TASK_DESCRIPTION = 500;
const MAX_TASK_DETAILS = 8000;
const MAX_VERIFY_COMMAND = 1024;
const MAX_WORK_ITEM_ID = 128;
const MAX_HOLD_QUESTION = 4000;
const MAX_FILE_SCOPE_ENTRIES = 20;
const MAX_FILE_SCOPE_CHARS = 200;
const MAX_PAUSED_REASON = 200;
const FINAL_BOARD_STATUSES = ['done', 'cancelled'];

function invalid(message: string): AgentError {
  return new AgentError('FLEET_INPUT_INVALID', message);
}

function boundedText(value: string, max: number, label: string, allowEmpty = false): string {
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || Array.from(trimmed).length > max) throw invalid(`${label} must be ${allowEmpty ? 0 : 1}-${max} characters`);
  return trimmed;
}

/**
 * Repository-relative path prefixes a task may touch (spec §3.3): at most 20,
 * each 1-200 characters, no absolute paths, no `..`, no control characters.
 * Backslashes are read as separators, `./` and trailing `/` are dropped, and
 * duplicates collapse. Returns undefined for an empty list.
 */
export function normalizeFileScope(entries: readonly string[] | undefined): string[] | undefined {
  if (entries === undefined) return undefined;
  if (!Array.isArray(entries) || entries.length > MAX_FILE_SCOPE_ENTRIES)
    throw invalid(`fileScope takes at most ${MAX_FILE_SCOPE_ENTRIES} paths`);
  const result: string[] = [];
  for (const raw of entries) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_FILE_SCOPE_CHARS)
      throw invalid(`fileScope paths must be 1-${MAX_FILE_SCOPE_CHARS} characters`);
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(raw)) throw invalid('fileScope paths must not contain control characters');
    const slashed = raw.trim().replace(/\\/g, '/');
    if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed) || slashed.startsWith('~'))
      throw invalid(`fileScope path '${raw}' must be relative to the repository`);
    const segments = slashed.split('/').filter(segment => segment !== '' && segment !== '.');
    if (segments.some(segment => segment === '..')) throw invalid(`fileScope path '${raw}' must not contain '..'`);
    if (!segments.length) throw invalid(`fileScope path '${raw}' is empty`);
    const normalized = segments.join('/');
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result.length ? result : undefined;
}

export function parseFileScope(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch { return []; }
}

function isGitRoot(projectRoot: string): boolean {
  try { fs.lstatSync(path.join(projectRoot, '.git')); return true; } catch { return false; }
}

function toGoalRow(fleet: FleetRow): GoalRow {
  return {
    id: fleet.id, user_id: fleet.user_id, conversation_id: fleet.conversation_id, project_id: fleet.project_id,
    title: fleet.title, spec: fleet.instructions, status: fleet.status,
    blocked_reason: null, pending_question: null, grants_json: fleet.grants_json,
    workspace_kind: fleet.workspace_kind, workspace_path: fleet.workspace_path, workspace_branch: fleet.workspace_branch,
    workspace_base_commit: fleet.workspace_base_commit, workspace_target_branch: fleet.workspace_target_branch,
    created_at: fleet.created_at, updated_at: fleet.updated_at, completed_at: null
  };
}

const TASK_COLUMNS = 't.*, t.fleet_id AS goal_id';
const JOURNAL_COLUMNS = 'j.*, j.fleet_id AS goal_id';

export class FleetStore implements WorkStore {
  constructor(private db: Database, private userId: string) {}

  // --- Fleet-native operations ---------------------------------------------

  /**
   * One fleet per personal git project. Creates the lead's dedicated Copilot
   * conversation (bound to the project) in the same transaction.
   */
  createFleet(input: { projectId: string; title?: string | undefined; instructions?: string | undefined; grants?: readonly string[] | undefined }): FleetRow {
    const project = this.db.prepare('SELECT id,name,path FROM projects WHERE user_id=? AND id=?').get(this.userId, input.projectId) as
      { id: string; name: string; path: string } | undefined;
    if (!project) throw new AgentError('COPILOT_PROJECT_NOT_FOUND', 'Project not found');
    assertGoalProjectWritable(this.db, this.userId, project.id, project.path);
    if (!isGitRoot(project.path)) throw new AgentError('FLEET_GIT_REQUIRED', 'A fleet needs a git project: members work in git worktrees of it');
    const title = boundedText(input.title ?? project.name, MAX_TITLE, 'title');
    const instructions = boundedText(input.instructions ?? '', MAX_INSTRUCTIONS, 'instructions', true);
    const grants = this.validGrants(input.grants ?? []);
    return this.db.transaction(() => {
      if (this.getFleetByProject(project.id)) throw new AgentError('FLEET_EXISTS', 'This project already has a fleet');
      const conversation = new CopilotConversationLog(this.db, this.userId).createConversation(`Fleet: ${title}`.slice(0, MAX_TITLE), project.id);
      const id = randomUUID();
      const now = Date.now();
      this.db.prepare(`INSERT INTO fleets(id,user_id,project_id,conversation_id,title,instructions,status,grants_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'active',?,?,?)`).run(id, this.userId, project.id, conversation.id, title, instructions, JSON.stringify(grants), now, now);
      return this.getFleet(id)!;
    }).immediate();
  }

  getFleet(id: string): FleetRow | undefined {
    return this.db.prepare('SELECT * FROM fleets WHERE user_id=? AND id=?').get(this.userId, id) as FleetRow | undefined;
  }

  getFleetByProject(projectId: string): FleetRow | undefined {
    return this.db.prepare('SELECT * FROM fleets WHERE user_id=? AND project_id=?').get(this.userId, projectId) as FleetRow | undefined;
  }

  /** Fleets with board counts: done = passes; held = an open owner question; running = a CLI turn in flight. */
  listFleets(): FleetListRow[] {
    return this.db.prepare(`SELECT f.*, p.name AS project_name,
        (SELECT count(*) FROM fleet_tasks t WHERE t.user_id=f.user_id AND t.fleet_id=f.id) AS task_total,
        (SELECT count(*) FROM fleet_tasks t WHERE t.user_id=f.user_id AND t.fleet_id=f.id AND t.status='passes') AS task_done,
        (SELECT count(*) FROM fleet_tasks t WHERE t.user_id=f.user_id AND t.fleet_id=f.id AND t.hold_question IS NOT NULL AND t.status NOT IN ('passes','cancelled')) AS task_held,
        (SELECT count(*) FROM fleet_tasks t WHERE t.user_id=f.user_id AND t.fleet_id=f.id AND t.dispatch_status='running') AS task_running
      FROM fleets f JOIN projects p ON p.user_id=f.user_id AND p.id=f.project_id
      WHERE f.user_id=? ORDER BY f.updated_at DESC, f.id`).all(this.userId) as FleetListRow[];
  }

  updateFleet(id: string, patch: { title?: string | undefined; instructions?: string | undefined; grants?: readonly string[] | undefined }): FleetRow {
    const fleet = this.requireFleet(id);
    const title = patch.title === undefined ? fleet.title : boundedText(patch.title, MAX_TITLE, 'title');
    const instructions = patch.instructions === undefined ? fleet.instructions : boundedText(patch.instructions, MAX_INSTRUCTIONS, 'instructions', true);
    const grants = patch.grants === undefined ? fleet.grants_json : JSON.stringify(this.validGrants(patch.grants));
    this.db.prepare('UPDATE fleets SET title=?, instructions=?, grants_json=?, updated_at=? WHERE user_id=? AND id=?')
      .run(title, instructions, grants, Date.now(), this.userId, id);
    return this.getFleet(id)!;
  }

  /** `paused_reason` is kept only while paused. */
  setStatus(id: string, status: FleetStatus, pausedReason?: string): FleetRow {
    if (!FLEET_STATUSES.includes(status)) throw invalid(`Unknown fleet status: ${status}`);
    this.requireFleet(id);
    const reason = status === 'paused' && pausedReason ? boundedText(pausedReason, MAX_PAUSED_REASON, 'pausedReason') : null;
    this.db.prepare('UPDATE fleets SET status=?, paused_reason=?, updated_at=? WHERE user_id=? AND id=?')
      .run(status, reason, Date.now(), this.userId, id);
    return this.getFleet(id)!;
  }

  /** Rebind the lead to a fresh conversation (self-heal when the old one is gone). */
  setConversation(id: string, conversationId: string): FleetRow {
    this.requireFleet(id);
    this.db.prepare('UPDATE fleets SET conversation_id=?, updated_at=? WHERE user_id=? AND id=?').run(conversationId, Date.now(), this.userId, id);
    return this.getFleet(id)!;
  }

  /** One board task from the owner or the lead; the next sequence number is assigned atomically. */
  addTask(fleetId: string, draft: FleetTaskDraft): FleetTaskRow {
    return this.db.transaction(() => this.insertTask(fleetId, draft)).immediate();
  }

  getTask(fleetId: string, taskId: string): FleetTaskRow | undefined {
    return this.db.prepare(`SELECT ${TASK_COLUMNS} FROM fleet_tasks t WHERE t.user_id=? AND t.fleet_id=? AND t.id=?`)
      .get(this.userId, fleetId, taskId) as FleetTaskRow | undefined;
  }

  /** The lead asks the owner about one task; other tasks keep moving. */
  setHold(fleetId: string, taskId: string, question: string): FleetTaskRow {
    const task = this.requireTask(fleetId, taskId);
    if (task.status === 'cancelled') throw this.cancelledError(task);
    const text = boundedText(question, MAX_HOLD_QUESTION, 'question');
    const now = Date.now();
    this.db.prepare('UPDATE fleet_tasks SET hold_question=?, hold_asked_at=?, updated_at=? WHERE user_id=? AND fleet_id=? AND id=?')
      .run(text, now, now, this.userId, fleetId, taskId);
    return this.getTask(fleetId, taskId)!;
  }

  clearHold(fleetId: string, taskId: string): FleetTaskRow {
    this.requireTask(fleetId, taskId);
    this.db.prepare('UPDATE fleet_tasks SET hold_question=NULL, hold_asked_at=NULL, updated_at=? WHERE user_id=? AND fleet_id=? AND id=?')
      .run(Date.now(), this.userId, fleetId, taskId);
    return this.getTask(fleetId, taskId)!;
  }

  /** Owner cancellation: final, idempotent, clears an open hold. A running CLI session is not stopped here. */
  cancelTask(fleetId: string, taskId: string): FleetTaskRow {
    const task = this.requireTask(fleetId, taskId);
    if (task.status === 'cancelled') return task;
    this.db.prepare(`UPDATE fleet_tasks SET status='cancelled', hold_question=NULL, hold_asked_at=NULL, updated_at=?
      WHERE user_id=? AND fleet_id=? AND id=?`).run(Date.now(), this.userId, fleetId, taskId);
    return this.getTask(fleetId, taskId)!;
  }

  // --- WorkStore -------------------------------------------------------------

  /** The fleet projected onto a goal row (spec = instructions; no blocked/pending/completed state). */
  getGoal(id: string): GoalRow | undefined {
    const fleet = this.getFleet(id);
    return fleet ? toGoalRow(fleet) : undefined;
  }

  listTasks(fleetId: string): FleetTaskRow[] {
    return this.db.prepare(`SELECT ${TASK_COLUMNS} FROM fleet_tasks t WHERE t.user_id=? AND t.fleet_id=? ORDER BY t.seq`)
      .all(this.userId, fleetId) as FleetTaskRow[];
  }

  /** Lead-created tasks (goal_add_tasks in a fleet run). */
  addTasks(fleetId: string, tasks: ReadonlyArray<string | GoalTaskInput>): FleetTaskRow[] {
    const inputs = normalizeTaskInputs(tasks);
    return this.db.transaction(() => inputs.map(task => this.insertTask(fleetId, {
      description: task.description, verifyCommand: task.verifyCommand, workItemId: task.workItemId,
      details: task.details, fileScope: task.fileScope, createdBy: 'lead'
    }))).immediate();
  }

  updateTask(fleetId: string, taskId: string, status: GoalTaskStatus, evidence?: string): FleetTaskRow | undefined {
    if (!GOAL_TASK_STATUSES.includes(status)) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', `Unknown task status: ${status}`);
    const existing = this.getTask(fleetId, taskId);
    if (!existing) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
    // `cancelled` is owner-final: only cancelTask sets it, nothing changes it afterwards.
    if (status === 'cancelled' || existing.status === 'cancelled') throw this.cancelledError(existing);
    // An open owner question freezes the task: only the owner's answer (clearHold) releases it.
    if (existing.hold_question)
      throw new AgentError('FLEET_TASK_HELD', `Task #${existing.seq} is on hold waiting for the owner's answer; it cannot change status until the owner answers (a hold_answered event wakes you)`);
    if (status === 'passes') {
      if (existing.verify_command) {
        if (existing.verified_at === null || existing.verify_exit_code !== 0)
          throw new AgentError('COPILOT_GOAL_VERIFY_REQUIRED', `Task '${existing.description}' requires its verify_command to exit 0 (goal_run_checks with taskId) before it can pass`);
      } else if (!evidence?.trim() && !existing.evidence?.trim()) {
        throw new AgentError('COPILOT_GOAL_EVIDENCE_REQUIRED', 'A passes task must carry evidence');
      }
    }
    const mergedEvidence = evidence?.trim() && existing.evidence?.trim() && existing.evidence !== evidence
      ? `${existing.evidence}\n${evidence}` : (evidence ?? null);
    this.db.prepare('UPDATE fleet_tasks SET status=?, evidence=COALESCE(?,evidence), updated_at=? WHERE user_id=? AND fleet_id=? AND id=?')
      .run(status, mergedEvidence, Date.now(), this.userId, fleetId, taskId);
    return this.getTask(fleetId, taskId);
  }

  /** Owner decision taken on the linked project board work item (same semantics as goals). */
  settleFromBoard(fleetId: string, taskId: string, status: 'passes' | 'cancelled' | 'in_progress', note: string): FleetTaskRow | undefined {
    const existing = this.getTask(fleetId, taskId);
    if (!existing || existing.status === status) return undefined;
    const evidence = existing.evidence?.trim() ? `${existing.evidence}\n${note}` : note;
    this.db.prepare('UPDATE fleet_tasks SET status=?, evidence=?, updated_at=? WHERE user_id=? AND fleet_id=? AND id=?')
      .run(status, evidence, Date.now(), this.userId, fleetId, taskId);
    return this.getTask(fleetId, taskId);
  }

  markTaskVerified(fleetId: string, taskId: string, exitCode: number, evidenceSummary: string): FleetTaskRow {
    const existing = this.getTask(fleetId, taskId);
    if (!existing) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
    const evidence = existing.evidence?.trim() ? `${existing.evidence}\n${evidenceSummary}` : evidenceSummary;
    const now = Date.now();
    this.db.prepare('UPDATE fleet_tasks SET verified_at=?, verify_exit_code=?, evidence=?, updated_at=? WHERE user_id=? AND fleet_id=? AND id=?')
      .run(now, exitCode, evidence, now, this.userId, fleetId, taskId);
    return this.getTask(fleetId, taskId)!;
  }

  /** Recorded once; an existing record is never replaced. */
  setWorkspace(fleetId: string, workspace: GoalWorkspaceRecord): GoalRow {
    this.db.prepare(`UPDATE fleets SET workspace_kind=?, workspace_path=?, workspace_branch=?, workspace_base_commit=?,
        workspace_target_branch=?, updated_at=? WHERE user_id=? AND id=? AND workspace_kind IS NULL`)
      .run(workspace.kind, workspace.path, workspace.branch ?? null, workspace.baseCommit ?? null, workspace.targetBranch ?? null,
        Date.now(), this.userId, fleetId);
    const fleet = this.getGoal(fleetId);
    if (!fleet) throw new AgentError('COPILOT_NOT_FOUND', 'Fleet not found');
    return fleet;
  }

  setWorkspaceBase(fleetId: string, baseCommit: string): void {
    this.db.prepare("UPDATE fleets SET workspace_base_commit=?, updated_at=? WHERE user_id=? AND id=? AND workspace_kind='worktree'")
      .run(baseCommit, Date.now(), this.userId, fleetId);
  }

  /** Same contract as goals (turn starts `running`, verify record cleared), plus the member that got the task. */
  setTaskDispatched(fleetId: string, taskId: string, sessionId: string, memberId: string | null = null): FleetTaskRow {
    const now = Date.now();
    const changed = this.db.prepare(`UPDATE fleet_tasks SET dispatched_session_id=?, dispatch_status='running', dispatch_updated_at=?, updated_at=?,
        verified_at=NULL, verify_exit_code=NULL, member_id=? WHERE user_id=? AND fleet_id=? AND id=?`)
      .run(sessionId, now, now, memberId, this.userId, fleetId, taskId).changes;
    if (!changed) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
    return this.getTask(fleetId, taskId)!;
  }

  settleDispatch(taskId: string, status: Exclude<GoalDispatchStatus, 'running'>): FleetTaskRow | undefined {
    const now = Date.now();
    const changed = this.db.prepare(`UPDATE fleet_tasks SET dispatch_status=?, dispatch_updated_at=?, updated_at=?
        WHERE user_id=? AND id=? AND dispatch_status='running'`).run(status, now, now, this.userId, taskId).changes;
    if (!changed) return undefined;
    return this.db.prepare(`SELECT ${TASK_COLUMNS} FROM fleet_tasks t WHERE t.user_id=? AND t.id=?`).get(this.userId, taskId) as FleetTaskRow;
  }

  runningDispatchesForSession(sessionId: string): FleetTaskRow[] {
    return this.db.prepare(`SELECT ${TASK_COLUMNS} FROM fleet_tasks t WHERE t.user_id=? AND t.dispatched_session_id=? AND t.dispatch_status='running'`)
      .all(this.userId, sessionId) as FleetTaskRow[];
  }

  touchTask(fleetId: string, taskId: string): void {
    this.db.prepare('UPDATE fleet_tasks SET updated_at=? WHERE user_id=? AND fleet_id=? AND id=?').run(Date.now(), this.userId, fleetId, taskId);
  }

  appendJournal(fleetId: string, runId: string | null, note: string, taskId: string | null = null): FleetJournalRow {
    this.requireFleet(fleetId);
    if (taskId !== null && !this.getTask(fleetId, taskId)) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
    const id = randomUUID();
    this.db.prepare('INSERT INTO fleet_journal(id,user_id,fleet_id,run_id,task_id,note,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, this.userId, fleetId, runId, taskId, note, Date.now());
    return this.db.prepare(`SELECT ${JOURNAL_COLUMNS} FROM fleet_journal j WHERE j.user_id=? AND j.id=?`).get(this.userId, id) as FleetJournalRow;
  }

  /** Newest first; with taskId only that task's entries. */
  recentJournal(fleetId: string, limit = 5, taskId?: string): FleetJournalRow[] {
    const bounded = Math.max(1, Math.min(100, limit));
    return (taskId === undefined
      ? this.db.prepare(`SELECT ${JOURNAL_COLUMNS} FROM fleet_journal j WHERE j.user_id=? AND j.fleet_id=? ORDER BY j.created_at DESC, j.rowid DESC LIMIT ?`)
        .all(this.userId, fleetId, bounded)
      : this.db.prepare(`SELECT ${JOURNAL_COLUMNS} FROM fleet_journal j WHERE j.user_id=? AND j.fleet_id=? AND j.task_id=? ORDER BY j.created_at DESC, j.rowid DESC LIMIT ?`)
        .all(this.userId, fleetId, taskId, bounded)) as FleetJournalRow[];
  }

  /** Any active run carrying the fleet scope (the lead or a delegate child). */
  hasActiveGoalRun(fleetId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM copilot_runs WHERE user_id=? AND goal_id=? AND status IN ('pending','running','awaiting_approval') LIMIT 1`)
      .get(this.userId, fleetId);
  }

  hasActiveRun(conversationId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM copilot_runs WHERE user_id=? AND conversation_id=? AND status IN ('pending','running','awaiting_approval') LIMIT 1`)
      .get(this.userId, conversationId);
  }

  // --- internals -------------------------------------------------------------

  private requireFleet(id: string): FleetRow {
    const fleet = this.getFleet(id);
    if (!fleet) throw new AgentError('COPILOT_NOT_FOUND', 'Fleet not found');
    return fleet;
  }

  private requireTask(fleetId: string, taskId: string): FleetTaskRow {
    const task = this.getTask(fleetId, taskId);
    if (!task) throw new AgentError('COPILOT_NOT_FOUND', 'Task not found');
    return task;
  }

  private cancelledError(task: FleetTaskRow): AgentError {
    return new AgentError('COPILOT_GOAL_TASK_CANCELLED', `Task '${task.description}' was cancelled by the owner; it can no longer be changed`);
  }

  private validGrants(grants: readonly string[]): GoalGrant[] {
    if (!Array.isArray(grants) || grants.some(grant => !(GOAL_GRANTS as readonly string[]).includes(grant)))
      throw invalid(`grants must be a subset of: ${GOAL_GRANTS.join(', ')}`);
    return parseGoalGrants(JSON.stringify([...new Set(grants)]));
  }

  /** Caller holds the transaction. */
  private insertTask(fleetId: string, draft: FleetTaskDraft): FleetTaskRow {
    const fleet = this.requireFleet(fleetId);
    if (draft.createdBy !== 'owner' && draft.createdBy !== 'lead') throw invalid('createdBy must be owner or lead');
    const description = boundedText(draft.description, MAX_TASK_DESCRIPTION, 'Task description');
    const details = draft.details === undefined ? null : boundedText(draft.details, MAX_TASK_DETAILS, 'details', true) || null;
    const verifyCommand = draft.verifyCommand === undefined ? null : boundedText(draft.verifyCommand, MAX_VERIFY_COMMAND, 'verifyCommand');
    const fileScope = normalizeFileScope(draft.fileScope);
    const workItemId = draft.workItemId === undefined ? null : this.adoptableWorkItem(fleet, draft.workItemId);
    const seq = (this.db.prepare('SELECT COALESCE(MAX(seq),0) AS max_seq FROM fleet_tasks WHERE user_id=? AND fleet_id=?')
      .get(this.userId, fleetId) as { max_seq: number }).max_seq + 1;
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`INSERT INTO fleet_tasks(id,user_id,fleet_id,seq,description,details,status,verify_command,file_scope_json,work_item_id,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?,?)`)
      .run(id, this.userId, fleetId, seq, description, details, verifyCommand, fileScope ? JSON.stringify(fileScope) : null, workItemId, draft.createdBy, now, now);
    this.db.prepare('UPDATE fleets SET updated_at=? WHERE user_id=? AND id=?').run(now, this.userId, fleetId);
    return this.getTask(fleetId, id)!;
  }

  /** An optional link to an open work item on the fleet's own project board, at most once per fleet. */
  private adoptableWorkItem(fleet: FleetRow, workItemId: string): string {
    const id = boundedText(workItemId, MAX_WORK_ITEM_ID, 'workItemId');
    const item = this.db.prepare('SELECT id,title,status FROM project_manager_work_items WHERE user_id=? AND project_id=? AND id=?')
      .get(this.userId, fleet.project_id, id) as { id: string; title: string; status: string } | undefined;
    if (!item) throw new AgentError('COPILOT_NOT_FOUND', `Work item ${id} is not on this fleet's project board`);
    if (FINAL_BOARD_STATUSES.includes(item.status)) throw invalid(`Work item "${item.title}" is already ${item.status}`);
    if (this.db.prepare('SELECT 1 FROM fleet_tasks WHERE user_id=? AND fleet_id=? AND work_item_id=?').get(this.userId, fleet.id, id))
      throw invalid(`Work item "${item.title}" is already linked to a task of this fleet`);
    // Symmetric to goal adoption: a live goal task already mirrors this item.
    if (this.db.prepare(`SELECT 1 FROM copilot_goal_tasks t JOIN copilot_goals g ON g.id=t.goal_id AND g.user_id=t.user_id
        WHERE t.user_id=? AND t.work_item_id=? AND t.status NOT IN ('passes','cancelled') AND g.status NOT IN ('completed','cancelled') LIMIT 1`).get(this.userId, id))
      throw invalid(`Work item "${item.title}" is already linked to an open goal`);
    return id;
  }
}
