import type { NativeTelegramMessageEvent } from "../channels/native-channel-inbox.js";
import type { TelegramBotIdentity } from "./telegram-bot-api.js";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function computeMentionedBot(entities: unknown, text: string, bot: TelegramBotIdentity): boolean {
  if (Array.isArray(entities)) {
    for (const entity of entities) {
      if (typeof entity !== "object" || entity === null) continue;
      const record = entity as Record<string, unknown>;
      if (record.type === "text_mention") {
        const user = record.user;
        if (typeof user === "object" && user !== null && (user as { id?: unknown }).id === bot.id) return true;
      } else if (record.type === "mention" && typeof record.offset === "number" && typeof record.length === "number") {
        const match = text.slice(record.offset, record.offset + record.length).toLowerCase();
        if (bot.username !== null && match === `@${bot.username.toLowerCase()}`) return true;
      }
    }
  }
  if (bot.username === null) return false;
  return new RegExp(`@${escapeRegExp(bot.username)}(?![A-Za-z0-9_])`, "i").test(text);
}

/**
 * Loose-by-design: any update without a plain `message` with a non-empty
 * `text` from a human in a private/group/supergroup chat is ignored.
 */
export function normalizeTelegramUpdate(update: unknown, bot: TelegramBotIdentity): NativeTelegramMessageEvent | undefined {
  if (typeof update !== "object" || update === null) return undefined;
  const record = update as Record<string, unknown>;
  const updateId = record.update_id;
  if (typeof updateId !== "number") return undefined;
  const message = record.message;
  if (typeof message !== "object" || message === null) return undefined;
  const msg = message as Record<string, unknown>;
  const messageId = msg.message_id;
  if (typeof messageId !== "number") return undefined;
  const text = msg.text;
  if (typeof text !== "string" || text.length < 1 || text.length > 32000) return undefined;
  const from = msg.from;
  if (typeof from !== "object" || from === null) return undefined;
  const fromRecord = from as Record<string, unknown>;
  if (fromRecord.is_bot === true) return undefined;
  const senderId = fromRecord.id;
  if (typeof senderId !== "number") return undefined;
  const chat = msg.chat;
  if (typeof chat !== "object" || chat === null) return undefined;
  const chatRecord = chat as Record<string, unknown>;
  const chatId = chatRecord.id;
  if (typeof chatId !== "number") return undefined;
  let chatType: "p2p" | "group";
  if (chatRecord.type === "private") chatType = "p2p";
  else if (chatRecord.type === "group" || chatRecord.type === "supergroup") chatType = "group";
  else return undefined;
  return {
    kind: "message",
    eventId: `tg:${updateId}`,
    messageId: String(messageId),
    chatId: String(chatId),
    chatType,
    senderId: String(senderId),
    text,
    mentionedBot: computeMentionedBot(msg.entities, text, bot)
  };
}
