import { and, desc, eq, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { auditLogs } from "../schema.js";
import type { Database } from "../types.js";

export interface AuditLog {
  id: number;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  action: string;
  resourceType: string;
  resourceId?: string | null | undefined;
  details?: unknown;
  ipAddress?: string | null | undefined;
}

export interface ListAuditLogOptions {
  action?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  limit?: number | undefined;
}

export class AuditLogRepository {
  private drizzle;

  constructor(db: Database, private userId: string) {
    this.drizzle = drizzle(db);
  }

  create(input: CreateAuditLogInput): AuditLog {
    return this.drizzle
      .insert(auditLogs)
      .values({
        userId: this.userId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        details: input.details === undefined ? null : JSON.stringify(input.details),
        ipAddress: input.ipAddress ?? null
      })
      .returning()
      .get() as AuditLog;
  }

  list(options: ListAuditLogOptions = {}): AuditLog[] {
    const filters: SQL[] = [eq(auditLogs.userId, this.userId)];
    if (options.action) filters.push(eq(auditLogs.action, options.action));
    if (options.resourceType) filters.push(eq(auditLogs.resourceType, options.resourceType));
    if (options.resourceId) filters.push(eq(auditLogs.resourceId, options.resourceId));

    return this.drizzle
      .select()
      .from(auditLogs)
      .where(and(...filters))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(clampLimit(options.limit))
      .all() as AuditLog[];
  }
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  return Math.min(200, Math.max(1, value));
}
