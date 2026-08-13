import type { FeishuInboundEvent } from "./feishu-event-normalizer.js";

interface InboxAdmissionRepository {
  admitInbox(input: {
    accountId: string;
    eventId: string;
    messageId?: string;
    eventType: string;
    laneKey: string;
    chatId: string;
    threadId?: string;
    senderOpenId?: string;
    content: string;
    retentionUntil: Date;
  }): { admitted: true; id: string } | { admitted: false; reason: "duplicate_event" };
}

export class FeishuIngressService {
  constructor(
    private readonly repository: InboxAdmissionRepository,
    private readonly options: { terminateSocket?: () => void; retentionMs?: number } = {}
  ) {}

  admit(event: FeishuInboundEvent) {
    try {
      const retainedContent = event.kind === "message"
        ? JSON.stringify({ kind: event.kind, text: event.text, chatType: event.chatType, mentionedBot: event.mentionedBot })
        : JSON.stringify({ kind: event.kind, actionId: event.actionId, messageId: event.messageId });
      return this.repository.admitInbox({
        accountId: event.accountId,
        eventId: event.eventId,
        ...(event.kind === "message" ? { messageId: event.messageId } : {}),
        eventType: event.kind,
        laneKey: event.laneKey,
        chatId: event.chatId,
        ...(event.kind === "message" && event.threadId ? { threadId: event.threadId } : {}),
        senderOpenId: event.senderOpenId,
        content: retainedContent,
        retentionUntil: new Date(Date.now() + (this.options.retentionMs ?? 7 * 24 * 60 * 60 * 1_000))
      });
    } catch (error) {
      // Closing the current socket cycle is the only safe acknowledgement when durable admission fails.
      this.options.terminateSocket?.();
      throw error;
    }
  }
}
