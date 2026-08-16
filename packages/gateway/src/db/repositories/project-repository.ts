import { and, eq } from "drizzle-orm";

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";

import { projects } from "../schema.js";

export interface CreateProjectInput {
  name: string;
  path: string;
  description?: string | undefined;
  techStack?: string | undefined;
  aiTool: string;
  templateId?: string | null | undefined;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  path: string;
  description: string | null;
  techStack: string | null;
  aiTool: string;
  status: string;
  isImported: boolean;
  templateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateProjectInput): Project {
    const result = this.drizzle
      .insert(projects)
      .values({
        userId: this.userId,
        name: input.name,
        path: input.path,
        description: input.description ?? null,
        techStack: input.techStack ?? null,
        aiTool: input.aiTool,
        templateId: input.templateId ?? null
      })
      .returning()
      .get();
    return result as Project;
  }

  import(input: CreateProjectInput): Project {
    const result = this.drizzle
      .insert(projects)
      .values({
        userId: this.userId,
        name: input.name,
        path: input.path,
        description: input.description ?? null,
        techStack: input.techStack ?? null,
        aiTool: input.aiTool,
        templateId: input.templateId ?? null,
        isImported: true
      })
      .returning()
      .get();
    return result as Project;
  }

  list(): Project[] {
    return this.drizzle
      .select()
      .from(projects)
      .where(eq(projects.userId, this.userId))
      .all() as Project[];
  }

  getById(id: string): Project | undefined {
    return this.drizzle
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, this.userId)))
      .get() as Project | undefined;
  }

  updateTemplateId(id: string, templateId: string | null): Project | undefined {
    return this.drizzle
      .update(projects)
      .set({ templateId })
      .where(and(eq(projects.id, id), eq(projects.userId, this.userId)))
      .returning()
      .get() as Project | undefined;
  }

  delete(id: string): void {
    this.drizzle
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, this.userId)))
      .run();
  }
}
