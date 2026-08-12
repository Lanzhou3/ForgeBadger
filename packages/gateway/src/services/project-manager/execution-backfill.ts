import { ProjectManagerExecutionRepository } from "../../db/repositories/project-manager-execution-repository.js";
import type { Database } from "../../db/types.js";
import { digestTaskPacket } from "./execution-ledger.js";

export type ProjectManagerBackfillSkipReason =
  | "invalid_task_packet"
  | "session_not_found"
  | "session_scope_mismatch"
  | "ambiguous_existing_execution";

export interface ProjectManagerExecutionBackfillSummary {
  created: number;
  reused: number;
  skipped: Array<{ workItemId: string; reason: ProjectManagerBackfillSkipReason }>;
}

interface WorkItemRow {
  id: string;
  user_id: string;
  project_id: string;
  details_json: string;
}

interface SessionRow {
  id: string;
  project_id: string;
  ai_tool: string;
}

function readTaskPacket(detailsJson: string): Record<string, unknown> | null {
  try {
    const details: unknown = JSON.parse(detailsJson);
    if (details === null || typeof details !== "object" || Array.isArray(details)) return null;
    const taskPacket = (details as Record<string, unknown>).taskPacket;
    return taskPacket !== null && typeof taskPacket === "object" && !Array.isArray(taskPacket)
      ? taskPacket as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function backfillProjectManagerExecutionLedger(db: Database): ProjectManagerExecutionBackfillSummary {
  const summary: ProjectManagerExecutionBackfillSummary = { created: 0, reused: 0, skipped: [] };
  const workItems = db.prepare(`
    SELECT id, user_id, project_id, details_json FROM project_manager_work_items ORDER BY created_at ASC
  `).all() as WorkItemRow[];

  for (const workItem of workItems) {
    const taskPacket = readTaskPacket(workItem.details_json);
    if (!taskPacket || !("sessionId" in taskPacket)) continue;
    if (typeof taskPacket.sessionId !== "string" || taskPacket.sessionId.trim().length === 0) {
      summary.skipped.push({ workItemId: workItem.id, reason: "invalid_task_packet" });
      continue;
    }

    const session = db.prepare(`
      SELECT id, project_id, ai_tool FROM sessions WHERE id = ? AND user_id = ?
    `).get(taskPacket.sessionId.trim(), workItem.user_id) as SessionRow | undefined;
    if (!session) {
      summary.skipped.push({ workItemId: workItem.id, reason: "session_not_found" });
      continue;
    }
    if (session.project_id !== workItem.project_id) {
      summary.skipped.push({ workItemId: workItem.id, reason: "session_scope_mismatch" });
      continue;
    }

    const existing = db.prepare(`
      SELECT a.id AS attempt_id, s.session_id
      FROM project_manager_task_attempts a
      LEFT JOIN project_manager_session_assignments s
        ON s.user_id = a.user_id AND s.attempt_id = a.id
      WHERE a.user_id = ? AND a.project_id = ? AND a.work_item_id = ?
    `).all(workItem.user_id, workItem.project_id, workItem.id) as Array<{
      attempt_id: string;
      session_id: string | null;
    }>;
    if (existing.length > 0) {
      const isExactReuse = existing.length === 1 && existing[0]?.session_id === session.id;
      if (isExactReuse) summary.reused += 1;
      else summary.skipped.push({ workItemId: workItem.id, reason: "ambiguous_existing_execution" });
      continue;
    }

    // Each legacy row migrates atomically so an assignment failure cannot leave a partial attempt.
    const migrateOne = db.transaction(() => {
      const repository = new ProjectManagerExecutionRepository(db, workItem.user_id);
      const attempt = repository.createOrReusePreparedAttempt({
        projectId: workItem.project_id,
        workItemId: workItem.id,
        inputVersion: 1,
        inputDigest: digestTaskPacket(taskPacket)
      });
      repository.createAssignment({
        projectId: workItem.project_id,
        workItemId: workItem.id,
        attemptId: attempt.id,
        sessionId: session.id,
        adapter: session.ai_tool,
        capabilities: {},
        leaseExpiresAt: new Date(0),
        active: false
      });
    });
    migrateOne();
    summary.created += 1;
  }

  return summary;
}
