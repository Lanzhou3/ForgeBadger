import type { Database } from "../../db/types.js";
import { FeishuChannelRepository } from "../../db/repositories/feishu-channel-repository.js";
import {
  PortfolioFeishuChannelRepository,
  type PortfolioFeishuIngressEvent
} from "../../db/repositories/portfolio-feishu-channel-repository.js";
import { PortfolioFeishuRegistryRepository } from "../../db/repositories/portfolio-feishu-registry-repository.js";
import { PortfolioRepository, digestPortfolioValue } from "../../db/repositories/portfolio-repository.js";
import { FeishuChannelRuntime } from "./feishu-channel-runtime.js";
import {
  FeishuConnectionSupervisor,
  type FeishuSupervisorAccount
} from "./feishu-connection-supervisor.js";
import { renderFeishuCardActionAcceptedResponse } from "./feishu-card-renderer.js";
import { normalizeFeishuEvent } from "./feishu-event-normalizer.js";
import { FeishuSdkFactory, type FeishuSdkEventContext } from "./feishu-sdk.js";
import { PortfolioFeishuCardActionService } from "../portfolio/feishu/card-action-service.js";
import {
  PortfolioFeishuIngressSelector,
  type FeishuIngressSelection,
  type VerifiedFeishuIngress
} from "../portfolio/feishu/ingress-selector.js";
import { PortfolioFeishuOutboxService } from "../portfolio/feishu/outbox-service.js";
import { PortfolioFeishuRequirementCaptureService } from "../portfolio/feishu/requirement-capture-service.js";
import { PortfolioFeishuOwnerDecisionService } from "../portfolio/feishu/owner-decision-service.js";
import { buildAgentStack, type AgentStackDeps } from "../agent/agent-stack.js";
import { createFeishuCopilotChannel, type FeishuCopilotChannel } from "./feishu-copilot-channel.js";

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
      patch?: (input: unknown) => Promise<unknown>;
    };
    messageReaction?: {
      create?: (input: unknown) => Promise<unknown>;
      delete?: (input: unknown) => Promise<unknown>;
    };
  };
}

const FEISHU_CARD_MAX_BYTES = 30 * 1024;

/**
 * One transport still owns Feishu connectivity, but its only workflow handler
 * after Cutover is Portfolio. It has no model, terminal-input, or automation
 * dependency.
 */
export function createProductionFeishuChannelRuntime(input: {
  db: Database;
  masterKey: string;
}): FeishuChannelRuntime {
  const sdkFactory = new FeishuSdkFactory();
  const providerRegistry = new PortfolioFeishuRegistryRepository(input.db);
  const supervisor = new FeishuConnectionSupervisor({
    accounts: createAccountSource(input.db, input.masterKey, providerRegistry),
    sdkFactory
  });
  let runtime: FeishuChannelRuntime;
  const prepareAccount = (userId: string) => {
    supervisor.registerHandlers(userId, createFeishuSdkHandlers({
      db: input.db,
      masterKey: input.masterKey,
      userId,
      providerRegistry,
      // Copilot routing is armed once the gateway app attaches agent deps.
      resolveAgentDeps: () => runtime.getAgentDeps(),
      buildAgentStack,
      sdkFactory
    }));
  };

  for (const userId of listEnabledAccountUserIds(input.db)) prepareAccount(userId);
  runtime = new FeishuChannelRuntime({
    supervisor,
    prepareAccount,
    workers: [() => runPortfolioDeliveryCycle(input.db, input.masterKey, sdkFactory)],
    workerIntervalMs: 250
  });
  return runtime;
}

function createAccountSource(
  db: Database,
  masterKey: string,
  providerRegistry: PortfolioFeishuRegistryRepository
) {
  const load = (row: AccountIdentityRow | undefined): FeishuSupervisorAccount | undefined => {
    if (!row) return undefined;
    const credentials = new FeishuChannelRepository(db, row.user_id, masterKey)
      .decryptAccountCredentials(row.id);
    try {
      ensurePortfolioHandler(providerRegistry, row.user_id, credentials.appId);
    } catch {
      // A global collision must not create a competing connection.
      return undefined;
    }
    return {
      userId: row.user_id,
      accountId: row.id,
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      enabled: row.enabled === 1,
      configRevision: row.config_revision
    };
  };
  return {
    listEnabled: () => (db.prepare(
      "SELECT id, user_id, enabled, config_revision FROM feishu_channel_accounts WHERE enabled = 1"
    ).all() as AccountIdentityRow[]).map(load).filter((account): account is FeishuSupervisorAccount => Boolean(account)),
    get: (userId: string) => load(db.prepare(
      "SELECT id, user_id, enabled, config_revision FROM feishu_channel_accounts WHERE user_id = ?"
    ).get(userId) as AccountIdentityRow | undefined),
    updateHealth: (userId: string, health: {
      accountId: string | null;
      state: string;
      lastConnectedAt: Date | null;
      lastErrorMessage: string | null;
    }) => {
      if (!health.accountId) return;
      new FeishuChannelRepository(db, userId, masterKey).updateAccountHealth(health.accountId, {
        state: health.state,
        lastConnectedAt: health.lastConnectedAt,
        errorCode: health.lastErrorMessage ? "FEISHU_CONNECTION_ERROR" : null,
        errorMessage: health.lastErrorMessage
      });
    }
  };
}

/**
 * Long-connection ingress: Portfolio-bound chats stay on the Portfolio flow;
 * unbound chats route their messages into the Copilot conversation channel.
 */
export function createFeishuSdkHandlers(input: {
  db: Database;
  masterKey: string;
  userId: string;
  providerRegistry?: PortfolioFeishuRegistryRepository;
  resolveAgentDeps?: () => AgentStackDeps | undefined;
  buildAgentStack?: typeof buildAgentStack;
  sdkFactory?: FeishuSdkFactory;
}) {
  const credentialsRepository = new FeishuChannelRepository(input.db, input.userId, input.masterKey);
  const registry = input.providerRegistry ?? new PortfolioFeishuRegistryRepository(input.db);
  const selector = createPortfolioIngressSelector(input.db, registry);
  const copilotChannel = (): FeishuCopilotChannel | undefined => {
    const deps = input.resolveAgentDeps?.();
    const account = credentialsRepository.getAccount();
    const providerAccount = account ? registry.resolve("feishu", account.appId) : undefined;
    if (!deps || !input.buildAgentStack || !input.sdkFactory || !account || !providerAccount) return undefined;
    const sdkFactory = input.sdkFactory as FeishuSdkFactory;
    return createFeishuCopilotChannel({
      deps,
      buildAgentStack: input.buildAgentStack,
      providerAccountId: providerAccount.id,
      sendMessage: ({ chatId, text }) => sendFeishuChatText({
        db: input.db,
        masterKey: input.masterKey,
        sdkFactory,
        userId: input.userId,
        chatId,
        text
      }),
      cardTransport: {
        sendCard: (chatId, card) => sendFeishuChatCard({
          db: input.db,
          masterKey: input.masterKey,
          sdkFactory,
          userId: input.userId,
          chatId,
          card
        }),
        updateCard: (messageId, card) => updateFeishuChatCard({
          db: input.db,
          masterKey: input.masterKey,
          sdkFactory,
          userId: input.userId,
          messageId,
          card
        })
      },
      userId: input.userId,
      reactions: {
        start: async (mid) => {
          const repository = new FeishuChannelRepository(input.db, input.userId, input.masterKey);
          const account = repository.getAccount();
          if (!account?.enabled) return { reactionId: null };
          const credentials = repository.decryptAccountCredentials(account.id);
          const client = sdkFactory.createRestClient({
            userId: "copilot-typing", accountId: account.id, appId: credentials.appId,
            appSecret: credentials.appSecret, configRevision: account.configRevision
          }) as FeishuRestClient;
          const response = await client.im?.messageReaction?.create?.({
            path: { message_id: mid },
            data: { reaction_type: { emoji_type: "Typing" } }
          });
          const data = (response as { data?: { reaction_id?: string } } | undefined)?.data;
          return { reactionId: data?.reaction_id ?? null };
        },
        stop: async (state) => {
          if (!state.reactionId) return;
          const repository = new FeishuChannelRepository(input.db, input.userId, input.masterKey);
          const account = repository.getAccount();
          if (!account?.enabled) return;
          const credentials = repository.decryptAccountCredentials(account.id);
          const client = sdkFactory.createRestClient({
            userId: "copilot-typing", accountId: account.id, appId: credentials.appId,
            appSecret: credentials.appSecret, configRevision: account.configRevision
          }) as FeishuRestClient;
          await client.im?.messageReaction?.delete?.({ path: { reaction_id: state.reactionId } });
        }
      },
      transport: "long_connection"
    });
  };
  const admit = (
    raw: unknown,
    eventType: "im.message.receive_v1" | "card.action.trigger",
    context?: FeishuSdkEventContext
  ) => {
    const account = credentialsRepository.getAccount();
    if (!account?.enabled) return;
    const normalized = normalizeFeishuEvent(raw, {
      accountId: account.id,
      eventType,
      ...(context ? { botOpenId: context.botOpenId } : {})
    });
    if (!normalized) return;
    try {
      ensurePortfolioHandler(registry, input.userId, account.appId);
      const event = toVerifiedPortfolioIngress(normalized, account.appId, "long_connection");
      const channel = copilotChannel();
      routeVerifiedFeishuIngress({
        db: input.db,
        masterKey: input.masterKey,
        userId: input.userId,
        registry,
        selector,
        event,
        kind: normalized.kind,
        ...(normalized.kind === "message"
          ? {
              text: normalized.text,
              ...(normalized.messageId ? { copilotMeta: { messageId: normalized.messageId, ...(normalized.chatType ? { chatType: normalized.chatType } : {}), mentionedBot: normalized.mentionedBot } } : {})
            }
          : { actionToken: normalized.actionId }),
        ...(normalized.kind === "card_action" && normalized.value
          ? { cardAction: { value: normalized.value, ...(normalized.messageId ? { messageId: normalized.messageId } : {}) } }
          : {}),
        ...(channel ? { copilotChannel: channel } : {})
      });
      return normalized.kind === "card_action" ? renderFeishuCardActionAcceptedResponse() : undefined;
    } catch {
      // The router persists a safe rejection. Card acknowledgement prevents
      // provider retries from becoming a second delivery channel.
      return normalized.kind === "card_action" ? renderFeishuCardActionAcceptedResponse() : undefined;
    }
  };
  return {
    onMessage: (raw: unknown, context?: FeishuSdkEventContext) =>
      admit(raw, "im.message.receive_v1", context),
    onCardAction: (raw: unknown) => admit(raw, "card.action.trigger")
  };
}

/**
 * Shared ingress router for both transports (long connection and webhook).
 * An active Portfolio channel binding keeps the chat on the Portfolio flow;
 * unbound messages go to the Copilot channel, and unbound card clicks remain
 * durable no-ops so provider retries never become a second delivery channel.
 */
export function routeVerifiedFeishuIngress(input: {
  db: Database;
  masterKey: string;
  userId: string;
  registry: PortfolioFeishuRegistryRepository;
  selector: PortfolioFeishuIngressSelector;
  event: VerifiedFeishuIngress;
  kind: "message" | "card_action";
  text?: string;
  actionToken?: string;
  /** Button value payload + origin message id for copilot approval cards. */
  cardAction?: { value: Record<string, unknown>; messageId?: string };
  /** Message-scoped metadata for the copilot channel (typing + group gate). */
  copilotMeta?: { messageId: string; chatType?: string; mentionedBot?: boolean };
  copilotChannel?: FeishuCopilotChannel;
}): "portfolio" | "copilot" | "unhandled" {
  const providerAccount = input.registry.resolve(input.event.provider, input.event.providerAccountId);
  if (!providerAccount || providerAccount.lifecycleState !== "verified") throw new Error("PORTFOLIO_FEISHU_ACCOUNT_NOT_ELIGIBLE");
  const channel = new PortfolioFeishuChannelRepository(input.db, input.userId);
  const binding = channel.resolveActiveBinding({
    providerAccountId: providerAccount.id,
    externalIdentity: input.event.externalIdentity,
    conversationId: input.event.conversationId
  });
  if (!binding) {
    if (input.kind === "message" && input.copilotChannel) {
      const ingress = {
        chatId: input.event.conversationId,
        text: input.text ?? "",
        providerEventId: input.event.providerEventId,
        senderIdentity: input.event.externalIdentity,
        ...(input.copilotMeta ?? {})
      };
      // Ledger admission runs synchronously on the ack path: a ledger failure
      // throws, the delivery is rejected, and the provider retries instead of
      // the message being silently dropped.
      if (!input.copilotChannel.admitMessage(ingress)) return "copilot";
      // A full Copilot turn must not block ingress acknowledgement.
      void input.copilotChannel.processMessage(ingress).catch(() => {
        console.error("[feishu-copilot] background processing failed", {
          code: "FEISHU_COPILOT_PROCESS_FAILED",
          transport: input.event.transport
        });
      });
      return "copilot";
    }
    if (input.kind === "card_action" && input.copilotChannel && input.cardAction) {
      // Copilot decision buttons carry their routing payload inside the card
      // value; admission dedups provider retries of the same callback event.
      const admitted = input.copilotChannel.admitCardAction({
        chatId: input.event.conversationId,
        senderIdentity: input.event.externalIdentity,
        providerEventId: input.event.providerEventId,
        value: input.cardAction.value
      });
      if (!admitted) return "copilot";
      void input.copilotChannel
        .handleCardAction({
          chatId: input.event.conversationId,
          senderIdentity: input.event.externalIdentity,
          value: input.cardAction.value,
          ...(input.cardAction.messageId ? { messageId: input.cardAction.messageId } : {})
        })
        .catch(() => undefined);
      return "copilot";
    }
    channel.denyIngress({
      providerAccountId: providerAccount.id,
      providerEventId: input.event.providerEventId,
      transport: input.event.transport,
      handlerKind: "portfolio",
      rejectionCode: "PORTFOLIO_FEISHU_HANDLER_AMBIGUOUS",
      safeEnvelope: { provider: input.event.provider, eventType: input.kind }
    });
    return "unhandled";
  }
  const selection: FeishuIngressSelection = { handlerKind: "portfolio", account: providerAccount, binding };
  const admission = input.selector.admit(input.event, selection);
  if (!admission.admitted) return "portfolio";
  handlePortfolioIngress({
    db: input.db,
    userId: selection.account.userId,
    masterKey: input.masterKey,
    repository: new PortfolioFeishuChannelRepository(input.db, selection.account.userId),
    selection,
    event: input.event,
    admission: admission.event,
    ...(input.kind === "message"
      ? (input.text !== undefined ? { text: input.text } : {})
      : input.actionToken !== undefined ? { actionToken: input.actionToken } : {})
  });
  return "portfolio";
}

function ensurePortfolioHandler(
  registry: PortfolioFeishuRegistryRepository,
  userId: string,
  providerAccountId: string
): void {
  registry.register({ userId, provider: "feishu", providerAccountId });
}

/** Portfolio delivery retries only the persisted Outbox projection. */
async function runPortfolioDeliveryCycle(
  db: Database,
  masterKey: string,
  sdkFactory: FeishuSdkFactory
): Promise<void> {
  const userIds = db.prepare(`SELECT DISTINCT user_id FROM portfolio_delivery_records
    WHERE state IN ('pending', 'retry_scheduled')`).all() as Array<{ user_id: string }>;
  for (const { user_id: userId } of userIds) {
    const channel = new PortfolioFeishuChannelRepository(db, userId);
    const credentials = new FeishuChannelRepository(db, userId, masterKey);
    const account = credentials.getAccount();
    if (!account?.enabled) continue;
    const outbox = new PortfolioFeishuOutboxService(channel);
    for (const delivery of outbox.claim()) {
      const binding = channel.getBinding(delivery.bindingId);
      if (!binding) continue;
      try {
        const text = [delivery.summary.title, delivery.summary.status, delivery.summary.summary]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .join("\n");
        const result = await sendPortfolioText(credentials, sdkFactory, account.id, binding.conversationId, text);
        outbox.recordProviderResult({
          id: delivery.id,
          claimToken: delivery.claimToken ?? "",
          providerResult: { accepted: result.accepted, messageId: result.messageId ?? null },
          retryable: !result.accepted,
          ...(result.accepted ? {} : { errorCode: "FEISHU_PROVIDER_NOT_ACCEPTED" })
        });
      } catch {
        outbox.recordProviderResult({
          id: delivery.id,
          claimToken: delivery.claimToken ?? "",
          providerResult: {},
          errorCode: "FEISHU_PORTFOLIO_DELIVERY_FAILED",
          retryable: true
        });
      }
    }
  }
}

export function createPortfolioIngressSelector(
  db: Database,
  registry: PortfolioFeishuRegistryRepository
): PortfolioFeishuIngressSelector {
  return new PortfolioFeishuIngressSelector({
    registry,
    channelRepositoryFor: (userId) => new PortfolioFeishuChannelRepository(db, userId)
  });
}

export function toVerifiedPortfolioIngress(
  event: { eventId: string; chatId: string; senderOpenId: string; kind: "message" | "card_action" },
  providerAccountId: string,
  transport: "webhook" | "long_connection"
): VerifiedFeishuIngress {
  return {
    provider: "feishu",
    providerAccountId,
    providerEventId: event.eventId,
    transport,
    signatureVerified: true,
    externalIdentity: event.senderOpenId,
    conversationId: event.chatId,
    eventType: event.kind,
    safeEventMetadata: { source: transport, eventType: event.kind }
  };
}

export function handlePortfolioIngress(input: {
  db: Database;
  userId: string;
  masterKey: string;
  repository: PortfolioFeishuChannelRepository;
  selection: FeishuIngressSelection;
  event: VerifiedFeishuIngress;
  admission?: PortfolioFeishuIngressEvent;
  text?: string;
  actionToken?: string;
}): void {
  const decisions = createPortfolioDecisionResolver(input.db, input.userId);
  if (input.event.eventType === "message") {
    new PortfolioFeishuRequirementCaptureService({
      channelRepository: input.repository,
      requests: new PortfolioRepository(input.db, input.userId)
    }).capture({
      selection: input.selection,
      event: input.event,
      text: input.text ?? "",
      ...(input.admission ? { admission: input.admission } : {})
    });
    return;
  }
  if (!input.actionToken) throw new Error("PORTFOLIO_FEISHU_ACTION_TOKEN_INVALID");
  const cards = new PortfolioFeishuCardActionService({
    repository: input.repository,
    decisions,
    hmacSecret: input.masterKey
  });
  const decisionsService = new PortfolioFeishuOwnerDecisionService({
    db: input.db,
    userId: input.userId,
    channel: input.repository
  });
  cards.consumeAndApply({ token: input.actionToken, bindingId: input.selection.binding.id }, (action) => {
    return decisionsService.apply(action, input.selection.binding);
  });
}

function createPortfolioDecisionResolver(db: Database, userId: string) {
  const repository = new PortfolioRepository(db, userId);
  return {
    resolve(recordType: "authorization" | "intake_decision" | "acceptance_decision", recordId: string) {
      if (recordType === "authorization") {
        const record = repository.getAuthorization(recordId);
        return record ? canonicalDecision(recordType, recordId, userId, record, record.state === "awaiting_owner" ? ["approve"] : []) : undefined;
      }
      if (recordType === "intake_decision") {
        const record = repository.getIntakeDecision(recordId);
        return record ? canonicalDecision(recordType, recordId, userId, record,
          record.state === "awaiting_owner" && record.candidateProjectIds.length === 1 ? ["approve_single_candidate"] : []) : undefined;
      }
      const record = repository.getAcceptanceDecision(recordId);
      return record ? canonicalDecision(recordType, recordId, userId, record,
        record.state === "candidate" && record.decision === "accepted" ? ["accept"] : []) : undefined;
    }
  };
}

function canonicalDecision(
  recordType: "authorization" | "intake_decision" | "acceptance_decision",
  recordId: string,
  ownerUserId: string,
  record: { projectionVersion: number },
  allowedActionTypes: string[]
) {
  return {
    recordType,
    recordId,
    ownerUserId,
    projectionVersion: record.projectionVersion,
    payloadDigest: digestPortfolioValue(record),
    allowedActionTypes
  };
}

async function sendPortfolioText(
  repository: FeishuChannelRepository,
  sdkFactory: FeishuSdkFactory,
  accountId: string,
  chatId: string,
  text: string
): Promise<{ accepted: boolean; messageId?: string }> {
  const account = repository.getAccount(accountId);
  if (!account?.enabled) throw new Error("FEISHU_ACCOUNT_DISABLED");
  const credentials = repository.decryptAccountCredentials(account.id);
  const client = sdkFactory.createRestClient({
    userId: "portfolio-delivery",
    accountId: account.id,
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    configRevision: account.configRevision
  }) as FeishuRestClient;
  const response = await client.im?.message?.create?.({
    params: { receive_id_type: "chat_id" },
    data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) }
  });
  const accepted = Boolean(response)
    && typeof response === "object"
    && (response as { code?: unknown }).code === 0;
  const messageId = accepted ? readProviderMessageId(response) : undefined;
  return { accepted, ...(messageId ? { messageId } : {}) };
}

/** Send one text message to a chat as the user's enabled Feishu account (Copilot replies). */
export async function sendFeishuChatText(input: {
  db: Database;
  masterKey: string;
  sdkFactory: FeishuSdkFactory;
  userId: string;
  chatId: string;
  text: string;
}): Promise<void> {
  const repository = new FeishuChannelRepository(input.db, input.userId, input.masterKey);
  const account = repository.getAccount();
  if (!account?.enabled) throw new Error("FEISHU_ACCOUNT_DISABLED");
  const result = await sendPortfolioText(repository, input.sdkFactory, account.id, input.chatId, input.text);
  if (!result.accepted) throw new Error("FEISHU_PROVIDER_NOT_ACCEPTED");
}

/** Send one interactive card to a chat; returns the provider message id for in-place updates. */
export async function sendFeishuChatCard(input: {
  db: Database;
  masterKey: string;
  sdkFactory: FeishuSdkFactory;
  userId: string;
  chatId: string;
  card: unknown;
}): Promise<string | undefined> {
  const repository = new FeishuChannelRepository(input.db, input.userId, input.masterKey);
  const account = repository.getAccount();
  if (!account?.enabled) throw new Error("FEISHU_ACCOUNT_DISABLED");
  const credentials = repository.decryptAccountCredentials(account.id);
  const content = serializeFeishuCard(input.card, "FEISHU_CARD_SEND_FAILED");
  const client = input.sdkFactory.createRestClient({
    userId: "copilot-cards",
    accountId: account.id,
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    configRevision: account.configRevision
  }) as FeishuRestClient;
  const messageApi = client.im?.message;
  if (!messageApi?.create) throw new Error("FEISHU_CARD_SEND_FAILED");
  try {
    const response = await messageApi.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: input.chatId, msg_type: "interactive", content }
    });
    if (!response || typeof response !== "object" || (response as { code?: unknown }).code !== 0) {
      throw new Error("FEISHU_CARD_SEND_FAILED");
    }
    const messageId = readProviderMessageId(response)?.trim();
    if (!messageId) throw new Error("FEISHU_CARD_SEND_FAILED");
    return messageId;
  } catch {
    throw new Error("FEISHU_CARD_SEND_FAILED");
  }
}

/** Update an interactive card's content in place (streaming/finalize/resolved). */
export async function updateFeishuChatCard(input: {
  db: Database;
  masterKey: string;
  sdkFactory: FeishuSdkFactory;
  userId: string;
  messageId: string;
  card: unknown;
}): Promise<void> {
  const repository = new FeishuChannelRepository(input.db, input.userId, input.masterKey);
  const account = repository.getAccount();
  if (!account?.enabled) throw new Error("FEISHU_ACCOUNT_DISABLED");
  const credentials = repository.decryptAccountCredentials(account.id);
  const content = serializeFeishuCard(input.card, "FEISHU_CARD_UPDATE_FAILED");
  const client = input.sdkFactory.createRestClient({
    userId: "copilot-cards",
    accountId: account.id,
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    configRevision: account.configRevision
  }) as FeishuRestClient;
  const messageApi = client.im?.message;
  if (!messageApi?.patch) throw new Error("FEISHU_CARD_UPDATE_FAILED");
  try {
    const response = await messageApi.patch({
      path: { message_id: input.messageId },
      data: { content }
    });
    if (!response || typeof response !== "object" || (response as { code?: unknown }).code !== 0) {
      throw new Error("FEISHU_CARD_UPDATE_FAILED");
    }
  } catch {
    // Provider details can contain request metadata. Keep the channel-facing
    // failure stable and redacted so callers can safely choose a fallback.
    throw new Error("FEISHU_CARD_UPDATE_FAILED");
  }
}

function serializeFeishuCard(card: unknown, errorCode: string): string {
  try {
    const content = JSON.stringify(card);
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > FEISHU_CARD_MAX_BYTES) {
      throw new Error(errorCode);
    }
    return content;
  } catch {
    throw new Error(errorCode);
  }
}

function listEnabledAccountUserIds(db: Database): string[] {
  return (db.prepare("SELECT user_id FROM feishu_channel_accounts WHERE enabled = 1 ORDER BY user_id")
    .all() as Array<{ user_id: string }>).map((row) => row.user_id);
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
