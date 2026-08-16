import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { sessionSnapshots } from "../schema.js";
import type { Database } from "../types.js";

export interface SessionSnapshot {
  id: string;
  userId: string;
  sessionId: string | null;
  projectId: string | null;
  tmuxSession: string | null;
  modelId: string | null;
  configVersion: string | null;
  metadata: string | null;
  createdAt: Date;
}

export interface CreateSessionSnapshotInput {
  sessionId: string;
  projectId: string;
  tmuxSession?: string | null | undefined;
  modelId?: string | null | undefined;
  configVersion?: string | null | undefined;
  metadata?: unknown;
}

export interface ListSessionSnapshotOptions {
  sessionId?: string | undefined;
  projectId?: string | undefined;
}

export class SessionSnapshotRepository {
  private drizzle;

  constructor(db: Database, private readonly userId: string) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateSessionSnapshotInput): SessionSnapshot {
    return this.drizzle
      .insert(sessionSnapshots)
      .values({
        userId: this.userId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        tmuxSession: input.tmuxSession ?? null,
        modelId: input.modelId ?? null,
        configVersion: input.configVersion ?? null,
        metadata: input.metadata === undefined ? null : JSON.stringify(sanitizeMetadata(input.metadata))
      })
      .returning()
      .get() as SessionSnapshot;
  }

  list(options: ListSessionSnapshotOptions = {}): SessionSnapshot[] {
    const filters = [eq(sessionSnapshots.userId, this.userId)];
    if (options.sessionId) {
      filters.push(eq(sessionSnapshots.sessionId, options.sessionId));
    }
    if (options.projectId) {
      filters.push(eq(sessionSnapshots.projectId, options.projectId));
    }
    return this.drizzle
      .select()
      .from(sessionSnapshots)
      .where(and(...filters))
      .orderBy(desc(sessionSnapshots.createdAt))
      .limit(100)
      .all() as SessionSnapshot[];
  }

  getById(id: string): SessionSnapshot | undefined {
    return this.drizzle
      .select()
      .from(sessionSnapshots)
      .where(and(eq(sessionSnapshots.id, id), eq(sessionSnapshots.userId, this.userId)))
      .get() as SessionSnapshot | undefined;
  }
}

function sanitizeMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }
  const copy = { ...(metadata as Record<string, unknown>) };
  delete copy.terminalScrollback;
  delete copy.scrollback;
  delete copy.history;
  return copy;
}
