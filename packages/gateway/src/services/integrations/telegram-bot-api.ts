import { z } from "zod";

import { assertResolvedPublicHttpsEndpoint } from "../network-policy.js";

export interface TelegramBotIdentity {
  id: number;
  username: string | null;
  firstName: string;
}

export interface TelegramBotApiIO {
  fetch?: typeof fetch;
  validate?: typeof assertResolvedPublicHttpsEndpoint;
}

export class TelegramApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const errorSchema = z.object({
  ok: z.literal(false),
  error_code: z.number().int(),
  description: z.string(),
  parameters: z.object({ retry_after: z.number().positive().optional() }).optional()
}).passthrough();

const okSchema = z.object({ ok: z.literal(true), result: z.unknown() });

const getMeResultSchema = z.object({
  id: z.number().int(),
  is_bot: z.literal(true),
  first_name: z.string(),
  username: z.string().nullable()
}).passthrough();

const getUpdatesResultSchema = z.array(z.object({ update_id: z.number().int() }).passthrough());

const sendMessageResultSchema = z.object({ message_id: z.number().int() }).passthrough();

/**
 * Minimal pinned Bot API surface (getMe / getUpdates / sendMessage).
 * No retries inside a call: the polling client owns the retry loop and the
 * native sender maps outcomes for delivery accounting.
 */
export class TelegramBotApi {
  private readonly token: string;
  private readonly request: typeof fetch;
  private readonly validate: typeof assertResolvedPublicHttpsEndpoint;

  constructor(options: { token: string } & TelegramBotApiIO) {
    const token = options.token.trim();
    if (token.length < 1 || token.length > 256 || /\s/.test(token)) {
      throw new Error("TELEGRAM_BOT_TOKEN_INVALID");
    }
    this.token = token;
    this.request = options.fetch ?? fetch;
    this.validate = options.validate ?? assertResolvedPublicHttpsEndpoint;
  }

  private endpoint(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  private async call(method: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const endpoint = this.endpoint(method);
    await this.validate(endpoint);
    const response = await this.request(endpoint, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TelegramApiError(response.status, "TELEGRAM_RESPONSE_INVALID_JSON");
    }
    const error = errorSchema.safeParse(payload);
    if (error.success) {
      const retryAfter = error.data.parameters?.retry_after;
      throw new TelegramApiError(
        error.data.error_code,
        error.data.description,
        typeof retryAfter === "number" ? retryAfter : undefined
      );
    }
    if (!response.ok) throw new TelegramApiError(response.status, `TELEGRAM_HTTP_${response.status}`);
    const ok = okSchema.safeParse(payload);
    if (!ok.success) throw new TelegramApiError(200, "TELEGRAM_RESPONSE_INVALID_JSON");
    return ok.data.result;
  }

  async getMe(signal: AbortSignal): Promise<TelegramBotIdentity> {
    const result = await this.call("getMe", {}, signal);
    const parsed = getMeResultSchema.safeParse(result);
    if (!parsed.success) throw new TelegramApiError(200, "TELEGRAM_RESPONSE_INVALID_JSON");
    return { id: parsed.data.id, username: parsed.data.username, firstName: parsed.data.first_name };
  }

  async getUpdates(offset: number | undefined, timeoutSeconds: number, signal: AbortSignal): Promise<unknown[]> {
    const result = await this.call("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ["message"] }, signal);
    const parsed = getUpdatesResultSchema.safeParse(result);
    if (!parsed.success) throw new TelegramApiError(200, "TELEGRAM_RESPONSE_INVALID_JSON");
    return parsed.data;
  }

  async sendMessage(chatId: string, text: string, signal: AbortSignal): Promise<number> {
    const result = await this.call("sendMessage", { chat_id: chatId, text }, signal);
    const parsed = sendMessageResultSchema.safeParse(result);
    if (!parsed.success) throw new TelegramApiError(200, "TELEGRAM_RESPONSE_INVALID_JSON");
    return parsed.data.message_id;
  }
}
