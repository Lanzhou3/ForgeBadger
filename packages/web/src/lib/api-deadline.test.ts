import { afterEach, expect, it, vi } from 'vitest';
import { fetchEnvelope, fetchJson } from './api';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const read of [fetchJson, fetchEnvelope]) for (const withCaller of [false, true]) {
  it(`${read.name} keeps the deadline through a stalled response body (caller signal: ${withCaller})`, async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, request: RequestInit) => {
      signal = request.signal!;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"code":0,')); } }));
    }));
    const outcome = read('/api/v1/copilot/test', { ...(withCaller ? { signal: caller.signal } : {}), timeoutMs: 100 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(101);
    expect(signal?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(await outcome).toMatchObject({ name: 'GatewayApiError', message: expect.stringContaining('timed out') });
    expect(vi.getTimerCount()).toBe(0);
  });
}

it('propagates caller cancellation during response body reading without retrying', async () => {
  const caller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream())));
  const outcome = fetchJson('/api/v1/copilot/test', { method: 'POST', signal: caller.signal }).catch(error => error);
  await Promise.resolve();
  caller.abort();
  expect(await outcome).toMatchObject({ name: 'GatewayApiError', details: { code: 'GATEWAY_REQUEST_CANCELLED' } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('cleans the deadline after a successful response body', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":0,"data":{"ok":true},"message":""}')));
  await expect(fetchJson('/api/v1/copilot/test')).resolves.toEqual({ ok: true });
  expect(vi.getTimerCount()).toBe(0);
});


it('does not submit an already-cancelled write request', async () => {
  const caller = new AbortController();
  caller.abort('sensitive caller reason');
  vi.stubGlobal('fetch', vi.fn());
  await expect(fetchJson('/api/v1/copilot/test', { method: 'POST', signal: caller.signal })).rejects.toMatchObject({ details: { code: 'GATEWAY_REQUEST_CANCELLED' } });
  expect(fetch).not.toHaveBeenCalled();
});
