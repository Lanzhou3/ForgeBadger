import { createHash } from "node:crypto";

import type { Database } from "../../db/types.js";
import { PortfolioRepository } from "../../db/repositories/portfolio-repository.js";
import type { ProjectRootValidator } from "./observation-service.js";

interface ActiveProjectRow {
  user_id: string;
  project_id: string;
  path: string;
}

/**
 * Internal startup provisioning only: it reads the project-owned path,
 * validates it, then activates a fixed V1 profile with that identity. No HTTP
 * DTO can provide a profile root or mutable probe configuration.
 */
export function provisionActiveObservationProfiles(input: {
  db: Database;
  projectRootValidator: ProjectRootValidator;
}): { activated: number; skipped: number } {
  const rows = input.db.prepare(`SELECT enrollment.user_id, enrollment.project_id, project.path
    FROM portfolio_projects enrollment
    INNER JOIN projects project ON project.user_id = enrollment.user_id AND project.id = enrollment.project_id
    WHERE enrollment.enrollment_status = 'active'`).all() as ActiveProjectRow[];
  let activated = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const approvedRoot = input.projectRootValidator.validate(row.path);
      new PortfolioRepository(input.db, row.user_id).activateObservationProfile({
        projectId: row.project_id,
        approvedRoot,
        idempotencyKey: profileIdempotencyKey(row.project_id, approvedRoot)
      });
      activated += 1;
    } catch {
      skipped += 1;
    }
  }
  return { activated, skipped };
}

function profileIdempotencyKey(projectId: string, root: { canonicalPath: string; device: number; inode: number }): string {
  const identity = `${root.canonicalPath}:${root.device}:${root.inode}`;
  return `observation-profile:${projectId}:${createHash("sha256").update(identity).digest("hex")}`;
}
