import { and, eq, or } from "drizzle-orm";

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";

import { skills, users } from "../schema.js";

export interface CreateSkillInput {
  name: string;
  description?: string | undefined;
  source?: string | undefined;
  content: string;
  version?: string | undefined;
  visibility?: "private" | "shared" | "admin" | undefined;
  isEnabled?: boolean | undefined;
}

export interface UpdateSkillInput {
  name?: string | undefined;
  description?: string | undefined;
  source?: string | undefined;
  content?: string | undefined;
  version?: string | undefined;
  visibility?: "private" | "shared" | "admin" | undefined;
}

export interface Skill {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  source: string;
  content: string;
  version: string;
  visibility: string;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class SkillRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateSkillInput): Skill {
    const result = this.drizzle
      .insert(skills)
      .values({
        userId: this.userId,
        name: input.name,
        description: input.description ?? null,
        source: input.source ?? "local",
        content: input.content,
        version: input.version ?? "1.0.0",
        visibility: input.visibility ?? "private",
        isEnabled: input.isEnabled ?? true
      })
      .returning()
      .get();
    return result as Skill;
  }

  createIfMissing(input: CreateSkillInput): Skill {
    const existing = this.getByName(input.name);
    if (existing) return existing;
    return this.create(input);
  }

  list(): Skill[] {
    const sharedVisibility = this.readableVisibility();
    return this.drizzle
      .select()
      .from(skills)
      .where(sharedVisibility)
      .all() as Skill[];
  }

  getById(id: string): Skill | undefined {
    const sharedVisibility = this.readableVisibility();
    return this.drizzle
      .select()
      .from(skills)
      .where(
        and(
          eq(skills.id, id),
          sharedVisibility
        )
      )
      .get() as Skill | undefined;
  }

  getByName(name: string): Skill | undefined {
    return this.drizzle
      .select()
      .from(skills)
      .where(and(eq(skills.name, name), eq(skills.userId, this.userId)))
      .get() as Skill | undefined;
  }

  update(id: string, input: UpdateSkillInput): Skill | undefined {
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.source !== undefined) updateData.source = input.source;
    if (input.content !== undefined) updateData.content = input.content;
    if (input.version !== undefined) updateData.version = input.version;
    if (input.visibility !== undefined) updateData.visibility = input.visibility;

    return this.drizzle
      .update(skills)
      .set(updateData)
      .where(and(eq(skills.id, id), eq(skills.userId, this.userId)))
      .returning()
      .get() as Skill | undefined;
  }

  toggle(id: string, enabled: boolean): Skill | undefined {
    return this.drizzle
      .update(skills)
      .set({ isEnabled: enabled })
      .where(and(eq(skills.id, id), eq(skills.userId, this.userId)))
      .returning()
      .get() as Skill | undefined;
  }

  delete(id: string): void {
    this.drizzle
      .delete(skills)
      .where(and(eq(skills.id, id), eq(skills.userId, this.userId)))
      .run();
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
