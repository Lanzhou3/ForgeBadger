import { setTimeout as delay } from 'node:timers/promises';

const TRANSIENT = new Set([429, 502, 503, 504]);

/** Retry only rejected model HTTP requests, never an accepted stream or a tool. */
export async function fetchModelWithRetry(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    const response = await fetchImpl(url, init);
    if (!TRANSIENT.has(response.status) || attempt >= 2) return response;
    const retryAfter = response.headers?.get('retry-after');
    const seconds = retryAfter === null || retryAfter === undefined ? NaN : Number(retryAfter);
    const requested = Number.isFinite(seconds) ? seconds * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
    const waitMs = Number.isFinite(requested) ? Math.max(0, requested) : 500 * 2 ** attempt;
    // Do not retry earlier than the provider permits, or hold a request indefinitely.
    if (waitMs > 30_000) return response;
    await response.body?.cancel().catch(() => undefined);
    await delay(waitMs, undefined, init.signal ? { signal: init.signal } : {});
  }
}
