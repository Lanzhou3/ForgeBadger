import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Database } from '../../db/types.js';
import { SessionRepository } from '../../db/repositories/session-repository.js';
import type { ForgeBadgerEvent } from '../event-bus.js';
import type { InMemorySessionManager } from '../session-manager.js';
import { cliText } from '../notifications/cli-observation.js';
import { PROGRAMMATIC_SUBMIT_ADAPTERS } from '../programmatic-terminal-submit.js';
import { createGoalReviewCheckout, readGoalReviewDiff, removeGoalReviewCheckout, type GoalReviewCheckout } from '../collaboration/git-workspaces.js';
import type { GoalRow, GoalTaskRow } from './goal-store.js';
import { workStore } from './work-store.js';
import { GOAL_MANAGED_PATHS, goalGitError, goalWorktreeBase } from './goal-workspace.js';
import { ensureTaskWorkspace, sharedTreeWriters, taskWorkspaceState } from './goal-task-workspace.js';
import { enabledReviewerMembers, type TeamMember } from './team-roster.js';
import { AgentError } from './types.js';

/**
 * Cross-CLI review of one goal task (M2). A reviewer member - a different CLI
 * than the one that wrote the task - gets a one-off detached checkout of the
 * task's result plus the task description and the diff, and nothing of the
 * writer's conversation. It answers by writing REVIEW_REPORT_FILE in that
 * checkout; the turn-end hook (or the session ending) collects it, and the
 * checkout is deleted.
 *
 * A review is evidence for the lead only. Nothing here touches the task
 * status, its verify record or its evidence column, and nothing merges.
 *
 * State lives in `<goal-worktrees>/reviews-<goalId>/<taskId>.json` (no schema:
 * the migration chain is not ours to extend right now). The round cap is
 * enforced from that file, so an unreadable file refuses new reviews instead
 * of resetting the count.
 */

export const REVIEW_REPORT_FILE = 'FORGEBADGER_REVIEW.json';
export const REVIEW_DIFF_FILE = 'FORGEBADGER_REVIEW.diff';
/** Rounds that produced a report; after these the lead decides without another review. */
export const MAX_REVIEW_ROUNDS = 2;
/** Every started attempt, including the ones that ended without a report. */
export const MAX_REVIEW_ATTEMPTS = 4;
export const REVIEW_REPORT_TIMEOUT_MS = 30 * 60_000;
export const REVIEW_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];
export const REVIEW_VERDICTS = ['approve', 'request_changes', 'comment'] as const;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REVIEWS_DIR_PREFIX = 'reviews-';
const MAX_REPORT_BYTES = 256 * 1024;
const MAX_DIFF_FILE_BYTES = 1024 * 1024;
const MAX_FINDINGS = 50;
const MAX_FINDING_FILE = 300;
const MAX_FINDING_MESSAGE = 1200;
const MAX_SUMMARY = 1500;
const JOURNAL_FINDINGS_CHARS = 900;

const findingSchema = z.object({
  file: z.string(), line: z.number().int().min(0).nullable(), severity: z.enum(REVIEW_SEVERITIES), message: z.string()
}).strict();
const reportSchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS), summary: z.string(), findings: z.array(findingSchema).max(MAX_FINDINGS), dropped: z.number().int().min(0)
}).strict();
const attemptSchema = z.object({
  attempt: z.number().int().min(1).max(MAX_REVIEW_ATTEMPTS),
  status: z.enum(['running', 'reported', 'no_report', 'ended']),
  reviewer: z.object({ id: z.string(), name: z.string(), adapter: z.string() }).strict(),
  writerAdapter: z.string().nullable(),
  sessionId: z.string(),
  scope: z.enum(['task', 'goal']),
  commit: z.string(), baseCommit: z.string(), tree: z.string(),
  startedAt: z.number(), settledAt: z.number().nullable(),
  report: reportSchema.nullable()
}).strict();
const stateSchema = z.object({ version: z.literal(1), taskId: z.string(), attempts: z.array(attemptSchema).max(MAX_REVIEW_ATTEMPTS) }).strict();

export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewReport = z.infer<typeof reportSchema>;
export type ReviewAttempt = z.infer<typeof attemptSchema>;
export type ReviewState = z.infer<typeof stateSchema>;

function reviewsRoot(db: Database, goalId: string): string | undefined {
  return UUID.test(goalId) ? path.join(goalWorktreeBase(db), `${REVIEWS_DIR_PREFIX}${goalId}`) : undefined;
}

function checkoutName(taskId: string, attempt: number): string {
  return `${taskId}-r${attempt}`;
}

/** The task's review record; an unreadable record throws instead of pretending no review happened. */
export function readReviewState(db: Database, goalId: string, taskId: string): ReviewState {
  const empty: ReviewState = { version: 1, taskId, attempts: [] };
  const root = reviewsRoot(db, goalId);
  if (!root || !UUID.test(taskId)) return empty;
  let raw: string;
  try { raw = fs.readFileSync(path.join(root, `${taskId}.json`), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty; throw reviewStateError(); }
  try {
    const state = stateSchema.parse(JSON.parse(raw));
    if (state.taskId !== taskId) throw new Error('mismatch');
    return state;
  } catch { throw reviewStateError(); }
}

function reviewStateError(): AgentError {
  return new AgentError('COPILOT_GOAL_REVIEW_STATE_INVALID', 'The review record of this task is unreadable; no further review can be started for it');
}

function writeReviewState(db: Database, goalId: string, state: ReviewState): void {
  const root = reviewsRoot(db, goalId);
  if (!root) throw reviewStateError();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, `${state.taskId}.json`);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(stateSchema.parse(state)), { mode: 0o600 });
  fs.renameSync(temp, target);
}

/** Read-only variant for projections: an unreadable record yields undefined. */
function safeReviewState(db: Database, goalId: string, taskId: string): ReviewState | undefined {
  try { return readReviewState(db, goalId, taskId); } catch { return undefined; }
}

export function reportedRounds(state: ReviewState): number {
  return state.attempts.filter(attempt => attempt.status === 'reported').length;
}

function runningAttempt(state: ReviewState): ReviewAttempt | undefined {
  return state.attempts.find(attempt => attempt.status === 'running');
}

/** Reviews of this goal whose reviewer turn has not settled yet. */
export function runningReviews(db: Database, userId: string, goalId: string): Array<{ task: GoalTaskRow; attempt: ReviewAttempt }> {
  const result: Array<{ task: GoalTaskRow; attempt: ReviewAttempt }> = [];
  for (const task of workStore(db, userId, goalId).listTasks(goalId)) {
    const attempt = runningAttempt(safeReviewState(db, goalId, task.id) ?? { version: 1, taskId: task.id, attempts: [] });
    if (attempt) result.push({ task, attempt });
  }
  return result;
}

// --- Reviewer selection ----------------------------------------------------

/** Adapter of the CLI that last wrote the task (its dispatched session), or null when no CLI did. */
export function writerAdapterOf(db: Database, userId: string, task: GoalTaskRow): string | null {
  if (!task.dispatched_session_id) return null;
  return new SessionRepository(db, userId).getById(task.dispatched_session_id)?.aiTool ?? null;
}

export function pickReviewer(memberId: string | undefined, writerAdapter: string | null): TeamMember {
  const invalid = (message: string) => new AgentError('COPILOT_GOAL_INPUT_INVALID', message);
  const usable = (member: TeamMember) => (PROGRAMMATIC_SUBMIT_ADAPTERS as readonly string[]).includes(member.adapter);
  const reviewers = enabledReviewerMembers();
  if (memberId !== undefined) {
    const member = reviewers.find(entry => entry.id === memberId);
    if (!member) throw invalid(`Team member '${memberId}' is not an enabled reviewer`);
    if (!usable(member)) throw new AgentError('COPILOT_ADAPTER_AUTONOMY_DENIED', `Adapter '${member.adapter}' cannot be driven programmatically yet (manual only).`);
    if (member.adapter === writerAdapter)
      throw invalid(`Team member '${memberId}' uses '${member.adapter}', the same CLI that wrote this task; a review needs a different CLI`);
    return member;
  }
  const member = reviewers.find(entry => usable(entry) && entry.adapter !== writerAdapter);
  if (member) return member;
  throw new AgentError('COPILOT_GOAL_REVIEWER_UNAVAILABLE', reviewers.length
    ? `No enabled reviewer uses a CLI other than the writer's ('${writerAdapter ?? 'none'}') that can be driven programmatically; ask the owner to add one in Copilot settings → Team members`
    : 'No enabled team member has the reviewer role; ask the owner to add one in Copilot settings → Team members');
}

// --- Checkout --------------------------------------------------------------

export interface PreparedReview { state: ReviewState; attempt: number; checkout: GoalReviewCheckout; scope: 'task' | 'goal'; diffFile: boolean; changedFiles: number }

function assertReviewable(goal: GoalRow, task: GoalTaskRow, state: ReviewState): void {
  const notReady = (message: string) => new AgentError('COPILOT_GOAL_TASK_NOT_READY', message);
  if (task.status === 'cancelled') throw new AgentError('COPILOT_GOAL_TASK_CANCELLED', `Task '${task.description}' was cancelled; it cannot be reviewed`);
  if (goal.workspace_kind !== 'worktree' || !goal.workspace_path || !goal.workspace_branch)
    throw new AgentError('COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE', 'A review needs a git-backed goal workspace; this goal uses a copy workspace');
  if (task.dispatch_status === 'running') throw notReady('The task\'s CLI turn is still running; wait for it to finish before reviewing');
  if (runningAttempt(state)) throw notReady('A review of this task is already running; wait for it to finish');
  if (reportedRounds(state) >= MAX_REVIEW_ROUNDS)
    throw new AgentError('COPILOT_GOAL_REVIEW_LIMIT', `This task already had ${MAX_REVIEW_ROUNDS} review rounds; decide on the remaining findings yourself (verify_command stays the pass signal) or use goal_ask_user`);
  if (state.attempts.length >= MAX_REVIEW_ATTEMPTS)
    throw new AgentError('COPILOT_GOAL_REVIEW_LIMIT', `${MAX_REVIEW_ATTEMPTS} review attempts were already started for this task; no further review can be started`);
}

/**
 * Create the one-off checkout for the next attempt and put the diff file in
 * it. Nothing is recorded yet; the caller records the attempt once a reviewer
 * session exists, or discards the checkout.
 */
export async function prepareReview(db: Database, userId: string, goal: GoalRow, task: GoalTaskRow): Promise<PreparedReview> {
  const state = readReviewState(db, goal.id, task.id);
  assertReviewable(goal, task, state);
  const root = reviewsRoot(db, goal.id);
  if (!root || !UUID.test(task.id)) throw new AgentError('COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE', 'Task id is not a valid UUID');
  const ownTree = await taskWorkspaceState(db, goal, task.id) !== 'none';
  const sharedWriter = ownTree ? undefined : sharedTreeWriters(db, goal)[0];
  if (sharedWriter) throw new AgentError('COPILOT_GOAL_TASK_NOT_READY', `Task '${sharedWriter.id}' is still writing in the shared goal tree; wait for it before reviewing there`);
  const sourcePath = ownTree ? (await ensureTaskWorkspace(db, userId, goal, task.id)).path : goal.workspace_path!;
  if (!ownTree && !goal.workspace_base_commit) throw new AgentError('COPILOT_GOAL_TASK_WORKSPACE_UNAVAILABLE', 'The goal workspace has no recorded base commit to diff against');
  const attempt = state.attempts.length + 1;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  let checkout: GoalReviewCheckout;
  try {
    // A checkout left behind by a crashed attempt that was never recorded is ours to discard.
    await removeGoalReviewCheckout({ goalPath: goal.workspace_path!, workspacesRoot: fs.realpathSync(root), name: checkoutName(task.id, attempt) });
    checkout = await createGoalReviewCheckout({
      goalPath: goal.workspace_path!, goalBranch: goal.workspace_branch!, sourcePath, workspacesRoot: fs.realpathSync(root),
      name: checkoutName(task.id, attempt), excludePaths: GOAL_MANAGED_PATHS, ...(ownTree ? {} : { baseCommit: goal.workspace_base_commit! })
    });
  } catch (error) { throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not create the review checkout'); }
  try {
    const diff = await readGoalReviewDiff({ path: checkout.path, baseCommit: checkout.baseCommit, commit: checkout.commit, excludePaths: GOAL_MANAGED_PATHS });
    if (diff !== undefined && !diff.trim())
      throw new AgentError('COPILOT_GOAL_TASK_NOT_READY', ownTree
        ? 'This task has no changes that are not already in the goal branch; review a task before integrating it'
        : 'The goal workspace has no changes to review');
    const diffFile = diff !== undefined && Buffer.byteLength(diff) <= MAX_DIFF_FILE_BYTES;
    // A file of that name inside the reviewed tree is the writer's, never the reviewer's answer.
    fs.rmSync(path.join(checkout.path, REVIEW_REPORT_FILE), { recursive: true, force: true });
    fs.rmSync(path.join(checkout.path, REVIEW_DIFF_FILE), { recursive: true, force: true });
    if (diffFile) fs.writeFileSync(path.join(checkout.path, REVIEW_DIFF_FILE), diff!, { mode: 0o600, flag: 'wx' });
    const changedFiles = diff === undefined ? 0 : (diff.match(/^diff --git /gm) ?? []).length;
    return { state, attempt, checkout, scope: ownTree ? 'task' : 'goal', diffFile, changedFiles };
  } catch (error) {
    await discardReviewCheckout(db, goal, task.id, attempt);
    throw goalGitError(error, 'COPILOT_GOAL_WORKSPACE_FAILED', 'Could not read the changes to review');
  }
}

export async function discardReviewCheckout(db: Database, goal: GoalRow, taskId: string, attempt: number): Promise<void> {
  const root = reviewsRoot(db, goal.id);
  if (!root || !goal.workspace_path || !fs.existsSync(root)) return;
  try { await removeGoalReviewCheckout({ goalPath: goal.workspace_path, workspacesRoot: fs.realpathSync(root), name: checkoutName(taskId, attempt) }); }
  catch { /* left for the next sweep */ }
}

export function recordReviewStarted(db: Database, goalId: string, prepared: PreparedReview, reviewer: TeamMember, writerAdapter: string | null, sessionId: string): ReviewAttempt {
  const entry: ReviewAttempt = {
    attempt: prepared.attempt, status: 'running', reviewer: { id: reviewer.id, name: reviewer.name, adapter: reviewer.adapter }, writerAdapter,
    sessionId, scope: prepared.scope, commit: prepared.checkout.commit, baseCommit: prepared.checkout.baseCommit, tree: prepared.checkout.tree,
    startedAt: Date.now(), settledAt: null, report: null
  };
  writeReviewState(db, goalId, { ...prepared.state, attempts: [...prepared.state.attempts, entry] });
  return entry;
}

/**
 * The instructions could not be confirmed as delivered. The reviewer may still
 * have received them, so the attempt stays on the record (it counts toward the
 * attempt cap, never as a round) and is settled as ended.
 */
export function abandonReviewAttempt(db: Database, userId: string, goalId: string, taskId: string, attempt: number): void {
  try { settleAttempt(db, userId, goalId, taskId, attempt, 'ended'); } catch { /* the record stays `running`; the driver settles it */ }
}

// --- Instructions ----------------------------------------------------------

export function reviewInstructions(input: { task: GoalTaskRow; reviewer: TeamMember; prepared: PreparedReview; focus?: string | undefined }): string {
  const { task, reviewer, prepared } = input;
  const base = prepared.checkout.baseCommit.slice(0, 12);
  const lines = [
    `[ForgeBadger review] You are ${reviewer.name}${reviewer.title ? `, ${reviewer.title}` : ''}.${reviewer.description ? ` ${reviewer.description}` : ''}`,
    'Review the changes another agent made for one task. You did not write them and you have none of its conversation; judge only what is in this directory.',
    `Task: ${task.description}`,
    ...(task.verify_command ? [`Its machine check (already the pass signal, do not re-argue it): ${task.verify_command}`] : []),
    ...(input.focus ? [`Review focus from the lead: ${input.focus}`] : []),
    `This directory is a throwaway detached checkout of the result. The changes under review are \`git diff ${base} HEAD\`${prepared.diffFile ? ` (also saved as ${REVIEW_DIFF_FILE})` : ''}`
      + `${prepared.scope === 'goal' ? '; this task shares its tree with other tasks of the goal, so the diff holds all of the goal\'s work so far - review only what belongs to this task' : ''}. `
      + 'Read surrounding code as needed. Do not fix anything, commit, push or switch branches: this checkout is deleted when you finish.',
    'Report only defects in the changed code or directly caused by it (bugs, broken behaviour, security, missing error handling, tests that do not test the change). No style preferences, no praise.',
    `Write your result to ${REVIEW_REPORT_FILE} in this directory as JSON, exactly this shape, then end your turn:`,
    '{"verdict":"approve|request_changes|comment","summary":"one or two sentences","findings":[{"file":"path/in/repo","line":123,"severity":"critical|high|medium|low","message":"what is wrong and why"}]}',
    `Use "findings": [] when you found nothing; at most ${MAX_FINDINGS} findings; "line" is the line in the new file, or null.`
  ];
  return lines.join('\n');
}

// --- Report collection -----------------------------------------------------

/** Parse the reviewer's file leniently: clip, coerce, drop what is unusable. All text is untrusted and redacted. */
export function parseReviewReport(raw: string): ReviewReport | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.findings)) return undefined;
  const findings: ReviewFinding[] = [];
  let dropped = 0;
  for (const entry of record.findings) {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const message = cliText(item.message, MAX_FINDING_MESSAGE);
    if (!message || findings.length >= MAX_FINDINGS) { dropped += 1; continue; }
    const severity = typeof item.severity === 'string' ? item.severity.toLowerCase() : '';
    findings.push({
      file: cliText(item.file, MAX_FINDING_FILE, true),
      line: typeof item.line === 'number' && Number.isInteger(item.line) && item.line >= 0 ? item.line : null,
      severity: (REVIEW_SEVERITIES as readonly string[]).includes(severity) ? severity as ReviewSeverity : 'medium',
      message
    });
  }
  const order = (finding: ReviewFinding) => REVIEW_SEVERITIES.indexOf(finding.severity);
  findings.sort((a, b) => order(a) - order(b));
  const verdict = (REVIEW_VERDICTS as readonly unknown[]).includes(record.verdict)
    ? record.verdict as ReviewReport['verdict'] : (findings.length ? 'comment' : 'approve');
  return { verdict, summary: cliText(record.summary, MAX_SUMMARY), findings, dropped };
}

function readReportFile(checkoutPath: string): ReviewReport | undefined {
  let fd: number | undefined;
  try {
    // One descriptor for the type check and the read; a symlink is never followed and the read is bounded.
    fd = fs.openSync(path.join(checkoutPath, REVIEW_REPORT_FILE), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    if (!fs.fstatSync(fd).isFile()) return undefined;
    const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return read > MAX_REPORT_BYTES ? undefined : parseReviewReport(buffer.subarray(0, read).toString('utf8'));
  } catch { return undefined; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function severityCounts(findings: ReviewFinding[]): string {
  const parts = REVIEW_SEVERITIES.map(severity => [severity, findings.filter(finding => finding.severity === severity).length] as const)
    .filter(([, count]) => count > 0).map(([severity, count]) => `${count} ${severity}`);
  return parts.length ? parts.join(', ') : 'none';
}

function journalNote(task: GoalTaskRow, attempt: ReviewAttempt): string {
  const who = `${attempt.reviewer.name} (${attempt.reviewer.adapter})`;
  const tail = ' A review is unverified evidence from the reviewer CLI: it does not replace the verify_command and does not pass or merge anything.';
  if (!attempt.report) {
    const why = attempt.status === 'no_report'
      ? `finished its turn without a usable ${REVIEW_REPORT_FILE}` : 'ended or timed out without a report';
    return `Review attempt ${attempt.attempt} of task '${task.id}' by ${who} ${why}; it does not count as a review round.${tail}`;
  }
  const { report } = attempt;
  let shown = '';
  for (const finding of report.findings) {
    const line = ` [${finding.severity}] ${finding.file || '(no file)'}${finding.line === null ? '' : `:${finding.line}`} ${cliText(finding.message, 200, true)};`;
    if (shown.length + line.length > JOURNAL_FINDINGS_CHARS) break;
    shown += line;
  }
  return `Review of task '${task.id}' by ${who} finished: verdict ${report.verdict}, findings: ${severityCounts(report.findings)}.`
    + (shown ? ` Findings (from the reviewer, unverified):${shown}` : '')
    + ` Read all of them with goal_get_review; hand the ones that matter for this task back to the writer with goal_dispatch_task.${tail}`;
}

/** Settle a running attempt from what is on disk. Returns the settled attempt, or undefined when it was not running any more. */
function settleAttempt(db: Database, userId: string, goalId: string, taskId: string, attemptNumber: number, fallback: 'no_report' | 'ended'): ReviewAttempt | undefined {
  const store = workStore(db, userId, goalId);
  const task = store.listTasks(goalId).find(entry => entry.id === taskId);
  const state = safeReviewState(db, goalId, taskId);
  const current = state?.attempts.find(entry => entry.attempt === attemptNumber);
  const root = reviewsRoot(db, goalId);
  if (!task || !state || !current || current.status !== 'running' || !root) return undefined;
  const report = readReportFile(path.join(root, checkoutName(taskId, attemptNumber)));
  const settled: ReviewAttempt = { ...current, status: report ? 'reported' : fallback, settledAt: Date.now(), report: report ?? null };
  writeReviewState(db, goalId, { ...state, attempts: state.attempts.map(entry => entry.attempt === attemptNumber ? settled : entry) });
  // A collected report is progress for the stagnation counter (bounded by the round cap); a missing one is not.
  if (report) store.touchTask(goalId, taskId);
  store.appendJournal(goalId, null, journalNote(task, settled));
  return settled;
}

/** Which review a session belongs to, derived from its working directory `<reviews-root>/<taskId>-r<n>`. */
function reviewOfSession(db: Database, userId: string, sessionId: string): { goalId: string; taskId: string; attempt: number } | undefined {
  const session = new SessionRepository(db, userId).getById(sessionId);
  if (!session?.workingDir) return undefined;
  const match = /^([a-f0-9-]{36})-r([1-9])$/i.exec(path.basename(session.workingDir));
  const parent = path.dirname(session.workingDir);
  const goalId = path.basename(parent).startsWith(REVIEWS_DIR_PREFIX) ? path.basename(parent).slice(REVIEWS_DIR_PREFIX.length) : '';
  if (!match || !UUID.test(match[1]!) || !UUID.test(goalId) || path.dirname(parent) !== goalWorktreeBase(db)) return undefined;
  return { goalId, taskId: match[1]!, attempt: Number(match[2]) };
}

export interface ReviewCleanupDeps { sessionManager?: InMemorySessionManager | undefined }

const cleaning = new Set<string>();

/** Stop the reviewer session and delete its checkout. Best effort, single-flight; a leftover is retried by the next sweep. */
export function cleanupReview(db: Database, deps: ReviewCleanupDeps, userId: string, goalId: string, taskId: string, attempt: ReviewAttempt): Promise<void> {
  const key = `${goalId}:${checkoutName(taskId, attempt.attempt)}`;
  if (cleaning.has(key)) return Promise.resolve();
  cleaning.add(key);
  return (async () => {
    const sessions = new SessionRepository(db, userId);
    const session = sessions.getById(attempt.sessionId);
    const live = deps.sessionManager?.getSession(attempt.sessionId);
    const runtimeName = live?.runtimeSessionName ?? session?.runtimeSessionName ?? undefined;
    if (deps.sessionManager && session && (live || runtimeName)) {
      await deps.sessionManager.stopSession(attempt.sessionId, runtimeName, userId);
      if (db.open) sessions.update(attempt.sessionId, { status: 'exited', attachToken: '', runtimeSessionName: null, lastActive: new Date() });
    }
    const goal = db.open ? workStore(db, userId, goalId).getGoal(goalId) : undefined;
    if (goal) await discardReviewCheckout(db, goal, taskId, attempt.attempt);
  })().catch(() => undefined).finally(() => { cleaning.delete(key); });
}

/**
 * CLI turn-end hook of a reviewer session: collect the report and release the
 * goal. Child-agent turns never settle a review.
 */
export function settleGoalReviewFromHook(db: Database, event: ForgeBadgerEvent, deps: ReviewCleanupDeps = {}): Array<{ userId: string; goalId: string }> {
  if (event.type !== 'session_notification' || event.nativeSubagent) return [];
  if (event.notificationType !== 'task_completed' && event.notificationType !== 'task_failed') return [];
  const target = reviewOfSession(db, event.userId, event.sessionId);
  if (!target) return [];
  const running = safeReviewState(db, target.goalId, target.taskId)?.attempts.find(entry => entry.attempt === target.attempt);
  if (!running || running.sessionId !== event.sessionId) return [];
  const settled = settleAttempt(db, event.userId, target.goalId, target.taskId, target.attempt, 'no_report');
  if (!settled) return [];
  void cleanupReview(db, deps, event.userId, target.goalId, target.taskId, settled);
  return [{ userId: event.userId, goalId: target.goalId }];
}

/**
 * Goal driver side: true while a reviewer turn is still running. A review
 * whose session stopped, vanished or stayed silent past the timeout settles
 * (with its report when the file is there). Leftover checkouts of settled
 * attempts are removed. `abandon` settles every running review at once: the
 * goal is over (cancelled or completed) and nobody will read the findings.
 */
export function awaitingReviews(db: Database, deps: ReviewCleanupDeps, userId: string, goalId: string, now: number, options: { abandon?: boolean } = {}): boolean {
  const sessions = new SessionRepository(db, userId);
  const root = reviewsRoot(db, goalId);
  if (!root || !fs.existsSync(root)) return false;
  let waiting = false;
  for (const task of workStore(db, userId, goalId).listTasks(goalId)) {
    for (const attempt of safeReviewState(db, goalId, task.id)?.attempts ?? []) {
      if (attempt.status === 'running') {
        const alive = sessions.getById(attempt.sessionId)?.status === 'running';
        if (!options.abandon && alive && now - attempt.startedAt < REVIEW_REPORT_TIMEOUT_MS) { waiting = true; continue; }
        const settled = settleAttempt(db, userId, goalId, task.id, attempt.attempt, 'ended');
        if (settled) void cleanupReview(db, deps, userId, goalId, task.id, settled);
      } else if (fs.existsSync(path.join(root, checkoutName(task.id, attempt.attempt)))) {
        void cleanupReview(db, deps, userId, goalId, task.id, attempt);
      }
    }
  }
  return waiting;
}

// --- Projections -----------------------------------------------------------

/** Compact per-task line for the goal context. */
export function reviewSummaryForModel(db: Database, goalId: string, taskId: string): Record<string, unknown> | undefined {
  const state = safeReviewState(db, goalId, taskId);
  if (!state?.attempts.length) return undefined;
  const last = state.attempts.at(-1)!;
  return {
    rounds: reportedRounds(state), roundsLeft: Math.max(0, MAX_REVIEW_ROUNDS - reportedRounds(state)), last: last.status,
    ...(last.report ? { verdict: last.report.verdict, findings: severityCounts(last.report.findings) } : {})
  };
}
