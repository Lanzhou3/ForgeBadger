import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";

import { models } from "../schema.js";
import { ModelProviderRepository, toLegacyModel } from "./model-provider-repository.js";

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
  private providerRepo;

  constructor(private db: Database, private userId: string) {
    this.drizzle = drizzle(db);
    this.providerRepo = new ModelProviderRepository(db, userId, "");
  }

  create(input: CreateModelInput): Model {
    const id = randomUUID();
    const provider = this.providerRepo.ensureProviderProfile({
      name: input.provider,
      providerKey: input.provider,
      baseUrl: input.endpoint ?? null,
      authType: "api_key",
      apiFormat: input.provider.trim().toLowerCase() === "anthropic" ? "anthropic" : "openai-compatible",
      supportedAdapters: input.provider.trim().toLowerCase() === "anthropic" ? ["claude"] : ["opencode"]
    });
    this.providerRepo.createModelProfile({
      id,
      providerProfileId: provider.id,
      name: input.name,
      modelId: input.modelId,
      capabilities: ["chat", "code"],
      mirrorLegacy: false
    });
    const result = this.drizzle
      .insert(models)
      .values({
        id,
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
    const profiles = this.providerRepo.listModelProfiles();
    if (profiles.length > 0) {
      return profiles.map(toLegacyModel) as unknown as Model[];
    }
    return this.drizzle
      .select()
      .from(models)
      .where(eq(models.userId, this.userId))
      .all() as Model[];
  }

  getById(id: string): Model | undefined {
    const profile = this.providerRepo.getModelProfile(id);
    if (profile) return toLegacyModel(profile) as unknown as Model;
    return this.drizzle
      .select()
      .from(models)
      .where(and(eq(models.id, id), eq(models.userId, this.userId)))
      .get() as Model | undefined;
  }

  setDefault(id: string): Model | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const providerModel = this.providerRepo.setDefaultModel(id);
    this.drizzle
      .update(models)
      .set({ isDefault: false })
      .where(eq(models.userId, this.userId))
      .run();

    const legacyModel = this.drizzle
      .update(models)
      .set({ isDefault: true })
      .where(and(eq(models.id, id), eq(models.userId, this.userId)))
      .returning()
      .get() as Model | undefined;
    return legacyModel ?? (providerModel ? toLegacyModel(providerModel) as unknown as Model : undefined);
  }

  update(id: string, input: { [K in keyof Omit<CreateModelInput, "id">]?: string | undefined }): Model | undefined {
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.provider !== undefined) updateData.provider = input.provider;
    if (input.modelId !== undefined) updateData.modelId = input.modelId;
    if (input.endpoint !== undefined) updateData.endpoint = input.endpoint;

    const updated = this.drizzle
      .update(models)
      .set(updateData)
      .where(and(eq(models.id, id), eq(models.userId, this.userId)))
      .returning()
      .get() as Model | undefined;
    if (!updated) return undefined;

    const existingProfile = this.providerRepo.getModelProfile(id);
    if (existingProfile) {
      const provider = this.providerRepo.ensureProviderProfile({
        name: updated.provider,
        providerKey: updated.provider,
        baseUrl: updated.endpoint,
        authType: "api_key",
        apiFormat: updated.provider.trim().toLowerCase() === "anthropic" ? "anthropic" : "openai-compatible",
        supportedAdapters: updated.provider.trim().toLowerCase() === "anthropic" ? ["claude"] : ["opencode"]
      });
      this.updateProfileMirror(id, provider.id, updated);
    }
    return this.getById(id);
  }

  delete(id: string): void {
    const profile = this.providerRepo.getModelProfile(id);
    if (profile) {
      this.drizzle
        .delete(models)
        .where(and(eq(models.id, id), eq(models.userId, this.userId)))
        .run();
      this.deleteProfile(id);
      return;
    }
    this.drizzle
      .delete(models)
      .where(and(eq(models.id, id), eq(models.userId, this.userId)))
      .run();
  }

  private updateProfileMirror(id: string, providerProfileId: string, model: Model): void {
    this.db.prepare(`
      UPDATE model_profiles
      SET provider_profile_id = ?, name = ?, model_id = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(providerProfileId, model.name, model.modelId, Date.now(), id, this.userId);
  }

  private deleteProfile(id: string): void {
    this.db.prepare(`
      DELETE FROM model_profiles WHERE id = ? AND user_id = ?
    `).run(id, this.userId);
  }
}
