import { and, eq } from "drizzle-orm";

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database } from "../types.js";

import { sessions } from "../schema.js";

export interface CreateSessionInput {
  projectId: string;
  name: string;
  aiTool: string;
  modelId?: string;
  agentId?: string;
  workingDir: string;
  attachToken?: string;
  tmuxSession?: string;
  credentialMode?: SessionCredentialMode;
  apiKeyId?: string;
}

export type SessionCredentialMode = "host_environment" | "stored_encrypted_key";

export interface Session {
  id: string;
  userId: string;
  projectId: string;
  name: string;
  aiTool: string;
  modelId: string | null;
  agentId: string | null;
  status: string;
  attachToken: string;
  tmuxSession: string | null;
  workingDir: string;
  credentialMode: SessionCredentialMode;
  apiKeyId: string | null;
  lastActive: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateSessionInput): Session {
    const result = this.drizzle
      .insert(sessions)
      .values({
        userId: this.userId,
        projectId: input.projectId,
        name: input.name,
        aiTool: input.aiTool,
        modelId: input.modelId ?? null,
        agentId: input.agentId ?? null,
        attachToken: input.attachToken ?? "",
        workingDir: input.workingDir,
        tmuxSession: input.tmuxSession ?? null,
        credentialMode: input.credentialMode ?? "host_environment",
        apiKeyId: input.apiKeyId ?? null
      })
      .returning()
      .get();
    return result as Session;
  }

  list(): Session[] {
    return this.drizzle
      .select()
      .from(sessions)
      .where(eq(sessions.userId, this.userId))
      .all() as Session[];
  }

  listByProject(projectId: string): Session[] {
    return this.drizzle
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, this.userId), eq(sessions.projectId, projectId)))
      .all() as Session[];
  }

  getById(id: string): Session | undefined {
    return this.drizzle
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, this.userId)))
      .get() as Session | undefined;
  }

  updateStatus(id: string, status: string): Session | undefined {
    return this.drizzle
      .update(sessions)
      .set({ status })
      .where(and(eq(sessions.id, id), eq(sessions.userId, this.userId)))
      .returning()
      .get() as Session | undefined;
  }

  update(id: string, input: Partial<{
    modelId: string | null;
    agentId: string | null;
    name: string;
    status: string;
    attachToken: string;
    tmuxSession: string | null;
    credentialMode: SessionCredentialMode;
    apiKeyId: string | null;
    lastActive: Date | null;
    errorMessage: string | null;
  }>): Session | undefined {
    const updateData: Record<string, unknown> = {};
    if (input.modelId !== undefined) updateData.modelId = input.modelId;
    if (input.agentId !== undefined) updateData.agentId = input.agentId;
    if (input.name !== undefined) updateData.name = input.name;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.attachToken !== undefined) updateData.attachToken = input.attachToken;
    if (input.tmuxSession !== undefined) updateData.tmuxSession = input.tmuxSession;
    if (input.credentialMode !== undefined) updateData.credentialMode = input.credentialMode;
    if (input.apiKeyId !== undefined) updateData.apiKeyId = input.apiKeyId;
    if (input.lastActive !== undefined) updateData.lastActive = input.lastActive;
    if (input.errorMessage !== undefined) updateData.errorMessage = input.errorMessage;

    return this.drizzle
      .update(sessions)
      .set(updateData)
      .where(and(eq(sessions.id, id), eq(sessions.userId, this.userId)))
      .returning()
      .get() as Session | undefined;
  }

  delete(id: string): void {
    this.drizzle
      .delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, this.userId)))
      .run();
  }

  upsert(record: Session): Session {
    const existing = this.drizzle
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, record.id), eq(sessions.userId, this.userId)))
      .get();

    if (existing) {
      return this.drizzle
        .update(sessions)
        .set({
          projectId: record.projectId,
          name: record.name,
          aiTool: record.aiTool,
          modelId: record.modelId ?? null,
          agentId: record.agentId ?? null,
          status: record.status,
          attachToken: record.attachToken,
          tmuxSession: record.tmuxSession ?? null,
          workingDir: record.workingDir,
          credentialMode: record.credentialMode,
          apiKeyId: record.apiKeyId ?? null,
          lastActive: record.lastActive ?? null,
          errorMessage: record.errorMessage ?? null,
          updatedAt: record.updatedAt
        })
        .where(and(eq(sessions.id, record.id), eq(sessions.userId, this.userId)))
        .returning()
        .get() as Session;
    }

    return this.drizzle
      .insert(sessions)
      .values({
        id: record.id,
        userId: this.userId,
        projectId: record.projectId,
        name: record.name,
        aiTool: record.aiTool,
        modelId: record.modelId ?? null,
        agentId: record.agentId ?? null,
        status: record.status,
        attachToken: record.attachToken,
        tmuxSession: record.tmuxSession ?? null,
        workingDir: record.workingDir,
        credentialMode: record.credentialMode,
        apiKeyId: record.apiKeyId ?? null,
        lastActive: record.lastActive ?? null,
        errorMessage: record.errorMessage ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      })
      .returning()
      .get() as Session;
  }
}
