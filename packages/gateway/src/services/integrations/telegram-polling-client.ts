import type { NativeTelegramMessageEvent } from "../channels/native-channel-inbox.js";
import { TelegramApiError, TelegramBotApi, type TelegramBotIdentity, type TelegramBotApiIO } from "./telegram-bot-api.js";
import { normalizeTelegramUpdate } from "./telegram-event-normalizer.js";

export interface TelegramPollingCallbacks {
  onReady?: (identity: TelegramBotIdentity) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  /** Reserved for the supervisor wiring; the client itself only fails via start(). */
  onError?: (error: Error) => void;
  onIdentity?: (identity: TelegramBotIdentity) => void;
}

export interface TelegramPollingHandlers {
  onMessage?: (event: NativeTelegramMessageEvent) => Promise<unknown> | unknown;
}

export interface TelegramPollingHandle {
  start(): Promise<void>;
  close(force?: boolean): void;
}

export interface TelegramPollingClientOptions extends TelegramBotApiIO {
  token: string;
  callbacks: TelegramPollingCallbacks;
  handlers: TelegramPollingHandlers;
  longPollTimeoutSeconds?: number;
  cursor?: { load(): number | undefined; save(nextOffset: number): void };
  requestTimeoutMs?: number;
  jitter?: () => number;
}

/**
 * Long-polling transport over getUpdates. Terminal API errors (401/403/...)
 * reject start() and let the supervisor own the retry lifecycle; 429 is
 * absorbed locally with the server-provided delay.
 */
export function createTelegramPollingClient(options: TelegramPollingClientOptions): TelegramPollingHandle {
  // Eager construction: an invalid token throws here, so the supervisor's
  // connect() try/catch routes it to terminal handling instead of start().
  const api = new TelegramBotApi({
    token: options.token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.validate ? { validate: options.validate } : {})
  });
  const timeoutSeconds = options.longPollTimeoutSeconds ?? 25;

  const jitter = options.jitter ?? Math.random;
  const callbacks = options.callbacks;
  const handlers = options.handlers;

  let closed = false;
  let controller: AbortController | undefined;
  let started: Promise<void> | undefined;

  return {
    start() {
      if (started) return started;
      const abortController = new AbortController();
      controller = abortController;
      started = run(abortController.signal).catch((error: unknown) => {
        // Aborts raised by close() are not terminal errors.
        if (closed) return;
        throw error;
      });
      return started;
    },
    close(): void {
      closed = true;
      controller?.abort();
    }
  };

  async function run(signal: AbortSignal): Promise<void> {
    const identity = await api.getMe(AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMs ?? 15_000)]));
    callbacks.onIdentity?.(identity);
    let offset = options.cursor?.load();
    let throttled = false;
    let ready = false;
    while (!signal.aborted) {
      let updates: unknown[];
      try {
        updates = await api.getUpdates(offset, timeoutSeconds, AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMs ?? (timeoutSeconds + 15) * 1000)]));
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof TelegramApiError && error.status === 429 && error.retryAfterSeconds !== undefined) {
          if (!throttled) {
            callbacks.onReconnecting?.();
            throttled = true;
          }
          await sleep(error.retryAfterSeconds * 1000, signal);
          continue;
        }
        throw error;
      }
      if (throttled) {
        callbacks.onReconnected?.();
        throttled = false;
      }
      if (!ready) {
        callbacks.onReady?.(identity);
        ready = true;
      }
      for (const update of updates) {
        const updateId = (update as { update_id?: unknown }).update_id;
        if (!Number.isSafeInteger(updateId)) throw new Error('TELEGRAM_UPDATE_ID_INVALID');
        if (signal.aborted) return;
        const event = normalizeTelegramUpdate(update, identity);
        if (event) {
          if (!handlers.onMessage) throw new Error('TELEGRAM_INGRESS_UNAVAILABLE');
          // A durable handler failure rejects this batch; the supervisor reconnects
          // from the last committed cursor. Later updates must not leapfrog it.
          await handlers.onMessage(event);
        }
        if (signal.aborted) return;
        const next = Math.max(offset ?? 0, Number(updateId) + 1);
        options.cursor?.save(next);
        offset = next;
      }
      if (updates.length === 0) await sleep(200 + jitter() * 300, signal);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}
