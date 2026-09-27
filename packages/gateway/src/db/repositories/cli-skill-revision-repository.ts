import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { cliSkillRevisions } from "../schema.js";
import type { Database } from "../types.js";

export type CliSkillRevision = typeof cliSkillRevisions.$inferSelect;
export class CliSkillRevisionRepository {
  private readonly query;
  constructor(
    db: Database,
    private readonly userId: string,
  ) {
    this.query = drizzle(db);
  }
  list(skillId: string): CliSkillRevision[] {
    return this.query
      .select()
      .from(cliSkillRevisions)
      .where(
        and(
          eq(cliSkillRevisions.userId, this.userId),
          eq(cliSkillRevisions.skillId, skillId),
        ),
      )
      .orderBy(desc(cliSkillRevisions.createdAt), desc(cliSkillRevisions.id))
      .limit(20)
      .all();
  }
  get(skillId: string, id: string): CliSkillRevision | undefined {
    return this.query
      .select()
      .from(cliSkillRevisions)
      .where(
        and(
          eq(cliSkillRevisions.userId, this.userId),
          eq(cliSkillRevisions.skillId, skillId),
          eq(cliSkillRevisions.id, id),
        ),
      )
      .get();
  }
  create(
    skillId: string,
    action: "install" | "update" | "rollback" | "legacy",
    snapshot: unknown,
    packageHash: string,
  ): CliSkillRevision {
    const newest = this.list(skillId)[0]?.createdAt ?? 0;
    const revision = this.query
      .insert(cliSkillRevisions)
      .values({
        userId: this.userId,
        skillId,
        action,
        snapshotJson: JSON.stringify(snapshot),
        packageHash,
        createdAt: Math.max(Date.now(), newest + 1),
      })
      .returning()
      .get();
    const obsolete = this.query
      .select({ id: cliSkillRevisions.id })
      .from(cliSkillRevisions)
      .where(
        and(
          eq(cliSkillRevisions.userId, this.userId),
          eq(cliSkillRevisions.skillId, skillId),
        ),
      )
      .orderBy(desc(cliSkillRevisions.createdAt), desc(cliSkillRevisions.id))
      .limit(100)
      .offset(20)
      .all();
    for (const row of obsolete)
      this.query
        .delete(cliSkillRevisions)
        .where(
          and(
            eq(cliSkillRevisions.userId, this.userId),
            eq(cliSkillRevisions.id, row.id),
          ),
        )
        .run();
    return revision;
  }
}
