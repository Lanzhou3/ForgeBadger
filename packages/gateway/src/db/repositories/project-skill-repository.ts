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
}

export class ProjectSkillRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  listByProject(projectId: string): ProjectSkill[] {
    const readableVisibility = this.readableVisibility();
    return this.drizzle
      .select({
        skillId: skills.id,
        name: skills.name,
        description: skills.description,
        source: skills.source,
        content: skills.content,
        version: skills.version,
        isEnabled: projectSkills.isEnabled
      })
      .from(projectSkills)
      .innerJoin(skills, eq(projectSkills.skillId, skills.id))
      .where(and(eq(projectSkills.projectId, projectId), readableVisibility))
      .all() as ProjectSkill[];
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
