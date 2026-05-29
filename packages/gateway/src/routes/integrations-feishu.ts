import { createHash, timingSafeEqual } from "node:crypto";

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import { AuditLogRepository } from "../db/repositories/audit-log-repository.js";
import {
  CopilotLiveRunConflictError,
  CopilotRepository,
  type CopilotConversation,
  type CopilotRun,
  type CopilotRunEvent
} from "../db/repositories/copilot-repository.js";
import {
  FeishuIntegrationRepository,
  type FeishuIntegrationConfig,
  type FeishuUserMapping
} from "../db/repositories/feishu-integration-repository.js";
import { ProjectRepository } from "../db/repositories/project-repository.js";
import type { Database } from "../db/types.js";
import {
  getFeishuCliStatus,
  type FeishuCliStatus
} from "../services/integrations/feishu-cli.js";
import {
  CopilotOrchestrator,
  type CopilotOrchestratorOptions
} from "../services/copilot/orchestrator.js";
import { redactCopilotText } from "../services/copilot/redaction.js";

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

const inboundFeishuCommandSchema = z.object({
  chatId: z.string().trim().min(1).max(128),
  feishuUserId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(8_000),
  messageId: z.string().trim().min(1).max(128).optional(),
  projectId: z.string().trim().min(1).max(128).optional()
}).strict();

type InboundFeishuCommand = z.infer<typeof inboundFeishuCommandSchema>;
const defaultStaleCopilotRunTimeoutMs = 15 * 60 * 1000;
const defaultStaleCopilotApprovalTimeoutMs = 24 * 60 * 60 * 1000;
const publicWebhookTimestampWindowMs = 5 * 60 * 1000;
const publicWebhookReplayTtlMs = 5 * 60 * 1000;

export interface FeishuIntegrationRoutesOptions {
  db?: Database;
  masterKey?: string;
  getStatus?: () => Promise<FeishuCliStatus>;
  inboundRateLimit?: { max: number; windowMs: number };
  publicWebhookRateLimit?: { max: number; windowMs: number };
  modelClientFactory?: CopilotOrchestratorOptions["modelClientFactory"];
  modelRequestTimeoutMs?: CopilotOrchestratorOptions["modelRequestTimeoutMs"];
  runControls?: CopilotOrchestratorOptions["runControls"];
  sessionManager?: CopilotOrchestratorOptions["sessionManager"];
  adapterCommandRunner?: CopilotOrchestratorOptions["adapterCommandRunner"];
  staleRunTimeoutMs?: number;
  staleApprovalTimeoutMs?: number;
}

export function createFeishuIntegrationRoutes(
  options: FeishuIntegrationRoutesOptions = {}
): Router {
  const router = Router();
  const getStatus = options.getStatus ?? (() => getFeishuCliStatus({ env: process.env }));
  const activeInboundUsers = new Set<string>();
  const inboundRateWindows = new Map<string, { startedAt: number; count: number }>();
  const inboundRateLimit = options.inboundRateLimit ?? { max: 20, windowMs: 60_000 };
  const publicWebhookRateLimit = options.publicWebhookRateLimit ?? { max: 20, windowMs: 60_000 };

  router.post("/webhook/:publicId", async (req, res) => {
    const db = options.db;
    if (!db) {
      sendPublicWebhookError(res, 503, "feishu_webhook_unavailable");
      return;
    }
    if (!options.masterKey) {
      sendPublicWebhookError(res, 503, "feishu_webhook_unavailable");
      return;
    }

    let config;
    try {
      config = new FeishuIntegrationRepository(db, "__public_webhook__", options.masterKey)
        .findPublicWebhookConfig(req.params.publicId);
    } catch {
      sendPublicWebhookError(res, 403, "feishu_webhook_invalid_config");
      return;
    }
    if (!config) {
      sendPublicWebhookError(res, 404, "feishu_webhook_not_found");
      return;
    }
    if (!config.publicWebhookEnabled) {
      sendPublicWebhookError(res, 403, "feishu_webhook_disabled");
      return;
    }

    const body = req.body ?? {};
    if (isFeishuUrlVerification(body)) {
      if (getFeishuBodyToken(body) !== config.verificationToken) {
        sendPublicWebhookError(res, 401, "feishu_webhook_token_invalid");
        return;
      }
      res.status(200).json({ challenge: getFeishuChallenge(body) });
      return;
    }

    const rawBody = getRawRequestBody(req);
    const signature = verifyFeishuPublicSignature(req, rawBody, config.eventEncryptKey);
    if (!signature.ok) {
      sendPublicWebhookError(res, 401, signature.code);
      return;
    }
    if (hasEncryptedFeishuPayload(body)) {
      sendPublicWebhookError(res, 400, "feishu_webhook_encrypted_payload_unsupported");
      return;
    }
    if (getFeishuBodyToken(body) !== config.verificationToken) {
      sendPublicWebhookError(res, 401, "feishu_webhook_token_invalid");
      return;
    }

    const normalized = normalizePublicFeishuCommand(body);
    if (!normalized) {
      res.status(200).json({ msg: "ignored" });
      return;
    }

    const publicRepo = new FeishuIntegrationRepository(db, config.userId, options.masterKey);
    const replayKey = normalized.eventId
      ? `event:${normalized.eventId}`
      : normalized.messageId
        ? `message:${normalized.messageId}`
        : `signature:${signature.timestamp}:${signature.nonce}:${signature.signature}`;
    const nonceReplayKey = `nonce:${signature.timestamp}:${signature.nonce}:${signature.signature}`;
    if (
      !publicRepo.consumePublicWebhookReplayKey({
        userId: config.userId,
        publicWebhookId: config.publicWebhookId,
        replayKey,
        ttlMs: publicWebhookReplayTtlMs
      }) ||
      !publicRepo.consumePublicWebhookReplayKey({
        userId: config.userId,
        publicWebhookId: config.publicWebhookId,
        replayKey: nonceReplayKey,
        ttlMs: publicWebhookReplayTtlMs
      })
    ) {
      res.status(200).json({ msg: "replayed" });
      return;
    }

    if (!config.enabled) {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_integration_disabled");
    }
    if (config.emergencyDisabled) {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_integration_emergency_disabled");
    }
    if (config.identityMode !== "user" && config.identityMode !== "bot") {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_identity_mode_required");
    }
    if (config.allowedChatIds.length === 0) {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_chat_allowlist_required");
    }
    if (!config.allowedChatIds.includes(normalized.chatId)) {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_chat_not_allowed");
    }
    const mappedUserId = findMappedOpenForgeUserId(publicRepo, normalized.feishuUserId);
    if (mappedUserId !== config.userId) {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_user_not_mapped");
    }
    if (normalized.projectId && !new ProjectRepository(db, config.userId).getById(normalized.projectId)) {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_project_not_visible");
    }
    if (
      !publicRepo.consumePublicWebhookRateWindow({
        userId: config.userId,
        publicWebhookId: config.publicWebhookId,
        scope: "integration",
        scopeId: config.publicWebhookId,
        max: publicWebhookRateLimit.max,
        windowMs: publicWebhookRateLimit.windowMs
      }) ||
      !publicRepo.consumePublicWebhookRateWindow({
        userId: config.userId,
        publicWebhookId: config.publicWebhookId,
        scope: "chat",
        scopeId: normalized.chatId,
        max: publicWebhookRateLimit.max,
        windowMs: publicWebhookRateLimit.windowMs
      }) ||
      !publicRepo.consumePublicWebhookRateWindow({
        userId: config.userId,
        publicWebhookId: config.publicWebhookId,
        scope: "user",
        scopeId: mappedUserId,
        max: publicWebhookRateLimit.max,
        windowMs: publicWebhookRateLimit.windowMs
      })
    ) {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "feishu_webhook_rate_limited");
    }

    const repo = new CopilotRepository(db, config.userId);
    recoverStaleCopilotRuns(repo, options.staleRunTimeoutMs, options.staleApprovalTimeoutMs);
    if (repo.findActiveRun()) {
      return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "copilot_run_already_active");
    }
    if (activeInboundUsers.has(config.userId)) activeInboundUsers.delete(config.userId);

    activeInboundUsers.add(config.userId);
    try {
      const result = await new CopilotOrchestrator({
        db,
        masterKey: options.masterKey,
        ...(options.modelClientFactory ? { modelClientFactory: options.modelClientFactory } : {}),
        ...(options.modelRequestTimeoutMs ? { modelRequestTimeoutMs: options.modelRequestTimeoutMs } : {}),
        ...(options.runControls ? { runControls: options.runControls } : {}),
        ...(options.sessionManager ? { sessionManager: options.sessionManager } : {}),
        ...(options.adapterCommandRunner ? { adapterCommandRunner: options.adapterCommandRunner } : {})
      }).runText({
        userId: config.userId,
        prompt: normalized.text,
        source: "feishu",
        ...(normalized.projectId ? { sourceRefId: normalized.projectId } : {})
      });
      const pendingActions = repo.listPendingActions(result.run.id);
      const conversation = repo.createConversation({
        title: inboundConversationTitle(normalized.text),
        source: "feishu",
        ...(normalized.projectId ? { sourceRefId: normalized.projectId } : {})
      });
      repo.createConversationMessage(conversation.id, {
        role: "user",
        content: redactCopilotText(normalized.text),
        runId: result.run.id,
        payload: inboundMessagePayload(normalized)
      });
      storeInboundAssistantMessages(repo, conversation.id, result.run.id, result.events);
      recordPublicWebhookAccept(
        db,
        config.userId,
        req.ip,
        config.publicWebhookId,
        normalized,
        result.run.id,
        conversation.id,
        pendingActions.length
      );
      res.status(200).json({ msg: "ok" });
    } catch (error) {
      if (error instanceof CopilotLiveRunConflictError) {
        return sendPublicWebhookPolicyReject(db, config.userId, req.ip, res, normalized, "copilot_run_already_active");
      }
      sendPublicWebhookError(res, 500, "feishu_webhook_run_failed");
    } finally {
      activeInboundUsers.delete(config.userId);
    }
  });

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

  router.post("/inbound", async (req, res) => {
    const db = requireRepo(options.db, res);
    if (!db) return;
    const parseResult = inboundFeishuCommandSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      res.status(400).json({
        code: 1,
        message: "Invalid Feishu inbound command",
        details: { code: "feishu_inbound_invalid_payload" }
      });
      return;
    }

    const userId = (req as unknown as AuthenticatedRequest).userId;
    const command = parseResult.data;
    const config = new FeishuIntegrationRepository(db, userId).getConfig();
    if (!config.enabled) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 403,
        code: "feishu_integration_disabled",
        message: "Feishu integration is disabled"
      });
    }
    if (config.emergencyDisabled) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 403,
        code: "feishu_integration_emergency_disabled",
        message: "Feishu integration is emergency-disabled"
      });
    }
    if (config.identityMode !== "user" && config.identityMode !== "bot") {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 403,
        code: "feishu_identity_mode_required",
        message: "Feishu identity mode must be configured"
      });
    }
    if (config.allowedChatIds.length === 0) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 403,
        code: "feishu_chat_allowlist_required",
        message: "Feishu inbound chat allowlist is required"
      });
    }
    if (!config.allowedChatIds.includes(command.chatId)) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 403,
        code: "feishu_chat_not_allowed",
        message: "Feishu chat is not allowed"
      });
    }
    if (command.messageId && isAcceptedInboundMessageReplay(db, userId, command.messageId)) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 409,
        code: "feishu_message_replayed",
        message: "Feishu inbound message was already accepted"
      });
    }
    const mappedUserId = findMappedOpenForgeUserId(new FeishuIntegrationRepository(db, userId), command.feishuUserId);
    if (mappedUserId !== userId) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 403,
        code: "feishu_user_not_mapped",
        message: "Feishu user is not mapped to the current OpenForge user"
      });
    }
    if (command.projectId && !new ProjectRepository(db, userId).getById(command.projectId)) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 403,
        code: "feishu_project_not_visible",
        message: "Feishu inbound project is not visible to the mapped user"
      });
    }
    if (!consumeInboundRateLimit(inboundRateWindows, inboundRateLimit, userId, command.chatId)) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 429,
        code: "feishu_inbound_rate_limited",
        message: "Feishu inbound command rate limit exceeded"
      });
    }
    const repo = new CopilotRepository(db, userId);
    recoverStaleCopilotRuns(repo, options.staleRunTimeoutMs, options.staleApprovalTimeoutMs);
    const activeRun = repo.findActiveRun();
    if (activeRun) {
      return sendInboundReject(db, userId, req.ip, res, command, {
        status: 409,
        code: "copilot_run_already_active",
        message: "A Copilot run is already active"
      });
    }
    // The DB live-run constraint is the source of truth; clear stale process locks after recovery.
    if (activeInboundUsers.has(userId)) activeInboundUsers.delete(userId);
    if (!options.masterKey) {
      res.status(503).json({
        code: 1,
        message: "Feishu inbound Copilot execution is unavailable",
        details: { code: "feishu_inbound_copilot_unavailable" }
      });
      return;
    }

    activeInboundUsers.add(userId);
    try {
      const result = await new CopilotOrchestrator({
        db,
        masterKey: options.masterKey,
        ...(options.modelClientFactory ? { modelClientFactory: options.modelClientFactory } : {}),
        ...(options.modelRequestTimeoutMs ? { modelRequestTimeoutMs: options.modelRequestTimeoutMs } : {}),
        ...(options.runControls ? { runControls: options.runControls } : {}),
        ...(options.sessionManager ? { sessionManager: options.sessionManager } : {}),
        ...(options.adapterCommandRunner ? { adapterCommandRunner: options.adapterCommandRunner } : {})
      }).runText({
        userId,
        prompt: command.text,
        source: "feishu",
        ...(command.projectId ? { sourceRefId: command.projectId } : {})
      });
      const pendingActions = repo.listPendingActions(result.run.id);
      const conversation = repo.createConversation({
        title: inboundConversationTitle(command.text),
        source: "feishu",
        ...(command.projectId ? { sourceRefId: command.projectId } : {})
      });
      repo.createConversationMessage(conversation.id, {
        role: "user",
        content: redactCopilotText(command.text),
        runId: result.run.id,
        payload: inboundMessagePayload(command)
      });
      storeInboundAssistantMessages(repo, conversation.id, result.run.id, result.events);
      recordInboundAccept(db, userId, req.ip, command, result.run.id, conversation.id, pendingActions.length);
      res.status(result.ok ? 201 : result.status).json({
        code: result.ok ? 0 : 1,
        data: result.ok
          ? inboundSuccessPayload(conversation, result.run, result.events.length, pendingActions.length)
          : undefined,
        message: result.ok ? "" : result.error.message,
        ...(result.ok ? {} : { details: { code: result.error.code, runId: result.run.id } })
      });
    } catch (error) {
      if (error instanceof CopilotLiveRunConflictError) {
        return sendInboundReject(db, userId, req.ip, res, command, {
          status: 409,
          code: "copilot_run_already_active",
          message: "A Copilot run is already active"
        });
      }
      res.status(500).json({
        code: 1,
        message: "Failed to create Feishu inbound Copilot run",
        details: { code: "feishu_inbound_run_failed" }
      });
    } finally {
      activeInboundUsers.delete(userId);
    }
  });

  return router;
}

type PublicFeishuCommand = InboundFeishuCommand & {
  eventId?: string | undefined;
};

type FeishuSignatureVerification =
  | { ok: true; timestamp: string; nonce: string; signature: string }
  | { ok: false; code: string };

function isFeishuUrlVerification(body: unknown): boolean {
  return isRecord(body) && body.type === "url_verification" && typeof body.challenge === "string";
}

function getFeishuChallenge(body: unknown): string {
  return isRecord(body) && typeof body.challenge === "string" ? body.challenge : "";
}

function getFeishuBodyToken(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.token === "string") return body.token;
  const header = body.header;
  return isRecord(header) && typeof header.token === "string" ? header.token : undefined;
}

function hasEncryptedFeishuPayload(body: unknown): boolean {
  return isRecord(body) && typeof body.encrypt === "string";
}

function getRawRequestBody(req: Request): Buffer {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody;
  return Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
}

function verifyFeishuPublicSignature(
  req: Request,
  rawBody: Buffer,
  eventEncryptKey: string
): FeishuSignatureVerification {
  const timestamp = getHeaderValue(req, "x-lark-request-timestamp");
  const nonce = getHeaderValue(req, "x-lark-request-nonce");
  const signature = getHeaderValue(req, "x-lark-signature");
  if (!timestamp || !nonce || !signature) {
    return { ok: false, code: "feishu_webhook_signature_required" };
  }
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isSafeInteger(timestampSeconds)) {
    return { ok: false, code: "feishu_webhook_timestamp_invalid" };
  }
  const ageMs = Math.abs(Date.now() - timestampSeconds * 1000);
  if (ageMs > publicWebhookTimestampWindowMs) {
    return { ok: false, code: "feishu_webhook_timestamp_stale" };
  }
  const expected = createHash("sha256")
    .update(`${timestamp}${nonce}${eventEncryptKey}`, "utf8")
    .update(rawBody)
    .digest("hex");
  if (!safeEqualHex(signature, expected)) {
    return { ok: false, code: "feishu_webhook_signature_invalid" };
  }
  return { ok: true, timestamp, nonce, signature };
}

function normalizePublicFeishuCommand(body: unknown): PublicFeishuCommand | undefined {
  if (!isRecord(body)) return undefined;
  const header = body.header;
  const eventType = isRecord(header) && typeof header.event_type === "string" ? header.event_type : undefined;
  if (eventType !== "im.message.receive_v1") return undefined;
  const event = body.event;
  if (!isRecord(event)) return undefined;
  const message = event.message;
  if (!isRecord(message)) return undefined;
  if (typeof message.message_type === "string" && message.message_type !== "text") return undefined;

  const sender = event.sender;
  const senderId = isRecord(sender) ? sender.sender_id : undefined;
  const feishuUserId = firstString(
    isRecord(senderId) ? senderId.open_id : undefined,
    isRecord(senderId) ? senderId.user_id : undefined,
    isRecord(senderId) ? senderId.union_id : undefined
  );
  const command = inboundFeishuCommandSchema.safeParse({
    chatId: message.chat_id,
    feishuUserId,
    text: parseFeishuTextContent(message.content),
    messageId: message.message_id,
    projectId: parseFeishuProjectId(message.content)
  });
  if (!command.success) return undefined;
  const eventId = isRecord(header) && typeof header.event_id === "string" ? header.event_id : undefined;
  return {
    ...command.data,
    ...(eventId ? { eventId } : {})
  };
}

function parseFeishuTextContent(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) && typeof parsed.text === "string" ? parsed.text : undefined;
  } catch {
    return undefined;
  }
}

function parseFeishuProjectId(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return undefined;
    return typeof parsed.projectId === "string" ? parsed.projectId : undefined;
  } catch {
    return undefined;
  }
}

function getHeaderValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value[0] : undefined;
}

function safeEqualHex(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendPublicWebhookError(res: Response, status: number, code: string): void {
  res.status(status).json({ msg: code });
}

function sendPublicWebhookPolicyReject(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  res: Response,
  command: PublicFeishuCommand,
  reasonCode: string
): void {
  new AuditLogRepository(db, userId).create({
    action: "feishu.webhook.reject",
    resourceType: "feishu_public_webhook",
    resourceId: command.messageId ?? command.eventId ?? null,
    details: {
      reasonCode,
      eventId: command.eventId ?? null,
      chatId: command.chatId,
      feishuUserId: command.feishuUserId,
      messageId: command.messageId ?? null,
      projectId: command.projectId ?? null,
      textSummary: inboundTextSummary(command.text)
    },
    ipAddress
  });
  res.status(200).json({ msg: "ignored" });
}

function recordPublicWebhookAccept(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  publicWebhookId: string,
  command: PublicFeishuCommand,
  runId: string,
  conversationId: string,
  pendingActionCount: number
): void {
  new AuditLogRepository(db, userId).create({
    action: "feishu.webhook.accept",
    resourceType: "feishu_public_webhook",
    resourceId: command.messageId ?? command.eventId ?? null,
    details: {
      publicWebhookId,
      eventId: command.eventId ?? null,
      chatId: command.chatId,
      feishuUserId: command.feishuUserId,
      messageId: command.messageId ?? null,
      projectId: command.projectId ?? null,
      runId,
      conversationId,
      pendingActionCount,
      textSummary: inboundTextSummary(command.text)
    },
    ipAddress
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
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

function findMappedOpenForgeUserId(repo: FeishuIntegrationRepository, feishuUserId: string): string | null {
  return repo.listUserMappings()
    .find((mapping) => mapping.feishuUserId === feishuUserId)
    ?.openforgeUserId ?? null;
}

function recoverStaleCopilotRuns(
  repo: CopilotRepository,
  timeoutMs = defaultStaleCopilotRunTimeoutMs,
  approvalTimeoutMs = defaultStaleCopilotApprovalTimeoutMs
): void {
  const now = Date.now();
  const timeout = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : defaultStaleCopilotRunTimeoutMs;
  const approvalTimeout = Number.isFinite(approvalTimeoutMs)
    ? Math.max(0, approvalTimeoutMs)
    : defaultStaleCopilotApprovalTimeoutMs;
  repo.recoverStaleExecutionRuns(now - timeout, now);
  repo.recoverStaleApprovalRuns(now - approvalTimeout, now);
}

function isAcceptedInboundMessageReplay(db: Database, userId: string, messageId: string): boolean {
  return new AuditLogRepository(db, userId).list({
    action: "feishu.inbound.accept",
    resourceType: "feishu_inbound_command",
    resourceId: messageId,
    limit: 1
  }).length > 0;
}

function consumeInboundRateLimit(
  windows: Map<string, { startedAt: number; count: number }>,
  limit: { max: number; windowMs: number },
  userId: string,
  chatId: string
): boolean {
  const key = `${userId}:${chatId}`;
  const now = Date.now();
  const current = windows.get(key);
  if (!current || now - current.startedAt >= limit.windowMs) {
    windows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit.max) return false;
  current.count += 1;
  return true;
}

function inboundConversationTitle(text: string): string {
  const summary = inboundTextSummary(text);
  return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary || "Feishu command";
}

function inboundMessagePayload(command: InboundFeishuCommand): Record<string, unknown> {
  return {
    source: "feishu",
    chatId: command.chatId,
    feishuUserId: command.feishuUserId,
    messageId: command.messageId ?? null,
    projectId: command.projectId ?? null,
    textSummary: inboundTextSummary(command.text)
  };
}

function storeInboundAssistantMessages(
  repo: CopilotRepository,
  conversationId: string,
  runId: string,
  events: CopilotRunEvent[]
): void {
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const text = typeof event.payload.text === "string" ? event.payload.text : event.message;
    if (!text) continue;
    repo.createConversationMessage(conversationId, {
      role: "assistant",
      content: redactCopilotText(text),
      runId,
      payload: { source: "feishu" }
    });
  }
}

function recordInboundAccept(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  command: InboundFeishuCommand,
  runId: string,
  conversationId: string,
  pendingActionCount: number
): void {
  new AuditLogRepository(db, userId).create({
    action: "feishu.inbound.accept",
    resourceType: "feishu_inbound_command",
    resourceId: command.messageId ?? null,
    details: {
      chatId: command.chatId,
      feishuUserId: command.feishuUserId,
      messageId: command.messageId ?? null,
      projectId: command.projectId ?? null,
      runId,
      conversationId,
      pendingActionCount,
      textSummary: inboundTextSummary(command.text)
    },
    ipAddress
  });
}

function inboundSuccessPayload(
  conversation: CopilotConversation,
  run: CopilotRun,
  eventCount: number,
  pendingActionCount: number
) {
  return {
    conversation: {
      id: conversation.id,
      source: conversation.source,
      sourceRefId: conversation.sourceRefId,
      status: conversation.status
    },
    run: {
      id: run.id,
      status: run.status,
      source: run.source,
      sourceRefId: run.sourceRefId
    },
    eventCount,
    pendingActionCount
  };
}

function sendInboundReject(
  db: Database,
  userId: string,
  ipAddress: string | undefined,
  res: { status: (code: number) => { json: (body: unknown) => void } },
  command: InboundFeishuCommand,
  error: { status: number; code: string; message: string }
): void {
  new AuditLogRepository(db, userId).create({
    action: "feishu.inbound.reject",
    resourceType: "feishu_inbound_command",
    resourceId: command.messageId ?? null,
    details: {
      reasonCode: error.code,
      chatId: command.chatId,
      feishuUserId: command.feishuUserId,
      messageId: command.messageId ?? null,
      projectId: command.projectId ?? null,
      textSummary: inboundTextSummary(command.text)
    },
    ipAddress
  });
  res.status(error.status).json({
    code: 1,
    message: error.message,
    details: { code: error.code }
  });
}

function inboundTextSummary(text: string): string {
  const redacted = redactCopilotText(text).replace(/\s+/g, " ").trim();
  return redacted.length > 160 ? `${redacted.slice(0, 157)}...` : redacted;
}
