import type { Database } from "../../db/types.js";
import { CopilotAutomationRepository } from "../../db/repositories/copilot-automation-repository.js";
import { CopilotRepository } from "../../db/repositories/copilot-repository.js";
import { FeishuChannelRepository, type FeishuInboxItem } from "../../db/repositories/feishu-channel-repository.js";
import { FeishuIntegrationRepository } from "../../db/repositories/feishu-integration-repository.js";
import { ProjectRepository } from "../../db/repositories/project-repository.js";
import { SessionRepository } from "../../db/repositories/session-repository.js";
import type { InMemorySessionManager } from "../session-manager.js";
import { CopilotAutomationRunner } from "../copilot/automation-runner.js";
import { CopilotAutomationScheduler } from "../copilot/automation-scheduler.js";
import { CopilotOrchestrator, type RunCopilotTextResult } from "../copilot/orchestrator.js";
import { executeCopilotSessionInput } from "../copilot/session-input-approval.js";
import { redactCopilotText } from "../copilot/redaction.js";
import type { CopilotPendingAction } from "../../db/repositories/copilot-repository.js";
import { FeishuChannelRuntime } from "./feishu-channel-runtime.js";
import { FeishuConnectionSupervisor, type FeishuSupervisorAccount } from "./feishu-connection-supervisor.js";
import { FeishuConversationBindingService, FeishuCopilotInboundDispatcher } from "./feishu-conversation-binding.js";
import { FeishuDeliveryError, FeishuDeliveryService, type FeishuDeliveryPart } from "./feishu-delivery-service.js";
import { FeishuDeliveryWorker } from "./feishu-delivery-worker.js";
import { normalizeFeishuEvent, type FeishuInboundMessage } from "./feishu-event-normalizer.js";
import { FeishuIngressService } from "./feishu-ingress-service.js";
import { FeishuIngressWorker } from "./feishu-ingress-worker.js";
import { FeishuSdkFactory } from "./feishu-sdk.js";
import { FeishuTypingReactionLifecycle } from "./feishu-typing-reaction.js";
import { FeishuPendingActionBridge, type FeishuPendingDecisionResult } from "./feishu-pending-action-bridge.js";
import { renderFeishuCardActionAcceptedResponse } from "./feishu-card-renderer.js";

const feishuSessionInputTrackingDelaysMs = [750, 1_250, 2_000];

interface AccountIdentityRow {
  id: string;
  user_id: string;
  enabled: number;
  config_revision: number;
}

interface FeishuRestClient {
  im?: {
    message?: {
      create?: (input: unknown) => Promise<unknown>;
      reply?: (input: unknown) => Promise<unknown>;
    };
    messageReaction?: {
      create?: (input: unknown) => Promise<unknown>;
      delete?: (input: unknown) => Promise<unknown>;
    };
  };
}

export function createProductionFeishuChannelRuntime(input: {
  db: Database;
  masterKey: string;
  sessionManager: Pick<InMemorySessionManager, "captureHistory" | "listSessions" | "sendInput">;
}): FeishuChannelRuntime {
  const sdkFactory = new FeishuSdkFactory();
  const supervisor = new FeishuConnectionSupervisor({
    accounts: createAccountSource(input.db, input.masterKey),
    sdkFactory,
  });
  const scheduler = new MultiTenantAutomationRuntime(input.db, input.masterKey, input.sessionManager);

  const prepareAccount = (userId: string) => {
    supervisor.registerHandlers(userId, createFeishuSdkHandlers({
      db: input.db,
      masterKey: input.masterKey,
      userId,
    }));
  };

  for (const userId of listEnabledAccountUserIds(input.db)) prepareAccount(userId);
  return new FeishuChannelRuntime({
    supervisor,
    scheduler,
    prepareAccount,
    workers: [
      () => runIngressCycle(input.db, input.masterKey, input.sessionManager, sdkFactory),
      () => runDeliveryCycle(input.db, input.masterKey, sdkFactory),
    ],
    workerIntervalMs: 250,
  });
}

function createAccountSource(db: Database, masterKey: string) {
  const load = (row: AccountIdentityRow | undefined): FeishuSupervisorAccount | undefined => {
    if (!row) return undefined;
    const credentials = new FeishuChannelRepository(db, row.user_id, masterKey).decryptAccountCredentials(row.id);
    return {
      userId: row.user_id,
      accountId: row.id,
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      enabled: row.enabled === 1,
      configRevision: row.config_revision,
    };
  };
  return {
    listEnabled: () => (db.prepare(
      "SELECT id, user_id, enabled, config_revision FROM feishu_channel_accounts WHERE enabled = 1"
    ).all() as AccountIdentityRow[]).map(load).filter((account): account is FeishuSupervisorAccount => Boolean(account)),
    get: (userId: string) => load(db.prepare(
      "SELECT id, user_id, enabled, config_revision FROM feishu_channel_accounts WHERE user_id = ?"
    ).get(userId) as AccountIdentityRow | undefined),
    updateHealth: (userId: string, health: { accountId: string | null; state: string; lastConnectedAt: Date | null; lastErrorMessage: string | null }) => {
      if (!health.accountId) return;
      new FeishuChannelRepository(db, userId, masterKey).updateAccountHealth(health.accountId, {
        state: health.state,
        lastConnectedAt: health.lastConnectedAt,
        errorCode: health.lastErrorMessage ? "FEISHU_CONNECTION_ERROR" : null,
        errorMessage: health.lastErrorMessage,
      });
    },
  };
}

export function createFeishuSdkHandlers(input: { db: Database; masterKey: string; userId: string }) {
  const repository = new FeishuChannelRepository(input.db, input.userId, input.masterKey);
  const ingress = new FeishuIngressService(repository);
  const admit = (raw: unknown, eventType: "im.message.receive_v1" | "card.action.trigger") => {
    const account = repository.getAccount();
    if (!account?.enabled) return;
    const normalized = normalizeFeishuEvent(raw, { accountId: account.id, eventType });
    if (!normalized) return;
    ingress.admit(normalized);
    // Feishu renders this response synchronously, while the durable worker performs authorization and execution.
    if (normalized.kind === "card_action") return renderFeishuCardActionAcceptedResponse();
  };
  return {
    onMessage: (raw: unknown) => admit(raw, "im.message.receive_v1"),
    onCardAction: (raw: unknown) => admit(raw, "card.action.trigger"),
  };
}

async function runIngressCycle(
  db: Database,
  masterKey: string,
  sessionManager: Pick<InMemorySessionManager, "captureHistory" | "listSessions" | "sendInput">,
  sdkFactory: FeishuSdkFactory
): Promise<void> {
  for (const userId of listEnabledAccountUserIds(db)) {
    const repository = new FeishuChannelRepository(db, userId, masterKey);
    const worker = new FeishuIngressWorker(repository, {
      process: (item) => processInboxItem({ db, masterKey, sessionManager, sdkFactory, userId, repository, item }),
    });
    await worker.runOnce();
  }
}

async function processInboxItem(input: {
  db: Database;
  masterKey: string;
  sessionManager: Pick<InMemorySessionManager, "captureHistory" | "listSessions" | "sendInput">;
  sdkFactory: FeishuSdkFactory;
  userId: string;
  repository: FeishuChannelRepository;
  item: FeishuInboxItem & { content: string };
}): Promise<{ conversationId: string }> {
  const retained = parseRetainedContent(input.item.content);
  const copilotRepository = new CopilotRepository(input.db, input.userId);
  const orchestrator = new CopilotOrchestrator({
    db: input.db,
    masterKey: input.masterKey,
    sessionManager: input.sessionManager,
  });
  const pendingBridge = createPendingActionBridge({ ...input, copilotRepository, orchestrator });
  if (retained.kind === "card_action") {
    if (!input.item.senderOpenId || !retained.actionId) throw new Error("FEISHU_CARD_ACTION_INVALID");
    const decision = await pendingBridge.handleCardAction({
      kind: "card_action",
      accountId: input.item.accountId,
      eventId: input.item.eventId,
      chatId: input.item.chatId,
      ...(retained.cardMessageId ? { messageId: retained.cardMessageId } : {}),
      senderOpenId: input.item.senderOpenId,
      actionId: retained.actionId,
      laneKey: input.item.laneKey
    });
    enqueuePendingDecision(input.repository, input.item.accountId, input.item.chatId, undefined, decision);
    return { conversationId: `action:${decision.actionId}` };
  }
  if (retained.kind !== "message" || !input.item.messageId || !input.item.senderOpenId) {
    throw new Error("FEISHU_INBOUND_MESSAGE_INVALID");
  }
  const event: FeishuInboundMessage = {
    kind: "message",
    accountId: input.item.accountId,
    eventId: input.item.eventId,
    messageId: input.item.messageId,
    chatId: input.item.chatId,
    chatType: retained.chatType,
    ...(input.item.threadId ? { threadId: input.item.threadId } : {}),
    senderOpenId: input.item.senderOpenId,
    text: retained.text,
    mentionedBot: retained.mentionedBot,
    laneKey: input.item.laneKey,
  };
  const bindingService = new FeishuConversationBindingService({
    userId: input.userId,
    channelRepository: input.repository,
    integrationRepository: new FeishuIntegrationRepository(input.db, input.userId),
    copilotRepository,
  });
  const reactionLifecycle = createTypingReactionLifecycle({
    repository: input.repository,
    sdkFactory: input.sdkFactory,
    accountId: event.accountId,
    userId: input.userId,
  });
  const dispatcher = new FeishuCopilotInboundDispatcher({
    userId: input.userId,
    bindingService,
    copilotRepository,
    reactionLifecycle,
    recoverRun: (inbound) => recoverFeishuRun(copilotRepository, inbound),
    handlePendingDecision: async (binding, inbound) => {
      const decision = await pendingBridge.handleMessageDecision(binding, inbound);
      if (!decision) return undefined;
      enqueuePendingDecision(
        input.repository,
        inbound.accountId,
        inbound.chatId,
        inbound.threadId,
        decision,
        inbound.messageId
      );
      return { runId: decision.runId };
    },
    afterPersist: async ({ runId, assistantMessages }) => {
      const parts: FeishuDeliveryPart[] = [
        ...assistantMessages.slice(0, 19).map((content) => ({ type: "text" as const, content })),
        ...pendingBridge.createApprovalParts(event, runId)
      ];
      if (parts.length === 0) return;
      new FeishuDeliveryService(input.repository).enqueue({
        accountId: event.accountId,
        idempotencyKey: `copilot:${runId}`,
        chatId: event.chatId,
        ...(event.threadId ? { threadId: event.threadId } : {}),
        parts,
      });
    },
    runText: async (runInput) => {
      const result = await orchestrator.runText({
        ...runInput,
        sourceIdempotencyKey: feishuSourceIdempotencyKey(event)
      });
      return toFeishuCopilotTurn(result);
    },
  });
  const result = await dispatcher.dispatch(event);
  if (!result.ok) return { conversationId: `rejected:${result.reasonCode}` };
  return { conversationId: result.conversationId };
}

function createPendingActionBridge(input: {
  db: Database;
  masterKey: string;
  userId: string;
  repository: FeishuChannelRepository;
  sessionManager: Pick<InMemorySessionManager, "captureHistory" | "listSessions" | "sendInput">;
  copilotRepository: CopilotRepository;
  orchestrator: CopilotOrchestrator;
}): FeishuPendingActionBridge {
  return new FeishuPendingActionBridge({
    userId: input.userId,
    channelRepository: input.repository,
    copilotRepository: input.copilotRepository,
    executePendingAction: async (action) => {
      if (action.type !== "openforge.propose_session_input") {
        return { error: { code: "COPILOT_PENDING_ACTION_UNSUPPORTED", message: "This action is not supported from Feishu" } };
      }
      return await executeCopilotSessionInput(action, {
        db: input.db,
        userId: input.userId,
        sessionManager: input.sessionManager,
        trackingDelaysMs: feishuSessionInputTrackingDelaysMs
      });
    },
    describePendingAction: (action) => describeSessionInputApproval(input.db, input.userId, action),
    continueRun: async ({ action, result }) => {
      const beforeSequence = input.copilotRepository.listEvents(action.runId).at(-1)?.sequence ?? 0;
      const continuation = await input.orchestrator.continueAfterApprovedAction({
        userId: input.userId,
        runId: action.runId,
        action,
        result
      });
      if (!continuation) throw new Error("COPILOT_APPROVAL_CONTINUATION_UNAVAILABLE");
      return {
        runId: continuation.run.id,
        status: continuation.run.status,
        assistantMessages: extractAssistantMessages(
          continuation.events.filter((event) => event.sequence > beforeSequence)
        )
      };
    }
  });
}

function describeSessionInputApproval(db: Database, userId: string, action: CopilotPendingAction): string {
  if (action.type !== "openforge.propose_session_input") return pendingActionFallback();
  const sessionId = typeof action.input.sessionId === "string" ? action.input.sessionId : "unknown";
  const session = new SessionRepository(db, userId).getById(sessionId);
  const rawInput = typeof action.input.input === "string" ? action.input.input : "";
  const safeInput = redactCopilotText(rawInput).replace(/\s+/gu, " ").trim().slice(0, 240);
  const operation = safeInput
    ? `发送并提交：${safeInput}`
    : "按下 Enter，确认目标终端当前高亮选项";
  return [
    `**项目** ${session?.projectName ?? "未知项目"}`,
    `**会话** ${session?.name ?? "未知会话"} · ${session?.aiTool ?? "未知 CLI"} · ${sessionId}`,
    `**本次操作** ${operation}`,
    "",
    "此审批仅作用于当前这一项权限请求；后续新权限请求会再次单独审批。"
  ].join("\n");
}

function pendingActionFallback(): string {
  return [
    "Copilot 请求执行一个受控平台操作。",
    "",
    "此审批仅作用于当前这一项操作；后续新操作会再次单独审批。"
  ].join("\n");
}

function enqueuePendingDecision(
  repository: FeishuChannelRepository,
  accountId: string,
  chatId: string,
  threadId: string | undefined,
  decision: FeishuPendingDecisionResult,
  messageId?: string
): void {
  new FeishuDeliveryService(repository).enqueue({
    accountId,
    idempotencyKey: messageId
      ? `copilot:decision-message:${messageId}`
      : `copilot:decision-action:${decision.actionId}`,
    chatId,
    ...(threadId ? { threadId } : {}),
    parts: decision.parts
  });
}

function recoverFeishuRun(
  repository: CopilotRepository,
  event: FeishuInboundMessage
): { runId: string; assistantMessages: string[] } | undefined {
  const run = repository.findRunBySourceIdempotencyKey("feishu", feishuSourceIdempotencyKey(event));
  if (!run) return undefined;
  if (run.status === "queued" || run.status === "running") throw new Error("COPILOT_BUSY");
  const assistantMessages = extractAssistantMessages(repository.listEvents(run.id));
  if (run.status === "failed" || run.status === "cancelled") {
    return {
      runId: run.id,
      assistantMessages: appendFeishuFailureMessage(assistantMessages, run.errorCode ?? "copilot_run_failed")
    };
  }
  return {
    runId: run.id,
    assistantMessages
  };
}

export function toFeishuCopilotTurn(result: RunCopilotTextResult): {
  runId: string;
  assistantMessages: string[];
} {
  const assistantMessages = extractAssistantMessages(result.events);
  return {
    runId: result.run.id,
    assistantMessages: result.ok
      ? assistantMessages
      : appendFeishuFailureMessage(assistantMessages, result.error.code)
  };
}

function appendFeishuFailureMessage(messages: string[], errorCode: string): string[] {
  const message = errorCode === "copilot_tool_validation_failed"
    ? "这次请求未能完成：生成的操作参数不符合要求，未执行任何操作。请重新描述操作或明确指定目标会话。"
    : errorCode === "copilot_run_cancelled"
      ? "这次请求已取消，未继续执行操作。"
      : "这次请求处理失败，未完成相关操作。请稍后重试；如果持续失败，请在设置页检查 Copilot 与飞书连接状态。";
  return [...messages, message];
}

function feishuSourceIdempotencyKey(event: FeishuInboundMessage): string {
  return `${event.accountId}:${event.messageId}`;
}

function extractAssistantMessages(events: Array<{ type: string; message: string | null }>): string[] {
  const messages = events
    .filter((event) => event.type === "assistant_message" && event.message)
    .map((event) => event.message as string);
  // Tool-loop narration is useful in Web streaming but becomes noisy, repetitive chat bubbles in Feishu.
  return messages.length ? [messages.at(-1) as string] : [];
}

function createTypingReactionLifecycle(input: {
  repository: FeishuChannelRepository;
  sdkFactory: FeishuSdkFactory;
  accountId: string;
  userId: string;
}): FeishuTypingReactionLifecycle {
  return new FeishuTypingReactionLifecycle({
    createClient: () => {
      const account = input.repository.getAccount(input.accountId);
      if (!account?.enabled) throw new Error("FEISHU_ACCOUNT_DISABLED");
      const credentials = input.repository.decryptAccountCredentials(account.id);
      return input.sdkFactory.createRestClient({
        userId: input.userId,
        accountId: account.id,
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        configRevision: account.configRevision,
      }) as FeishuRestClient;
    },
    onDiagnostic: ({ action, message }) => {
      console.warn(JSON.stringify({
        level: "warn",
        action: `feishu.typing_reaction.${action}`,
        userId: input.userId,
        accountId: input.accountId,
        error: message,
        timestamp: new Date().toISOString(),
      }));
    },
  });
}

async function runDeliveryCycle(db: Database, masterKey: string, sdkFactory: FeishuSdkFactory): Promise<void> {
  for (const userId of listEnabledAccountUserIds(db)) {
    const repository = new FeishuChannelRepository(db, userId, masterKey);
    const worker = new FeishuDeliveryWorker(repository, {
      send: (part, target) => sendFeishuPart(repository, sdkFactory, part, target),
    });
    await worker.runOnce();
  }
}

async function sendFeishuPart(
  repository: FeishuChannelRepository,
  sdkFactory: FeishuSdkFactory,
  part: FeishuDeliveryPart,
  target: { accountId: string; chatId: string; threadId: string | null }
): Promise<{ accepted: boolean; messageId?: string }> {
  const account = repository.getAccount(target.accountId);
  if (!account?.enabled) throw new FeishuDeliveryError("account disabled", { retryable: true, accepted: false });
  const credentials = repository.decryptAccountCredentials(account.id);
  const client = sdkFactory.createRestClient({
    userId: "delivery",
    accountId: account.id,
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    configRevision: account.configRevision,
  }) as FeishuRestClient;
  const msgType = part.type === "text" ? "text" : "interactive";
  const content = JSON.stringify(part.type === "text" ? { text: part.content } : part.content);
  const response = target.threadId && client.im?.message?.reply
    ? await client.im.message.reply({ path: { message_id: target.threadId }, data: { msg_type: msgType, content } })
    : await client.im?.message?.create?.({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: target.chatId, msg_type: msgType, content },
    });
  const messageId = readProviderMessageId(response);
  return { accepted: Boolean(response), ...(messageId ? { messageId } : {}) };
}

class MultiTenantAutomationRuntime {
  private readonly schedulers = new Map<string, CopilotAutomationScheduler>();

  constructor(
    private readonly db: Database,
    private readonly masterKey: string,
    private readonly sessionManager: Pick<InMemorySessionManager, "captureHistory" | "listSessions">
  ) {}

  async start(): Promise<void> {
    for (const userId of listAutomationUserIds(this.db)) await this.schedulerFor(userId).start();
  }

  stop(): void {
    for (const scheduler of this.schedulers.values()) scheduler.stop();
    this.schedulers.clear();
  }

  async reconcile(userId: string): Promise<void> {
    await this.schedulerFor(userId).reconcile();
  }

  async runNow(userId: string, automationId: string): Promise<unknown> {
    return this.schedulerFor(userId).runNow(automationId);
  }

  private schedulerFor(userId: string): CopilotAutomationScheduler {
    const existing = this.schedulers.get(userId);
    if (existing) return existing;
    const repository = new CopilotAutomationRepository(this.db, userId, this.masterKey);
    const runner = new CopilotAutomationRunner(repository, {
      listProjects: () => new ProjectRepository(this.db, userId).list().map((project) => ({ projectId: project.id, name: project.name })),
      generate: async ({ prompt, projects }) => {
        const context = projects.length ? `\n\nProjects:\n${projects.map((project) => `- ${project.name} (${project.projectId})`).join("\n")}` : "";
        const result = await new CopilotOrchestrator({
          db: this.db,
          masterKey: this.masterKey,
          sessionManager: this.sessionManager,
        }).runText({ userId, prompt: `${prompt}${context}`, source: "copilot" });
        if (!result.ok) throw new Error(result.error.code);
        return {
          content: result.events.filter((event) => event.type === "assistant_message" && event.message).map((event) => event.message).join("\n\n"),
          usageTokens: 0,
        };
      },
      enqueueDelivery: async (plan) => new FeishuDeliveryService(new FeishuChannelRepository(this.db, userId, this.masterKey)).enqueue(plan),
    });
    const scheduler = new CopilotAutomationScheduler(repository, { run: (runId) => runner.run(runId).then(() => undefined) });
    this.schedulers.set(userId, scheduler);
    return scheduler;
  }
}

function listEnabledAccountUserIds(db: Database): string[] {
  return (db.prepare("SELECT user_id FROM feishu_channel_accounts WHERE enabled = 1 ORDER BY user_id").all() as Array<{ user_id: string }>)
    .map((row) => row.user_id);
}

function listAutomationUserIds(db: Database): string[] {
  return (db.prepare("SELECT DISTINCT user_id FROM copilot_automations WHERE status != 'deleted'").all() as Array<{ user_id: string }>)
    .map((row) => row.user_id);
}

function parseRetainedContent(content: string): {
  kind: string;
  text: string;
  chatType: string;
  mentionedBot: boolean;
  actionId?: string;
  cardMessageId?: string;
} {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  return {
    kind: typeof parsed.kind === "string" ? parsed.kind : "unknown",
    text: typeof parsed.text === "string" ? parsed.text : "",
    chatType: typeof parsed.chatType === "string" ? parsed.chatType : "unknown",
    mentionedBot: parsed.mentionedBot === true,
    ...(typeof parsed.actionId === "string" ? { actionId: parsed.actionId } : {}),
    ...(typeof parsed.messageId === "string" ? { cardMessageId: parsed.messageId } : {})
  };
}

function readProviderMessageId(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const data = (response as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const message = record.message;
  const messageId = record.message_id ?? (message && typeof message === "object"
    ? (message as Record<string, unknown>).message_id
    : undefined);
  return typeof messageId === "string" && messageId ? messageId : undefined;
}
