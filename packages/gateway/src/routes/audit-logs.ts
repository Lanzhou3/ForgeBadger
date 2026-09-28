import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AuditLogRepository, type AuditLog } from "../db/repositories/audit-log-repository.js";
import type { Database } from "../db/types.js";

const listAuditLogsSchema = z.object({
  action: z.string().min(1).optional(),
  resourceType: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export function createAuditLogRoutes(db: Database): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/", (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const parseResult = listAuditLogsSchema.safeParse(req.query ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid input" });
      return;
    }

    const auditLogs = new AuditLogRepository(db, userId)
      .list(parseResult.data)
      .map(toAuditLogPayload);
    res.json({
      code: 0,
      data: { auditLogs },
      message: ""
    });
  });

  return router;
}

function toAuditLogPayload(auditLog: AuditLog) {
  return {
    id: auditLog.id,
    action: auditLog.action,
    resourceType: auditLog.resourceType,
    resourceId: auditLog.resourceId,
    details: sanitizeAuditDetails(auditLog.resourceType, parseJson(auditLog.details)),
    ipAddress: auditLog.ipAddress,
    createdAt: auditLog.createdAt.toISOString()
  };
}

function sanitizeAuditDetails(resourceType: string, details: unknown): unknown {
  if (resourceType !== "template_version" || !isRecord(details)) {
    return details;
  }

  const files = Array.isArray(details.files) ? details.files : [];
  return {
    name: typeof details.name === "string" ? details.name : undefined,
    description: typeof details.description === "string" ? details.description : undefined,
    version: typeof details.version === "string" ? details.version : undefined,
    exportedAt: typeof details.exportedAt === "string" ? details.exportedAt : undefined,
    fileCount: files.length,
    files: files.flatMap((file) => {
      if (!isRecord(file) || typeof file.filePath !== "string") return [];
      return [file.filePath];
    })
  };
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
