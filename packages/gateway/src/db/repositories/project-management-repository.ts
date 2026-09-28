import type { Database } from "../types.js";
import { ProjectRepository } from "./project-repository.js";
import type { ProjectManagerWorkItemStatus } from "./project-manager-repository.js";
import { ConflictError, NotFoundError } from "../../middleware/errors.js";

export interface ProjectManagement {
  projectId: string;
  mode: "manual" | "cli";
  ownerLabel: string;
  nextAction: string;
  freshnessHours: number;
  revision: number;
  updatedAt: number | null;
}
interface ManagementRow {
  project_id: string; mode: "manual" | "cli"; owner_label: string;
  next_action: string; freshness_hours: number; revision: number; updated_at: number;
}
export interface ManagementEvidenceRow {
  status: ProjectManagerWorkItemStatus;
  evidence_refs_json: string;
}

export class ProjectManagementRepository {
  constructor(private db: Database, private userId: string) {}

  get(projectId: string): ProjectManagement {
    this.requireProject(projectId);
    const row = this.db.prepare("SELECT * FROM project_manager_management WHERE user_id=? AND project_id=?")
      .get(this.userId, projectId) as ManagementRow | undefined;
    return row ? {
      projectId, mode: row.mode, ownerLabel: row.owner_label, nextAction: row.next_action,
      freshnessHours: row.freshness_hours, revision: row.revision, updatedAt: row.updated_at,
    } : { projectId, mode: "manual", ownerLabel: "", nextAction: "", freshnessHours: 72, revision: 0, updatedAt: null };
  }

  update(projectId: string, expectedRevision: number, patch: Partial<Pick<ProjectManagement, "mode" | "ownerLabel" | "nextAction" | "freshnessHours">>): ProjectManagement {
    return this.db.transaction(() => {
      const previous = this.get(projectId);
      if (previous.revision !== expectedRevision) throw new ConflictError("Stale management revision");
      const next = { ...previous, ...patch, revision: previous.revision + 1 };
      this.db.prepare(`INSERT INTO project_manager_management
        (project_id,user_id,mode,owner_label,next_action,freshness_hours,revision,updated_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET
        mode=excluded.mode,owner_label=excluded.owner_label,next_action=excluded.next_action,
        freshness_hours=excluded.freshness_hours,revision=excluded.revision,updated_at=excluded.updated_at
        WHERE project_manager_management.user_id=excluded.user_id AND project_manager_management.revision=?`)
        .run(projectId, this.userId, next.mode, next.ownerLabel, next.nextAction, next.freshnessHours, next.revision, Date.now(), expectedRevision);
      return this.get(projectId);
    }).immediate();
  }

  evidenceRows(projectId: string): ManagementEvidenceRow[] {
    this.requireProject(projectId);
    // Overview counts must not inherit the interactive board's page limit.
    return this.db.prepare("SELECT status,evidence_refs_json FROM project_manager_work_items WHERE user_id=? AND project_id=?")
      .all(this.userId, projectId) as ManagementEvidenceRow[];
  }

  private requireProject(projectId: string): void {
    if (!new ProjectRepository(this.db, this.userId).getById(projectId)) throw new NotFoundError("Project not found");
  }
}
