import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import {
  FeishuIntegrationRepository,
  type FeishuIntegrationConfig,
  type FeishuUserMapping
} from "../db/repositories/feishu-integration-repository.js";
import type { Database } from "../db/types.js";
import {
  getFeishuCliStatus,
  type FeishuCliStatus
} from "../services/integrations/feishu-cli.js";

const feishuConfigSchema = z.object({
  enabled: z.boolean().optional(),
  emergencyDisabled: z.boolean().optional(),
  identityMode: z.enum(["user", "bot", "unknown"]).optional(),
  allowedChatIds: z.array(z.string().max(128)).max(50).optional(),
  commandPrefix: z.string().min(2).max(32).regex(/^\/\S+$/).optional()
}).strict();

const feishuUserMappingsSchema = z.object({
  mappings: z.array(z.object({
    feishuUserId: z.string().trim().min(1).max(128),
    openforgeUserId: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(128).nullable().optional()
  }).strict()).max(100)
}).strict();

export interface FeishuIntegrationRoutesOptions {
  db?: Database;
  getStatus?: () => Promise<FeishuCliStatus>;
}

export function createFeishuIntegrationRoutes(
  options: FeishuIntegrationRoutesOptions = {}
): Router {
  const router = Router();
  const getStatus = options.getStatus ?? (() => getFeishuCliStatus({ env: process.env }));

  router.use(authenticate);

  router.get("/status", async (req, res) => {
    try {
      const status = await getStatus();
      const config = options.db ? repoFor(options.db, req).getConfig() : undefined;
      res.json({
        code: 0,
        data: {
          status: config
            ? {
                ...status,
                enabled: config.enabled,
                emergencyDisabled: config.emergencyDisabled,
                identityMode: config.identityMode === "unknown" ? status.identityMode : config.identityMode
              }
            : status
        },
        message: ""
      });
    } catch {
      res.status(500).json({
        code: 1,
        message: "Failed to check Feishu integration status"
      });
    }
  });

  router.get("/config", (req, res) => {
    const repo = requireRepo(options.db, res);
    if (!repo) return;

    res.json({
      code: 0,
      data: { config: toConfigPayload(repoFor(repo, req).getConfig()) },
      message: ""
    });
  });

  router.patch("/config", (req, res) => {
    const db = requireRepo(options.db, res);
    if (!db) return;
    const parseResult = feishuConfigSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid Feishu integration config" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const config = new FeishuIntegrationRepository(db, userId).upsertConfig(parseResult.data);
      new AuditLogRepository(db, userId).create({
        action: "feishu.config.update",
        resourceType: "feishu_integration",
        details: {
          enabled: config.enabled,
          emergencyDisabled: config.emergencyDisabled,
          identityMode: config.identityMode,
          allowedChatIdCount: config.allowedChatIds.length,
          commandPrefix: config.commandPrefix
        },
        ipAddress: req.ip
      });
      res.json({ code: 0, data: { config: toConfigPayload(config) }, message: "" });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Invalid Feishu integration config"
      });
    }
  });

  router.get("/user-mappings", (req, res) => {
    const db = requireRepo(options.db, res);
    if (!db) return;

    res.json({
      code: 0,
      data: { mappings: repoFor(db, req).listUserMappings().map(toMappingPayload) },
      message: ""
    });
  });

  router.put("/user-mappings", (req, res) => {
    const db = requireRepo(options.db, res);
    if (!db) return;
    const parseResult = feishuUserMappingsSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({ code: 1, message: "Invalid Feishu user mappings" });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    try {
      const mappings = new FeishuIntegrationRepository(db, userId)
        .replaceUserMappings(parseResult.data.mappings);
      new AuditLogRepository(db, userId).create({
        action: "feishu.user_mappings.replace",
        resourceType: "feishu_integration",
        details: { mappingCount: mappings.length },
        ipAddress: req.ip
      });
      res.json({ code: 0, data: { mappings: mappings.map(toMappingPayload) }, message: "" });
    } catch (error) {
      res.status(400).json({
        code: 1,
        message: error instanceof Error ? error.message : "Invalid Feishu user mappings"
      });
    }
  });

  return router;
}

function repoFor(db: Database, req: unknown): FeishuIntegrationRepository {
  return new FeishuIntegrationRepository(db, (req as AuthenticatedRequest).userId);
}

function requireRepo(db: Database | undefined, res: { status: (code: number) => { json: (body: unknown) => void } }): Database | undefined {
  if (db) return db;
  res.status(503).json({ code: 1, message: "Feishu integration persistence is unavailable" });
  return undefined;
}

function toConfigPayload(config: FeishuIntegrationConfig): FeishuIntegrationConfig {
  return config;
}

function toMappingPayload(mapping: FeishuUserMapping) {
  return {
    id: mapping.id,
    feishuUserId: mapping.feishuUserId,
    openforgeUserId: mapping.openforgeUserId,
    displayName: mapping.displayName,
    createdAt: new Date(mapping.createdAt).toISOString(),
    updatedAt: new Date(mapping.updatedAt).toISOString()
  };
}
