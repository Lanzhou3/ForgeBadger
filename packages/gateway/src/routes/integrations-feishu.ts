import { Router, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import { FeishuChannelRepository } from "../db/repositories/feishu-channel-repository.js";
import {
  FeishuIntegrationRepository,
  type FeishuUserMapping
} from "../db/repositories/feishu-integration-repository.js";
import type { Database } from "../db/types.js";
import { getFeishuCliStatus, type FeishuCliStatus } from "../services/integrations/feishu-cli.js";

const feishuConfigSchema = z.object({
  enabled: z.boolean().optional(),
  emergencyDisabled: z.boolean().optional(),
  identityMode: z.enum(["user", "bot", "unknown"]).optional(),
  allowedChatIds: z.array(z.string().max(128)).max(50).optional(),
  commandPrefix: z.string().min(2).max(32).regex(/^\/\S+$/).optional()
}).strict();

const feishuAccountSchema = z.object({
  appId: z.string().trim().min(1).max(128),
  appSecret: z.string().min(1).max(512).optional(),
  enabled: z.boolean()
}).strict();

const feishuUserMappingsSchema = z.object({
  mappings: z.array(z.object({
    feishuUserId: z.string().trim().min(1).max(128),
    forgebadgerUserId: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(128).nullable().optional()
  }).strict()).max(100)
}).strict();

export interface FeishuIntegrationRoutesOptions {
  db?: Database;
  masterKey?: string;
  getStatus?: () => Promise<FeishuCliStatus>;
  channelRuntime?: {
    reconcileAccount(userId: string): Promise<void>;
    getHealth(userId: string): unknown;
  };
}

/** Account administration remains available without an inbound work-control handler. */
export function createFeishuIntegrationRoutes(options: FeishuIntegrationRoutesOptions = {}): Router {
  const router = Router();
  const getStatus = options.getStatus ?? (() => getFeishuCliStatus({ env: process.env }));
  router.use(authenticate);

  router.get("/account", (req, res) => {
    const db = requireDb(options.db, res); if (!db) return;
    const userId = userIdFor(req);
    const account = options.masterKey
      ? new FeishuChannelRepository(db, userId, options.masterKey).getAccount()
      : new FeishuIntegrationRepository(db, userId).getAppAccount();
    res.json({ code: 0, data: { account: account ?? null }, message: "" });
  });

  router.put("/account", async (req, res) => {
    const db = requireDb(options.db, res); if (!db || !options.masterKey) return unavailable(res);
    const parsed = feishuAccountSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, "Invalid Feishu App credentials");
    const userId = userIdFor(req);
    try {
      const integrations = new FeishuIntegrationRepository(db, userId, options.masterKey);
      integrations.upsertAppAccount(parsed.data);
      const account = new FeishuChannelRepository(db, userId, options.masterKey).upsertAccount({
        appId: parsed.data.appId,
        enabled: parsed.data.enabled,
        ...(parsed.data.appSecret ? { appSecret: parsed.data.appSecret } : {})
      });
      integrations.upsertConfig({ enabled: parsed.data.enabled, emergencyDisabled: false, identityMode: "bot" });
      await options.channelRuntime?.reconcileAccount(userId);
      new AuditLogRepository(db, userId).create({
        action: "feishu.account.update",
        resourceType: "feishu_integration",
        details: { appId: account.appId, enabled: account.enabled, secretConfigured: true },
        ipAddress: req.ip
      });
      res.json({ code: 0, data: { account }, message: "" });
    } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Failed to save Feishu App credentials");
    }
  });

  router.get("/health", (req, res) => {
    const health = options.channelRuntime?.getHealth(userIdFor(req)) ?? {
      state: "disabled", accountId: null, configRevision: null,
      reconnectAttempt: 0, lastConnectedAt: null, lastErrorMessage: null
    };
    res.json({ code: 0, data: { health }, message: "" });
  });

  router.get("/status", async (req, res) => {
    try {
      const status = await getStatus();
      const config = options.db ? repoFor(options.db, req).getConfig() : undefined;
      res.json({ code: 0, data: { status: config ? {
        ...status,
        enabled: config.enabled,
        emergencyDisabled: config.emergencyDisabled,
        identityMode: config.identityMode === "unknown" ? status.identityMode : config.identityMode
      } : status }, message: "" });
    } catch {
      res.status(500).json({ code: 1, message: "Failed to check Feishu integration status" });
    }
  });

  router.get("/config", (req, res) => {
    const db = requireDb(options.db, res); if (!db) return;
    res.json({ code: 0, data: { config: repoFor(db, req).getConfig() }, message: "" });
  });

  router.patch("/config", (req, res) => {
    const db = requireDb(options.db, res); if (!db) return;
    const parsed = feishuConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, "Invalid Feishu integration config");
    const userId = userIdFor(req);
    try {
      const config = new FeishuIntegrationRepository(db, userId).upsertConfig(parsed.data);
      new AuditLogRepository(db, userId).create({
        action: "feishu.config.update", resourceType: "feishu_integration",
        details: { enabled: config.enabled, emergencyDisabled: config.emergencyDisabled, identityMode: config.identityMode, allowedChatIdCount: config.allowedChatIds.length },
        ipAddress: req.ip
      });
      res.json({ code: 0, data: { config }, message: "" });
    } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid Feishu integration config");
    }
  });

  router.get("/user-mappings", (req, res) => {
    const db = requireDb(options.db, res); if (!db) return;
    res.json({ code: 0, data: { mappings: repoFor(db, req).listUserMappings().map(toMappingPayload) }, message: "" });
  });

  router.put("/user-mappings", (req, res) => {
    const db = requireDb(options.db, res); if (!db) return;
    const parsed = feishuUserMappingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, "Invalid Feishu user mappings");
    const userId = userIdFor(req);
    try {
      const mappings = new FeishuIntegrationRepository(db, userId).replaceUserMappings(parsed.data.mappings);
      new AuditLogRepository(db, userId).create({
        action: "feishu.user_mappings.replace", resourceType: "feishu_integration",
        details: { mappingCount: mappings.length }, ipAddress: req.ip
      });
      res.json({ code: 0, data: { mappings: mappings.map(toMappingPayload) }, message: "" });
    } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid Feishu user mappings");
    }
  });

  router.post("/emergency-stop", async (req, res) => {
    const db = requireDb(options.db, res); if (!db || !options.masterKey) return unavailable(res);
    const userId = userIdFor(req);
    const accountRepository = new FeishuChannelRepository(db, userId, options.masterKey);
    const account = accountRepository.getAccount();
    if (account) accountRepository.upsertAccount({ appId: account.appId, enabled: false });
    new FeishuIntegrationRepository(db, userId, options.masterKey).upsertConfig({ enabled: false, emergencyDisabled: true });
    await options.channelRuntime?.reconcileAccount(userId);
    new AuditLogRepository(db, userId).create({ action: "feishu.channel.emergency_stop", resourceType: "feishu_integration", details: {}, ipAddress: req.ip });
    res.json({ code: 0, data: { stopped: true }, message: "" });
  });

  return router;
}

function requireDb(db: Database | undefined, res: Response): Database | undefined {
  if (!db) unavailable(res);
  return db;
}

function unavailable(res: Response): void {
  res.status(503).json({ code: 1, message: "Feishu integration is unavailable" });
}

function invalid(res: Response, message: string): void {
  res.status(400).json({ code: 1, message });
}

function userIdFor(req: unknown): string {
  return (req as AuthenticatedRequest).userId;
}

function repoFor(db: Database, req: unknown): FeishuIntegrationRepository {
  return new FeishuIntegrationRepository(db, userIdFor(req));
}

function toMappingPayload(mapping: FeishuUserMapping): Record<string, unknown> {
  return {
    feishuUserId: mapping.feishuUserId,
    forgebadgerUserId: mapping.forgebadgerUserId,
    displayName: mapping.displayName
  };
}
