import type { Database } from "../../db/types.js";
import { TelegramChannelRepository } from "../../db/repositories/telegram-channel-repository.js";
import { assertResolvedPublicHttpsEndpoint } from "../network-policy.js";
import type { NativeChannelSender } from "../channels/native-channel-delivery.js";
import { TelegramApiError, TelegramBotApi, type TelegramBotApiIO } from "./telegram-bot-api.js";

const maxLength = 4096;

function chunkText(text: string): string[] {
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut <= 0) cut = maxLength;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining) parts.push(remaining);
  return parts;
}

/**
 * Plain-text sends only (no parse_mode). A 429 or any non-definitive outcome
 * is reported as `unknown` so the delivery ledger never claims success.
 */
export function createTelegramNativeSender(db: Database, userId: string, key: string, io: TelegramBotApiIO = {}): NativeChannelSender {
  return async (input) => {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]);
    const authorize = (): void => { signal.throwIfAborted(); input.authorize(); };
    const credentials = new TelegramChannelRepository(db, userId, key).decryptAccountCredentials(input.peer.accountId);
    const api = new TelegramBotApi({
      token: credentials.botToken,
      ...(io.fetch ? { fetch: io.fetch } : {}),
      ...(io.validate ? { validate: io.validate } : {})
    });
    const parts = chunkText(input.text);
    if (parts.length === 0) return { status: "delivered" };
    let lastMessageId = 0;
    try {
      for (const part of parts) {
        authorize();
        lastMessageId = await api.sendMessage(input.peer.chatId, part, signal);
      }
    } catch (error) {
      if (error instanceof TelegramApiError) {
        if (error.status === 429) return { status: "unknown" };
        if (error.status >= 400 && error.status < 500) return { status: "failed" };
      }
      return { status: "unknown" };
    }
    return { status: "delivered", messageId: String(lastMessageId) };
  };
}
