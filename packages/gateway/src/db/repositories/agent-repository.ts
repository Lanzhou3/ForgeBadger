import { and, eq } from "drizzle-orm";

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";

import { agents, models, projects } from "../schema.js";

export interface CreateAgentInput {
  projectId?: string | undefined;
  name: string;
  description?: string | undefined;
  modelId?: string | undefined;
  tools?: string | undefined;
  allowedDirs?: string | undefined;
  customPrompt?: string | undefined;
}

export interface UpdateAgentInput {
  projectId?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  modelId?: string | undefined;
  tools?: string | undefined;
  allowedDirs?: string | undefined;
  customPrompt?: string | undefined;
  status?: string | undefined;
}

export interface Agent {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  modelId: string | null;
  tools: string | null;
  allowedDirs: string | null;
  customPrompt: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export class AgentRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

	  create(input: CreateAgentInput): Agent {
	    this.assertOwnedReferences(input);
	    const result = this.drizzle
      .insert(agents)
      .values({
        userId: this.userId,
        projectId: input.projectId ?? null,
        name: input.name,
        description: input.description ?? null,
        modelId: input.modelId ?? null,
        tools: input.tools ?? null,
        allowedDirs: input.allowedDirs ?? null,
        customPrompt: input.customPrompt ?? null
      })
      .returning()
      .get();
    return result as Agent;
  }

  list(): Agent[] {
    return this.drizzle
      .select()
      .from(agents)
      .where(eq(agents.userId, this.userId))
      .all() as Agent[];
  }

  getById(id: string): Agent | undefined {
    return this.drizzle
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.userId, this.userId)))
      .get() as Agent | undefined;
  }

	  update(id: string, input: UpdateAgentInput): Agent | undefined {
	    this.assertOwnedReferences(input);
	    const updateData: Record<string, unknown> = {};
    if (input.projectId !== undefined) updateData.projectId = input.projectId;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.modelId !== undefined) updateData.modelId = input.modelId;
    if (input.tools !== undefined) updateData.tools = input.tools;
    if (input.allowedDirs !== undefined) updateData.allowedDirs = input.allowedDirs;
    if (input.customPrompt !== undefined) updateData.customPrompt = input.customPrompt;
    if (input.status !== undefined) updateData.status = input.status;

    return this.drizzle
      .update(agents)
      .set(updateData)
      .where(and(eq(agents.id, id), eq(agents.userId, this.userId)))
      .returning()
      .get() as Agent | undefined;
  }

	  delete(id: string): void {
    this.drizzle
      .delete(agents)
      .where(and(eq(agents.id, id), eq(agents.userId, this.userId)))
	      .run();
	  }

	  private assertOwnedReferences(input: { projectId?: string | undefined; modelId?: string | undefined }): void {
	    if (input.projectId !== undefined) {
	      const project = this.drizzle
	        .select({ id: projects.id })
	        .from(projects)
	        .where(and(eq(projects.id, input.projectId), eq(projects.userId, this.userId)))
	        .get();
	      if (!project) {
	        throw new Error("Project not found");
	      }
	    }

	    if (input.modelId !== undefined) {
	      const model = this.drizzle
	        .select({ id: models.id })
	        .from(models)
	        .where(and(eq(models.id, input.modelId), eq(models.userId, this.userId)))
	        .get();
	      if (!model) {
	        throw new Error("Model not found");
	      }
	    }
	  }
	}
