import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProjectManagerExecutionRepository } from "../src/db/repositories/project-manager-execution-repository.js";
import { ProjectManagerRepository } from "../src/db/repositories/project-manager-repository.js";
import { ProjectRepository } from "../src/db/repositories/project-repository.js";
import { SessionRepository } from "../src/db/repositories/session-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { backfillProjectManagerExecutionLedger } from "../src/services/project-manager/execution-backfill.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  migrate(drizzle(db), {
    migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations")
  });
  return db;
}

describe("backfillProjectManagerExecutionLedger", () => {
  it("backfills valid task packet links and fails closed for missing, cross-project, or ambiguous sessions", () => {
    const db = createTestDb();
    const userId = new UserRepository(db).create("backfill-owner@example.com", "hash").id;
    const projects = new ProjectRepository(db, userId);
    const project = projects.create({
      name: "Backfill project",
      path: "/tmp/backfill",
      aiTool: "claude"
    });
    const foreignProject = projects.create({
      name: "Other project",
      path: "/tmp/backfill-other",
      aiTool: "codex"
    });
    const sessions = new SessionRepository(db, userId);
    const validSession = sessions.create({
      projectId: project.id,
      name: "Valid linked session",
      aiTool: "claude",
      workingDir: project.path
    });
    const foreignSession = sessions.create({
      projectId: foreignProject.id,
      name: "Wrong project session",
      aiTool: "codex",
      workingDir: foreignProject.path
    });
    const workItems = new ProjectManagerRepository(db, userId);
    const valid = workItems.createWorkItem(project.id, {
      title: "Valid legacy packet",
      details: { taskPacket: { sessionId: validSession.id, promptDigest: "legacy-valid" } }
    });
    const missing = workItems.createWorkItem(project.id, {
      title: "Missing legacy session",
      details: { taskPacket: { sessionId: "missing-session" } }
    });
    const crossProject = workItems.createWorkItem(project.id, {
      title: "Cross-project legacy session",
      details: { taskPacket: { sessionId: foreignSession.id } }
    });
    const ambiguous = workItems.createWorkItem(project.id, {
      title: "Ambiguous legacy attempt",
      details: { taskPacket: { sessionId: validSession.id, promptDigest: "legacy-ambiguous" } }
    });
    new ProjectManagerExecutionRepository(db, userId).createOrReusePreparedAttempt({
      projectId: project.id,
      workItemId: ambiguous.id,
      inputVersion: 99,
      inputDigest: "sha256:unrelated-existing-attempt"
    });

    const summary = backfillProjectManagerExecutionLedger(db);

    assert.equal(summary.created, 1);
    assert.deepEqual(
      summary.skipped.map((entry) => [entry.workItemId, entry.reason]).sort(),
      [
        [ambiguous.id, "ambiguous_existing_execution"],
        [crossProject.id, "session_scope_mismatch"],
        [missing.id, "session_not_found"]
      ].sort()
    );
    const attempt = db.prepare(`
      SELECT id, observed_state FROM project_manager_task_attempts WHERE work_item_id = ?
    `).get(valid.id) as { id: string; observed_state: string };
    const assignment = db.prepare(`
      SELECT session_id, adapter, active_slot FROM project_manager_session_assignments WHERE attempt_id = ?
    `).get(attempt.id) as { session_id: string; adapter: string; active_slot: string | null };
    assert.equal(attempt.observed_state, "prepared");
    assert.deepEqual(assignment, {
      session_id: validSession.id,
      adapter: "claude",
      active_slot: null
    });

    const repeated = backfillProjectManagerExecutionLedger(db);
    assert.equal(repeated.created, 0);
    assert.equal(repeated.reused, 1);
    const count = db.prepare("SELECT COUNT(*) AS count FROM project_manager_task_attempts WHERE work_item_id = ?")
      .get(valid.id) as { count: number };
    assert.equal(count.count, 1);
  });
});
