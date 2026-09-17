import { z } from "zod";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import { ProjectManagerRepository, PROJECT_MANAGER_WORK_ITEM_STATUSES } from "../../db/repositories/project-manager-repository.js";
import { ProjectManagementRepository, type ManagementEvidenceRow } from "../../db/repositories/project-management-repository.js";
import type { CommandContext, PlatformCommand } from "../platform-commands/types.js";
import { ConflictError } from "../../middleware/errors.js";

export const managementPatchSchema = z.object({
  expectedRevision: z.number().int().min(0),
  mode: z.enum(["manual", "cli"]).optional(),
  ownerLabel: z.string().trim().max(200).optional(),
  nextAction: z.string().trim().max(2000).optional(),
  freshnessHours: z.number().int().min(1).max(8760).optional(),
}).strict();
const commandSchema = managementPatchSchema.extend({ projectId: z.string().min(1).max(128) }).strict();

export function createManagementCommands(): PlatformCommand[] {
  return [{
    id: "pm.management.update", capability: "pm.management.update", effect: "database", delegatable: true,
    inputSchema: commandSchema,
    resolve(context, raw) {
      const { projectId, expectedRevision } = commandSchema.parse(raw);
      const current = new ProjectManagementRepository(context.db, context.userId).get(projectId);
      if (current.revision !== expectedRevision) throw new ConflictError("Stale management revision");
      return { projectIds: [projectId], revision: String(current.revision) };
    },
    execute(context, raw) {
      const { projectId, expectedRevision, ...patch } = commandSchema.parse(raw);
      return new ProjectManagementRepository(context.db, context.userId).update(projectId, expectedRevision, {
        ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
        ...(patch.ownerLabel !== undefined ? { ownerLabel: patch.ownerLabel } : {}),
        ...(patch.nextAction !== undefined ? { nextAction: patch.nextAction } : {}),
        ...(patch.freshnessHours !== undefined ? { freshnessHours: patch.freshnessHours } : {}),
      });
    },
  }];
}

function evidenceFreshness(rows: ManagementEvidenceRow[], freshnessHours: number, now: number) {
  let fresh = 0, stale = 0, unknown = 0;
  let lastObservedAt: number | null = null;
  for (const row of rows) {
    let entries: unknown;
    try { entries = JSON.parse(row.evidence_refs_json); } catch { unknown++; continue; }
    const times = (Array.isArray(entries) ? entries : []).flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object" || !("createdAt" in entry) || typeof entry.createdAt !== "string") return [];
      const time = Date.parse(entry.createdAt);
      return Number.isFinite(time) && time <= now ? [time] : [];
    });
    if (!times.length) { unknown++; continue; }
    const latest = Math.max(...times);
    lastObservedAt = Math.max(lastObservedAt ?? latest, latest);
    if (now - latest > freshnessHours * 3600000) stale++; else fresh++;
  }
  return { status: stale ? "stale" as const : unknown || !rows.length ? "unknown" as const : "fresh" as const,
    fresh, stale, unknown, lastObservedAt, source: "declared_evidence_timestamp" as const };
}

export function projectManagementOverview(context: CommandContext, allowedProjectIds?: readonly string[], now = Date.now()) {
  const managementRepo = new ProjectManagementRepository(context.db, context.userId);
  const pm = new ProjectManagerRepository(context.db, context.userId);
  const allowed = allowedProjectIds === undefined ? undefined : new Set(allowedProjectIds);
  const projects = new ProjectRepository(context.db, context.userId).list().filter(p => allowed === undefined || allowed.has(p.id));
  return { projects: projects.map(project => {
    const management = managementRepo.get(project.id);
    const rows = managementRepo.evidenceRows(project.id);
    const counts = { total: rows.length, ...Object.fromEntries(PROJECT_MANAGER_WORK_ITEM_STATUSES.map(s => [s, 0])) } as
      Record<typeof PROJECT_MANAGER_WORK_ITEM_STATUSES[number] | "total", number>;
    for (const row of rows) counts[row.status]++;
    const goal = pm.getGoal(project.id);
    return { id: project.id, name: project.name, management, counts,
      goal: goal ? { summary: goal.summary, status: goal.status } : null,
      evidenceFreshness: evidenceFreshness(rows, management.freshnessHours, now),
      autonomy: "manual_only" as const };
  }), observedAt: now };
}
