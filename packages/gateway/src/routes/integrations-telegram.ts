import { Router, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import { TelegramChannelRepository } from "../db/repositories/telegram-channel-repository.js";
import { TelegramIntegrationRepository } from "../db/repositories/telegram-integration-repository.js";
import type { Database } from "../db/types.js";

const telegramConfigSchema = z.object({
  enabled: z.boolean().optional(),
  emergencyDisabled: z.boolean().optional(),
  allowedChatIds: z.array(z.string().max(128)).max(50).optional()
}).strict();

const telegramAccountSchema = z.object({
  botToken: z.string().trim().min(1).max(256).optional(),
  enabled: z.boolean()
}).strict();

export interface TelegramIntegrationRoutesOptions {
  db?: Database;
  masterKey?: string;
  channelRuntime?: {
    reconcileAccount(userId: string): Promise<void>;
    getHealth(userId: string): unknown;
  };
}

export function createTelegramIntegrationRoutes(options: TelegramIntegrationRoutesOptions = {}): Router {
  const router = Router();
  router.use(authenticate);

  router.get("/account", (req, res) => {
    const db = requireDb(options.db, res); if (!db || !options.masterKey) return unavailable(res);
    const account = new TelegramChannelRepository(db, userIdFor(req), options.masterKey).getAccount();
    res.json({ code: 0, data: { account: account ?? null }, message: "" });
  });

  router.put("/account", async (req, res) => {
    const db = requireDb(options.db, res); if (!db || !options.masterKey) return unavailable(res);
    const parsed = telegramAccountSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, "Invalid Telegram bot credentials");
    const userId = userIdFor(req);
    try {
      const account = new TelegramChannelRepository(db, userId, options.masterKey).upsertAccount({
        enabled: parsed.data.enabled,
        ...(parsed.data.botToken ? { botToken: parsed.data.botToken } : {})
      });
      new TelegramIntegrationRepository(db, userId).upsertConfig({ enabled: parsed.data.enabled, emergencyDisabled: false });
      await options.channelRuntime?.reconcileAccount(userId);
      new AuditLogRepository(db, userId).create({
        action: "telegram.account.update",
        resourceType: "telegram_integration",
        details: { botUsername: account.botUsername, enabled: account.enabled, secretConfigured: true },
        ipAddress: req.ip
      });
      res.json({ code: 0, data: { account }, message: "" });
    } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Failed to save Telegram bot credentials");
    }
  });

  router.get("/health", (req, res) => {
    const health = options.channelRuntime?.getHealth(userIdFor(req)) ?? {
      state: "disabled", accountId: null, configRevision: null,
      reconnectAttempt: 0, lastConnectedAt: null, lastErrorMessage: null
    };
    res.json({ code: 0, data: { health }, message: "" });
  });

  router.get("/config", (req, res) => {
    const db = requireDb(options.db, res); if (!db) return;
    res.json({ code: 0, data: { config: new TelegramIntegrationRepository(db, userIdFor(req)).getConfig() }, message: "" });
  });

  router.patch("/config", (req, res) => {
    const db = requireDb(options.db, res); if (!db) return;
    const parsed = telegramConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(res, "Invalid Telegram integration config");
    const userId = userIdFor(req);
    try {
      const config = new TelegramIntegrationRepository(db, userId).upsertConfig(parsed.data);
      new AuditLogRepository(db, userId).create({
        action: "telegram.config.update", resourceType: "telegram_integration",
        details: { enabled: config.enabled, emergencyDisabled: config.emergencyDisabled, allowedChatIdCount: config.allowedChatIds.length },
        ipAddress: req.ip
      });
      res.json({ code: 0, data: { config }, message: "" });
    } catch (error) {
      invalid(res, error instanceof Error ? error.message : "Invalid Telegram integration config");
    }
  });

  router.post("/emergency-stop", async (req, res) => {
    const db = requireDb(options.db, res); if (!db || !options.masterKey) return unavailable(res);
    const userId = userIdFor(req);
    const accountRepository = new TelegramChannelRepository(db, userId, options.masterKey);
    const account = accountRepository.getAccount();
    if (account) accountRepository.upsertAccount({ enabled: false });
    new TelegramIntegrationRepository(db, userId).upsertConfig({ enabled: false, emergencyDisabled: true });
    await options.channelRuntime?.reconcileAccount(userId);
    new AuditLogRepository(db, userId).create({ action: "telegram.channel.emergency_stop", resourceType: "telegram_integration", details: {}, ipAddress: req.ip });
    res.json({ code: 0, data: { stopped: true }, message: "" });
  });

  return router;
}

function requireDb(db: Database | undefined, res: Response): Database | undefined {
  if (!db) unavailable(res);
  return db;
}

function unavailable(res: Response): void {
  res.status(503).json({ code: 1, message: "Telegram integration is unavailable" });
}

function invalid(res: Response, message: string): void {
  res.status(400).json({ code: 1, message });
}

function userIdFor(req: unknown): string {
  return (req as AuthenticatedRequest).userId;
}
