export type FeishuInboundEvent = FeishuInboundMessage | FeishuInboundCardAction;

export interface FeishuInboundMessage {
  kind: "message";
  accountId: string;
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: string;
  threadId?: string;
  senderOpenId: string;
  text: string;
  mentionedBot: boolean;
  laneKey: string;
}

export interface FeishuInboundCardAction {
  kind: "card_action";
  accountId: string;
  eventId: string;
  chatId: string;
  messageId?: string;
  senderOpenId: string;
  actionId: string;
  /** Full button-value payload from an interactive card. */
  value?: Record<string, unknown>;
  laneKey: string;
}

export function normalizeFeishuEvent(
  envelope: unknown,
  options: { accountId: string; botOpenId?: string; eventType?: string }
): FeishuInboundEvent | undefined {
  if (!isRecord(envelope)) return undefined;
  // The official SDK dispatcher may provide either the full envelope or only the event payload.
  const header = isRecord(envelope.header) ? envelope.header : undefined;
  const event = isRecord(envelope.event) ? envelope.event : envelope;
  const eventId = header ? readString(header.event_id) : deriveEventId(event, options.eventType);
  const eventType = header ? readString(header.event_type) : options.eventType;
  if (!eventId || !eventType) return undefined;
  if (eventType === "im.message.receive_v1") {
    return normalizeMessage(event, eventId, options);
  }
  if (eventType === "card.action.trigger") {
    return normalizeCardAction(event, eventId, options.accountId);
  }
  return undefined;
}

function deriveEventId(event: Record<string, unknown>, eventType: string | undefined): string | undefined {
  if (eventType === "im.message.receive_v1" && isRecord(event.message)) {
    const messageId = readString(event.message.message_id);
    return messageId ? `message:${messageId}` : undefined;
  }
  if (eventType === "card.action.trigger" && isRecord(event.action) && isRecord(event.action.value)) {
    const actionId = readString(event.action.value.action_id);
    const token = readString(event.token) ?? readString(event.open_message_id);
    return actionId ? `card:${actionId}:${token ?? "callback"}` : undefined;
  }
  return undefined;
}

function normalizeMessage(
  event: Record<string, unknown>,
  eventId: string,
  options: { accountId: string; botOpenId?: string }
): FeishuInboundMessage | undefined {
  const message = isRecord(event.message) ? event.message : undefined;
  const sender = isRecord(event.sender) ? event.sender : undefined;
  const senderId = sender && isRecord(sender.sender_id) ? sender.sender_id : undefined;
  if (!message || !senderId || message.message_type !== "text") return undefined;
  const messageId = readString(message.message_id);
  const chatId = readString(message.chat_id);
  const senderOpenId = readString(senderId.open_id);
  const text = parseText(message.content);
  if (!messageId || !chatId || !senderOpenId || !text) return undefined;
  const threadId = readString(message.thread_id) ?? readString(message.root_id);
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const mentionedBot = options.botOpenId
    ? mentions.some((mention) => isRecord(mention) && isRecord(mention.id)
      && readString(mention.id.open_id) === options.botOpenId)
    : false;
  return {
    kind: "message",
    accountId: options.accountId,
    eventId,
    messageId,
    chatId,
    chatType: readString(message.chat_type) ?? "unknown",
    ...(threadId ? { threadId } : {}),
    senderOpenId,
    text,
    mentionedBot,
    laneKey: `${chatId}:${threadId ?? "root"}`
  };
}

function normalizeCardAction(
  event: Record<string, unknown>,
  eventId: string,
  accountId: string
): FeishuInboundCardAction | undefined {
  const operator = isRecord(event.operator) ? event.operator : undefined;
  const context = isRecord(event.context) ? event.context : undefined;
  const action = isRecord(event.action) ? event.action : undefined;
  const value = action && isRecord(action.value) ? action.value : undefined;
  const senderOpenId = operator ? readString(operator.open_id) : undefined;
  const chatId = context ? readString(context.open_chat_id) : undefined;
  const messageId = context ? readString(context.open_message_id) : undefined;
  const actionId = value ? readString(value.action_id) : undefined;
  if (!senderOpenId || !chatId || !actionId) return undefined;
  return {
    kind: "card_action",
    accountId,
    eventId,
    chatId,
    ...(messageId ? { messageId } : {}),
    senderOpenId,
    actionId,
    ...(value ? { value } : {}),
    laneKey: `${chatId}:card`
  };
}

function parseText(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? readString(parsed.text) : undefined;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
