import type { Database } from '../types.js';

export interface TaskNotificationEvidence {
  id: string;
  sequence: number;
  notificationType: string;
  message: string;
}

/** Persistent CLI evidence, always tenant and session scoped. Sequence is SQLite rowid, not seconds. */
export class TaskDispatchEvidenceRepository {
  constructor(private readonly db: Database, private readonly userId: string) {}

  baseline(): number {
    // Tenant watermark is independent of board/list pagination.
    return (this.db.prepare('SELECT COALESCE(MAX(rowid), 0) AS sequence FROM notifications WHERE user_id = ?').get(this.userId) as { sequence: number }).sequence;
  }

  anchor(sequence: number): string | undefined {
    return (this.db.prepare('SELECT id FROM notifications WHERE user_id = ? AND rowid = ?').get(this.userId, sequence) as { id: string } | undefined)?.id;
  }

  markManualIntervention(sessionId: string): void {
    this.db.prepare(`UPDATE project_manager_work_items
      SET details_json=json_set(details_json,'$.taskPacket.attempt.manualInterventionAt',?)
      WHERE user_id=? AND json_extract(details_json,'$.taskPacket.attempt.sessionId')=?
        AND json_extract(details_json,'$.taskPacket.attempt.status') IN ('sending','dispatched')
        AND json_extract(details_json,'$.taskPacket.attempt.consumedNotificationId') IS NULL
        AND json_extract(details_json,'$.taskPacket.attempt.manualInterventionAt') IS NULL`)
      .run(new Date().toISOString(), this.userId, sessionId);
  }

  notifications(sessionId: string, after: number, id?: string): TaskNotificationEvidence[] {
    const first = this.db.prepare(`
      SELECT id, rowid AS sequence, json_extract(payload, '$.notification_type') AS notificationType, message
      FROM notifications WHERE user_id = ? AND session_id = ? AND rowid > ?
        AND type = 'claude_notification' AND json_valid(payload)
        AND json_extract(payload, '$.notification_type') IN ('task_completed', 'task_failed', 'task_interrupted')
        AND (? IS NULL OR id = ?) ORDER BY rowid ASC LIMIT 20
    `).all(this.userId, sessionId, after, id ?? null, id ?? null) as TaskNotificationEvidence[];
    if (id || first.some(row => row.notificationType !== 'task_interrupted')) return first;
    // The first terminal hook must remain visible even after a long run of interruptions.
    const terminal = this.db.prepare(`
      SELECT id, rowid AS sequence, json_extract(payload, '$.notification_type') AS notificationType, message
      FROM notifications WHERE user_id = ? AND session_id = ? AND rowid > ?
        AND type = 'claude_notification' AND json_valid(payload)
        AND json_extract(payload, '$.notification_type') IN ('task_completed', 'task_failed')
      ORDER BY rowid ASC LIMIT 1
    `).get(this.userId, sessionId, after) as TaskNotificationEvidence | undefined;
    return terminal ? [...first.slice(0, 19), terminal] : first;
  }

  pendingTasks(): Array<{ projectId: string; workItemId: string }> {
    return this.db.prepare(`
      SELECT project_id AS projectId, id AS workItemId FROM project_manager_work_items
      WHERE user_id = ? AND status = 'in_progress'
        AND json_extract(details_json, '$.taskPacket.attempt.status') = 'dispatched'
      ORDER BY id
    `).all(this.userId) as Array<{ projectId: string; workItemId: string }>;
  }

  static pendingOwners(db: Database): string[] {
    return (db.prepare(`SELECT DISTINCT user_id FROM project_manager_work_items
      WHERE status = 'in_progress' AND json_extract(details_json, '$.taskPacket.attempt.status') = 'dispatched'`).all() as Array<{ user_id: string }>).map(row => row.user_id);
  }
}
