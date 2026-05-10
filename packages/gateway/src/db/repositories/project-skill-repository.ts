import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";
import { projectSkills, skills, users } from "../schema.js";

export interface ProjectSkill {
  skillId: string;
  name: string;
  description: string | null;
  source: string;
  content: string;
  version: string;
  isEnabled: boolean;
  selectionState: "inherited_enabled" | "inherited_disabled" | "project_enabled" | "project_disabled";
}

export class ProjectSkillRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  listByProject(projectId: string): ProjectSkill[] {
    const readableVisibility = this.readableVisibility();
    const rows = this.drizzle
      .select({
        skillId: skills.id,
        name: skills.name,
        description: skills.description,
        source: skills.source,
        content: skills.content,
        version: skills.version,
        globalEnabled: skills.isEnabled,
        projectEnabled: projectSkills.isEnabled
      })
      .from(skills)
      .leftJoin(
        projectSkills,
        and(eq(projectSkills.skillId, skills.id), eq(projectSkills.projectId, projectId))
      )
      .where(readableVisibility)
      .all() as Array<{
        skillId: string;
        name: string;
        description: string | null;
        source: string;
        content: string;
        version: string;
        globalEnabled: boolean;
        projectEnabled: boolean | null;
      }>;

    return rows.map((row) => {
      const inherited = row.projectEnabled === null;
      const isEnabled = inherited ? row.globalEnabled : row.projectEnabled === true;
      return {
        skillId: row.skillId,
        name: row.name,
        description: row.description,
        source: row.source,
        content: row.content,
        version: row.version,
        isEnabled,
        selectionState: inherited
          ? (isEnabled ? "inherited_enabled" : "inherited_disabled")
          : (isEnabled ? "project_enabled" : "project_disabled")
      };
    });
  }

  setSkill(projectId: string, skillId: string, enabled: boolean): { projectId: string; skillId: string; isEnabled: boolean } | undefined {
    const existing = this.drizzle
      .select()
      .from(projectSkills)
      .where(and(eq(projectSkills.projectId, projectId), eq(projectSkills.skillId, skillId)))
      .get();

    if (existing) {
      return this.drizzle
        .update(projectSkills)
        .set({ isEnabled: enabled })
        .where(and(eq(projectSkills.projectId, projectId), eq(projectSkills.skillId, skillId)))
        .returning()
        .get() as { projectId: string; skillId: string; isEnabled: boolean } | undefined;
    }

    return this.drizzle
      .insert(projectSkills)
      .values({ projectId, skillId, isEnabled: enabled })
      .returning()
      .get() as { projectId: string; skillId: string; isEnabled: boolean } | undefined;
  }

  private readableVisibility() {
    const base = [eq(skills.userId, this.userId), eq(skills.visibility, "shared")];
    if (this.isAdminUser()) {
      base.push(eq(skills.visibility, "admin"));
    }
    return or(...base);
  }

  private isAdminUser(): boolean {
    const user = this.drizzle
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, this.userId))
      .get() as { role: string } | undefined;
    return user?.role === "admin";
  }
}
