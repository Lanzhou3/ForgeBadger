import { and, eq } from "drizzle-orm";

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";

import { models } from "../schema.js";

export interface CreateModelInput {
  name: string;
  provider: string;
  modelId: string;
  endpoint?: string | undefined;
}

export interface Model {
  id: string;
  userId: string;
  name: string;
  provider: string;
  modelId: string;
  endpoint: string | null;
  status: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export class ModelRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateModelInput): Model {
    const result = this.drizzle
      .insert(models)
      .values({
        userId: this.userId,
        name: input.name,
        provider: input.provider,
        modelId: input.modelId,
        endpoint: input.endpoint ?? null
      })
      .returning()
      .get();
    return result as Model;
  }

  list(): Model[] {
    return this.drizzle
      .select()
      .from(models)
      .where(eq(models.userId, this.userId))
      .all() as Model[];
  }

  getById(id: string): Model | undefined {
    return this.drizzle
      .select()
      .from(models)
      .where(and(eq(models.id, id), eq(models.userId, this.userId)))
      .get() as Model | undefined;
  }

  setDefault(id: string): Model | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    this.drizzle
      .update(models)
      .set({ isDefault: false })
      .where(eq(models.userId, this.userId))
      .run();

    return this.drizzle
      .update(models)
      .set({ isDefault: true })
      .where(and(eq(models.id, id), eq(models.userId, this.userId)))
      .returning()
      .get() as Model | undefined;
  }

  update(id: string, input: { [K in keyof Omit<CreateModelInput, "id">]?: string | undefined }): Model | undefined {
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.provider !== undefined) updateData.provider = input.provider;
    if (input.modelId !== undefined) updateData.modelId = input.modelId;
    if (input.endpoint !== undefined) updateData.endpoint = input.endpoint;

    return this.drizzle
      .update(models)
      .set(updateData)
      .where(and(eq(models.id, id), eq(models.userId, this.userId)))
      .returning()
      .get() as Model | undefined;
  }

  delete(id: string): void {
    this.drizzle
      .delete(models)
      .where(and(eq(models.id, id), eq(models.userId, this.userId)))
      .run();
  }
}
