import type { Database } from '../../db/types.js';
import { NotificationService } from '../notification-service.js';
import type { GoalRow } from './goal-store.js';

/**
 * Terminal-state notifications for goals. Fires once per
 * (goal, status, blockedReason, question): the state machine transitions
 * once per question cycle, and a payload-scoped dedupe query covers
 * re-entrant evaluation paths, while a NEW awaiting_user question (after an
 * answer) notifies again. Cancel is owner-initiated and never notified.
 */

export const GOAL_NOTIFICATION_TYPE = 'copilot_goal';
export const GOAL_NOTIFICATION_TITLE_KEY = 'notifications.copilotGoalStatusChanged';

export function notifyGoalStatus(db: Database, userId: string, goal: GoalRow): void {
  if (goal.status !== 'completed' && goal.status !== 'blocked') return;
  const question = goal.blocked_reason === 'awaiting_user' ? goal.pending_question : null;
  // Every awaiting_user cycle notifies again. The sequence derives from the
  // goal's own ask-journal (one "Decision required" entry per cycle), so a
  // re-entrant evaluation within one cycle still dedupes while a later cycle
  // — even repeating the same question — notifies again.
  const cycles = goal.blocked_reason === 'awaiting_user'
    ? (db.prepare(`SELECT count(*) AS count FROM copilot_goal_journal WHERE user_id=? AND goal_id=? AND note LIKE 'Decision required from owner:%'`)
        .get(userId, goal.id) as { count: number }).count
    : 0;
  const notifySeq = question ? Math.max(1, cycles) : 1;
  const duplicate = db.prepare(`SELECT 1 FROM notifications WHERE user_id=? AND type=?
      AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.goal_id')=?
      AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.status')=?
      AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.blocked_reason') IS ?
      AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.question') IS ?
      AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.notify_seq')=?
    LIMIT 1`)
    .get(userId, GOAL_NOTIFICATION_TYPE, goal.id, goal.status, goal.blocked_reason, question, notifySeq);
  if (duplicate) return;
  const statusText = goal.status === 'completed' ? 'completed'
    : goal.blocked_reason === 'awaiting_user' ? 'awaits your decision' : 'blocked';
  const message = question
    ? `Goal "${goal.title}" awaits your decision: ${question}`
    : `Goal "${goal.title}" ${statusText}${goal.blocked_reason ? ` (${goal.blocked_reason})` : ''}`;
  try {
    new NotificationService(db, userId).create({
      type: GOAL_NOTIFICATION_TYPE,
      titleKey: GOAL_NOTIFICATION_TITLE_KEY,
      message,
      href: `/copilot/goals/${goal.id}`,
      payload: { goal_id: goal.id, status: goal.status, blocked_reason: goal.blocked_reason, question, notify_seq: notifySeq }
    });
  } catch {
    // Notification delivery must never break the goal state machine.
  }
}
