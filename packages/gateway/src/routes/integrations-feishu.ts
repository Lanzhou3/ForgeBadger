import { createHash, timingSafeEqual } from "node:crypto";

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import { FeishuChannelRepository } from "../db/repositories/feishu-channel-repository.js";
import { PortfolioFeishuRegistryRepository } from "../db/repositories/portfolio-feishu-registry-repository.js";
import {
  FeishuIntegrationRepository,
  type FeishuIntegrationConfig,
  type FeishuPublicWebhookConfig,
  type FeishuUserMapping
} from "../db/repositories/feishu-integration-repository.js";
import type { Database } from "../db/types.js";
import { getFeishuCliStatus, type FeishuCliStatus } from "../services/integrations/feishu-cli.js";
import {
  createPortfolioIngressSelector,
  routeVerifiedFeishuIngress,
  sendFeishuChatCard,
  sendFeishuChatText,
  updateFeishuChatCard
} from "../services/integrations/feishu-runtime-factory.js";
import { createFeishuCopilotChannel } from "../services/integrations/feishu-copilot-channel.js";
import { FeishuSdkFactory } from "../services/integrations/feishu-sdk.js";
import { buildAgentStack, type AgentStackDeps } from "../services/agent/agent-stack.js";
import { renderFeishuCardActionAcceptedResponse } from "../services/integrations/feishu-card-renderer.js";

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
const publicWebhookReplayTtlMs = 5 * 60 * 1000;
const publicWebhookTimestampWindowSeconds = 5 * 60;

/** Lazily-shared SDK factory for webhook-originated Copilot replies. */
let sharedWebhookSdkFactory: FeishuSdkFactory | undefined;
function webhookSdkFactory(): FeishuSdkFactory {
  sharedWebhookSdkFactory ??= new FeishuSdkFactory();
  return sharedWebhookSdkFactory;
}

export interface FeishuIntegrationRoutesOptions {
  db?: Database;
  masterKey?: string;
  getStatus?: () => Promise<FeishuCliStatus>;
  publicWebhookRateLimit?: { max: number; windowMs: number };
  channelRuntime?: {
    reconcileAccount(userId: string): Promise<void>;
    getHealth(userId: string): unknown;
  };
  /** Copilot harness deps for unbound-chat routing; absent disables the Copilot channel. */
  resolveAgentDeps?: () => AgentStackDeps | undefined;
  /** External Feishu SDK boundary; production uses the shared lazy factory. */
  sdkFactory?: FeishuSdkFactory;
}

/** Feishu exposes only account control and one verified Portfolio ingress path. */
export function createFeishuIntegrationRoutes(options: FeishuIntegrationRoutesOptions = {}): Router {
  const router = Router();
  const getStatus = options.getStatus ?? (() => getFeishuCliStatus({ env: process.env }));
  const publicWebhookRateLimit = options.publicWebhookRateLimit ?? { max: 20, windowMs: 60_000 };

  router.post("/webhook/:publicId", (req, res) => {
    const db = options.db;
    if (!db || !options.masterKey) return sendPublicWebhookError(res, 503, "feishu_webhook_unavailable");
    const config = findPublicWebhookConfig(db, options.masterKey, req.params.publicId, res);
    if (!config) return;
    const body = req.body ?? {};
    if (isFeishuUrlVerification(body)) {
      if (getFeishuBodyToken(body) !== config.verificationToken) return sendPublicWebhookError(res, 401, "feishu_webhook_token_invalid");
      res.status(200).json({ challenge: getFeishuChallenge(body) });
      return;
    }
    const signature = verifyFeishuPublicSignature(req, getRawRequestBody(req), config.eventEncryptKey);
    if (!signature.ok) return sendPublicWebhookError(res, 401, signature.code);
    if (hasEncryptedFeishuPayload(body)) return sendPublicWebhookError(res, 400, "feishu_webhook_encrypted_payload_unsupported");
    if (getFeishuBodyToken(body) !== config.verificationToken) return sendPublicWebhookError(res, 401, "feishu_webhook_token_invalid");
    const normalized = normalizePublicFeishuIngress(body);
    if (!normalized) return res.status(200).json({ msg: "ignored" });
    const masterKey = options.masterKey;

    const integration = new FeishuIntegrationRepository(db, config.userId, options.masterKey);
    const mapping = authorizePublicWebhookActor(integration, config, normalized);
    if (!mapping) {
      return sendPublicWebhookPolicyReject(
        db,
        config.userId,
        req.ip,
        res,
        normalized,
        "feishu_webhook_policy_rejected"
      );
    }
    const account = new FeishuChannelRepository(db, config.userId, options.masterKey).getAccount();
    if (!account?.enabled) {
      return sendPublicWebhookPolicyReject(
        db,
        config.userId,
        req.ip,
        res,
        normalized,
        "feishu_channel_unavailable"
      );
    }
    if (!consumePublicReplayAndRate(
      integration,
      config,
      normalized,
      mapping,
      signature,
      publicWebhookRateLimit
    )) {
      return res.status(200).json({ msg: "replayed" });
    }
    try {
      const registry = new PortfolioFeishuRegistryRepository(db);
      ensurePortfolioHandler(registry, config.userId, account.appId);
      const event = {
        provider: "feishu" as const,
        providerAccountId: account.appId,
        providerEventId: normalized.eventId ?? `${normalized.kind}:${normalized.messageId ?? "unknown"}`,
        transport: "webhook" as const,
        signatureVerified: true,
        externalIdentity: normalized.feishuUserId,
        conversationId: normalized.chatId,
        eventType: normalized.kind,
        safeEventMetadata: { source: "webhook", eventType: normalized.kind }
      };
      const agentDeps = options.resolveAgentDeps?.();
      const providerAccount = registry.resolve("feishu", account.appId);
      const sdkFactory = options.sdkFactory ?? webhookSdkFactory();
      const copilotChannel = agentDeps && providerAccount
        ? createFeishuCopilotChannel({
            deps: agentDeps,
            buildAgentStack,
            sendMessage: ({ chatId, text }) => sendFeishuChatText({
              db,
              masterKey,
              sdkFactory,
              userId: config.userId,
              chatId,
              text
            }),
            cardTransport: {
              sendCard: (chatId, card) => sendFeishuChatCard({
                db,
                masterKey,
                sdkFactory,
                userId: config.userId,
                chatId,
                card
              }),
              updateCard: (messageId, card) => updateFeishuChatCard({
                db,
                masterKey,
                sdkFactory,
                userId: config.userId,
                messageId,
                card
              })
            },
            userId: config.userId,
            providerAccountId: providerAccount.id,
            transport: "webhook"
          })
        : undefined;
      const routed = routeVerifiedFeishuIngress({
        db,
        masterKey,
        userId: config.userId,
        registry,
        selector: createPortfolioIngressSelector(db, registry),
        event,
        kind: normalized.kind,
        ...(normalized.kind === "message" ? { text: normalized.text } : normalized.actionToken ? { actionToken: normalized.actionToken } : {}),
        ...(normalized.kind === "message" && normalized.messageId
          ? { copilotMeta: { messageId: normalized.messageId, ...(normalized.chatType ? { chatType: normalized.chatType } : {}) } }
          : {}),
        ...(normalized.kind === "card_action" && normalized.value
          ? { cardAction: { value: normalized.value, ...(normalized.messageId ? { messageId: normalized.messageId } : {}) } }
          : {}),
        ...(copilotChannel ? { copilotChannel } : {})
      });
      const acknowledged = routed === "copilot" || routed === "portfolio";
      res.status(200).json(normalized.kind === "card_action"
        ? renderFeishuCardActionAcceptedResponse()
        : { msg: acknowledged ? "ok" : "ignored" });
    } catch {
      sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_selector_rejected");
    }
  });

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
      ensurePortfolioHandler(new PortfolioFeishuRegistryRepository(db), userId, parsed.data.appId);
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
    const health = options.channelRuntime?.getHealth(userIdFor(req)) ?? { state: "disabled", accountId: null, configRevision: null, reconnectAttempt: 0, lastConnectedAt: null, lastErrorMessage: null };
    res.json({ code: 0, data: { health }, message: "" });
  });
  router.get("/status", async (req, res) => {
    try {
      const status = await getStatus();
      const config = options.db ? repoFor(options.db, req).getConfig() : undefined;
      res.json({ code: 0, data: { status: config ? { ...status, enabled: config.enabled, emergencyDisabled: config.emergencyDisabled, identityMode: config.identityMode === "unknown" ? status.identityMode : config.identityMode } : status }, message: "" });
    } catch { res.status(500).json({ code: 1, message: "Failed to check Feishu integration status" }); }
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
      new AuditLogRepository(db, userId).create({ action: "feishu.config.update", resourceType: "feishu_integration", details: { enabled: config.enabled, emergencyDisabled: config.emergencyDisabled, identityMode: config.identityMode, allowedChatIdCount: config.allowedChatIds.length }, ipAddress: req.ip });
      res.json({ code: 0, data: { config }, message: "" });
    } catch (error) { invalid(res, error instanceof Error ? error.message : "Invalid Feishu integration config"); }
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
      new AuditLogRepository(db, userId).create({ action: "feishu.user_mappings.replace", resourceType: "feishu_integration", details: { mappingCount: mappings.length }, ipAddress: req.ip });
      res.json({ code: 0, data: { mappings: mappings.map(toMappingPayload) }, message: "" });
    } catch (error) { invalid(res, error instanceof Error ? error.message : "Invalid Feishu user mappings"); }
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

interface PublicFeishuIngress {
  kind: "message" | "card_action";
  chatId: string;
  feishuUserId: string;
  eventId?: string;
  messageId?: string;
  text: string;
  actionToken?: string;
  /** Object-form button value (copilot decision cards); portfolio uses actionToken strings. */
  value?: Record<string, unknown>;
  chatType?: string;
}

function findPublicWebhookConfig(db: Database, masterKey: string, publicId: string, res: Response) {
  try {
    const config = new FeishuIntegrationRepository(db, "__public_webhook__", masterKey).findPublicWebhookConfig(publicId);
    if (!config) sendPublicWebhookError(res, 404, "feishu_webhook_not_found");
    else if (!config.publicWebhookEnabled) sendPublicWebhookError(res, 403, "feishu_webhook_disabled");
    return config;
  } catch { sendPublicWebhookError(res, 403, "feishu_webhook_invalid_config"); return undefined; }
}

function consumePublicReplayAndRate(
  repository: FeishuIntegrationRepository,
  config: { userId: string; publicWebhookId: string },
  event: PublicFeishuIngress,
  mapping: FeishuUserMapping,
  signature: Extract<FeishuSignatureVerification, { ok: true }>,
  limit: { max: number; windowMs: number }
): boolean {
  const replayKey = event.eventId ? `event:${event.eventId}` : event.messageId ? `message:${event.messageId}` : `signature:${signature.timestamp}:${signature.nonce}:${signature.signature}`;
  return repository.consumePublicWebhookReplayKey({ userId: config.userId, publicWebhookId: config.publicWebhookId, replayKey, ttlMs: publicWebhookReplayTtlMs })
    && repository.consumePublicWebhookReplayKey({ userId: config.userId, publicWebhookId: config.publicWebhookId, replayKey: `nonce:${signature.timestamp}:${signature.nonce}:${signature.signature}`, ttlMs: publicWebhookReplayTtlMs })
    && repository.consumePublicWebhookRateWindow({ userId: config.userId, publicWebhookId: config.publicWebhookId, scope: "integration", scopeId: config.publicWebhookId, max: limit.max, windowMs: limit.windowMs })
    && repository.consumePublicWebhookRateWindow({ userId: config.userId, publicWebhookId: config.publicWebhookId, scope: "chat", scopeId: event.chatId, max: limit.max, windowMs: limit.windowMs })
    && repository.consumePublicWebhookRateWindow({ userId: config.userId, publicWebhookId: config.publicWebhookId, scope: "user", scopeId: mapping.forgebadgerUserId, max: limit.max, windowMs: limit.windowMs });
}

function ensurePortfolioHandler(registry: PortfolioFeishuRegistryRepository, userId: string, providerAccountId: string): void {
  registry.register({ userId, provider: "feishu", providerAccountId });
}

function authorizePublicWebhookActor(
  repository: FeishuIntegrationRepository,
  config: FeishuPublicWebhookConfig,
  event: PublicFeishuIngress
): FeishuUserMapping | undefined {
  if (
    !config.enabled
    || config.emergencyDisabled
    || (config.identityMode !== "user" && config.identityMode !== "bot")
    || config.allowedChatIds.length === 0
    || !config.allowedChatIds.includes(event.chatId)
  ) {
    return undefined;
  }
  const mapping = repository.listUserMappings()
    .find((candidate) => candidate.feishuUserId === event.feishuUserId);
  return mapping?.forgebadgerUserId === config.userId ? mapping : undefined;
}

function isFeishuUrlVerification(body: unknown): boolean { return isRecord(body) && body.type === "url_verification"; }
function getFeishuChallenge(body: unknown): string { return isRecord(body) && typeof body.challenge === "string" ? body.challenge : ""; }
function getFeishuBodyToken(body: unknown): string | undefined { return isRecord(body) && typeof body.token === "string" ? body.token : isRecord(body) && isRecord(body.header) && typeof body.header.token === "string" ? body.header.token : undefined; }
function hasEncryptedFeishuPayload(body: unknown): boolean { return isRecord(body) && typeof body.encrypt === "string"; }
function getRawRequestBody(req: Request): Buffer { const raw = (req as Request & { rawBody?: Buffer }).rawBody; return raw ?? Buffer.from(JSON.stringify(req.body ?? {})); }

type FeishuSignatureVerification = { ok: true; timestamp: string; nonce: string; signature: string } | { ok: false; code: string };
function verifyFeishuPublicSignature(req: Request, rawBody: Buffer, secret: string | null): FeishuSignatureVerification {
  if (!secret) return { ok: false, code: "feishu_webhook_signature_unconfigured" };
  const timestamp = header(req, "x-lark-request-timestamp") ?? header(req, "x-feishu-request-timestamp");
  const nonce = header(req, "x-lark-request-nonce") ?? header(req, "x-feishu-request-nonce");
  const signature = header(req, "x-lark-signature") ?? header(req, "x-feishu-signature");
  if (!timestamp || !nonce || !signature) return { ok: false, code: "feishu_webhook_signature_missing" };
  if (!/^\d+$/u.test(timestamp)) {
    return { ok: false, code: "feishu_webhook_timestamp_invalid" };
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) {
    return { ok: false, code: "feishu_webhook_timestamp_invalid" };
  }
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (Math.abs(nowSeconds - timestampSeconds) > publicWebhookTimestampWindowSeconds) {
    return { ok: false, code: "feishu_webhook_timestamp_out_of_window" };
  }
  const expected = createHash("sha256").update(`${timestamp}${nonce}${secret}${rawBody.toString("utf8")}`).digest("hex");
  if (!safeEqualHex(signature, expected)) return { ok: false, code: "feishu_webhook_signature_invalid" };
  return { ok: true, timestamp, nonce, signature };
}

function normalizePublicFeishuIngress(body: unknown): PublicFeishuIngress | undefined {
  if (!isRecord(body)) return undefined;
  const event = isRecord(body.event) ? body.event : body;
  const headerValue = isRecord(body.header) ? body.header : {};
  const eventId = firstString(headerValue.event_id, event.event_id, event.eventId);
  const sender = isRecord(event.sender) ? event.sender : {};
  const senderId = isRecord(sender.sender_id) ? sender.sender_id : {};
  const operator = isRecord(event.operator) ? event.operator : {};
  const context = isRecord(event.context) ? event.context : {};
  const feishuUserId = firstString(operator.open_id, senderId.open_id, event.open_id, event.sender_open_id);
  const message = isRecord(event.message) ? event.message : {};
  const chatId = firstString(context.open_chat_id, message.chat_id, event.chat_id, event.open_chat_id);
  const chatType = firstString(message.chat_type, event.chat_type);
  if (!feishuUserId || !chatId) return undefined;
  const action = isRecord(event.action) ? event.action : isRecord(body.action) ? body.action : undefined;
  if (action) {
    const actionToken = firstString(action.value, action.action_value, event.action_token);
    const messageId = firstString(
      context.open_message_id,
      message.message_id,
      event.message_id,
      event.open_message_id
    );
    const value = isRecord(action.value) ? action.value : undefined;
    if (!actionToken && !value) return undefined;
    return {
      kind: "card_action", chatId, feishuUserId, text: "[card action]",
      ...(actionToken ? { actionToken } : {}),
      ...(value ? { value } : {}),
      ...(chatType ? { chatType } : {}),
      ...(eventId ? { eventId } : {}),
      ...(messageId ? { messageId } : {})
    };
  }
  const text = parseFeishuTextContent(message.content);
  const messageId = firstString(message.message_id, event.message_id);
  return text === undefined ? undefined : {
    kind: "message", chatId, feishuUserId, text,
    ...(chatType ? { chatType } : {}),
    ...(eventId ? { eventId } : {}),
    ...(messageId ? { messageId } : {})
  };
}

function parseFeishuTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    try { const parsed = JSON.parse(content); return isRecord(parsed) && typeof parsed.text === "string" ? parsed.text : content; } catch { return content; }
  }
  return isRecord(content) && typeof content.text === "string" ? content.text : undefined;
}
function header(req: Request, name: string): string | undefined { const value = req.header(name); return value && value.trim() ? value.trim() : undefined; }
function safeEqualHex(actual: string, expected: string): boolean { const left = Buffer.from(actual, "utf8"); const right = Buffer.from(expected, "utf8"); return left.length === right.length && timingSafeEqual(left, right); }
function sendPublicWebhookError(res: Response, status: number, code: string): void { res.status(status).json({ msg: code }); }
function sendPublicWebhookPolicyReject(db: Database, userId: string, ipAddress: string | undefined, res: Response, event: PublicFeishuIngress, reasonCode: string): void {
  new AuditLogRepository(db, userId).create({ action: "feishu.webhook.reject", resourceType: "feishu_public_webhook", resourceId: event.messageId ?? event.eventId ?? null, details: { reasonCode, eventId: event.eventId ?? null, chatId: event.chatId, feishuUserId: event.feishuUserId }, ipAddress });
  res.status(200).json({ msg: "ignored" });
}
function userIdFor(req: unknown): string { return (req as AuthenticatedRequest).userId; }
function repoFor(db: Database, req: unknown): FeishuIntegrationRepository { return new FeishuIntegrationRepository(db, userIdFor(req)); }
function requireDb(db: Database | undefined, res: Response): Database | undefined { if (db) return db; res.status(503).json({ code: 1, message: "Feishu integration persistence is unavailable" }); return undefined; }
function unavailable(res: Response): void { res.status(503).json({ code: 1, message: "Feishu credential encryption is unavailable" }); }
function invalid(res: Response, message: string): void { res.status(400).json({ code: 1, message }); }
function toMappingPayload(mapping: FeishuUserMapping) { return { id: mapping.id, feishuUserId: mapping.feishuUserId, forgebadgerUserId: mapping.forgebadgerUserId, displayName: mapping.displayName, createdAt: new Date(mapping.createdAt).toISOString(), updatedAt: new Date(mapping.updatedAt).toISOString() }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function firstString(...values: unknown[]): string | undefined { return values.find((value): value is string => typeof value === "string" && value.trim().length > 0); }
