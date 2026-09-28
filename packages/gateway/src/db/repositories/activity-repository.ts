import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { sessionActivities, sessions } from "../schema.js";
import type { Database } from "../types.js";

export interface SessionActivity {
  id: string;
  userId: string;
  sessionId: string | null;
  projectId: string | null;
  type: string;
  status: string;
  message: string;
  metadata: string | null;
  createdAt: Date;
}

export interface CreateActivityInput {
  sessionId?: string | undefined;
  projectId?: string | undefined;
  type: string;
  status?: "info" | "success" | "warning" | "error" | undefined;
  message: string;
  metadata?: unknown;
}

export interface ListActivityOptions {
  sessionId?: string | undefined;
  projectId?: string | undefined;
  types?: string[] | undefined;
  limit?: number | undefined;
}

export class ActivityRepository {
  private readonly drizzle;

  constructor(
    private readonly db: Database,
    private readonly userId: string
  ) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateActivityInput): SessionActivity {
    const result = this.drizzle
      .insert(sessionActivities)
      .values({
        userId: this.userId,
        sessionId: input.sessionId ?? null,
        projectId: input.projectId ?? null,
        type: input.type,
        status: input.status ?? "info",
        message: input.message,
        metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata)
      })
      .returning()
      .get();
    return result as SessionActivity;
  }

  list(options: ListActivityOptions = {}): SessionActivity[] {
    const filters = [eq(sessionActivities.userId, this.userId)];
    if (options.sessionId) {
      filters.push(eq(sessionActivities.sessionId, options.sessionId));
    }
    if (options.projectId) {
      filters.push(eq(sessionActivities.projectId, options.projectId));
    }
    if (options.types && options.types.length > 0) {
      filters.push(inArray(sessionActivities.type, options.types));
    }

    return this.drizzle
      .select()
      .from(sessionActivities)
      .where(and(...filters))
      .orderBy(desc(sessionActivities.createdAt))
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 200))
      .all() as SessionActivity[];
  }
}
