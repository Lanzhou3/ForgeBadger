import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fetchModelWithRetry } from '../src/services/agent/model-transport.js';

it('retries rejected transient requests within a fixed bound and preserves the body', async () => {
  let calls = 0;
  const transport: typeof fetch = async (_url, init) => {
    assert.equal(init?.body, 'same request');
    return new Response('', { status: ++calls < 3 ? 429 : 200, headers: { 'retry-after': '0' } });
  };
  assert.equal((await fetchModelWithRetry(transport, 'https://example.test', { body: 'same request' })).status, 200);
  assert.equal(calls, 3);
});

it('does not replay accepted responses, permanent failures or transport ambiguity', async () => {
  for (const status of [200, 400, 401, 403]) {
    let calls = 0;
    await fetchModelWithRetry(async () => { calls++; return new Response('', { status }); }, 'https://example.test', {});
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(fetchModelWithRetry(async () => { calls++; throw new Error('socket closed'); }, 'https://example.test', {}));
  assert.equal(calls, 1);
});

it('honors cancellation while backing off and refuses an excessive Retry-After', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = fetchModelWithRetry(async () => {
    calls++; setTimeout(() => controller.abort(), 10);
    return new Response('', { status: 503, headers: { 'retry-after': '10' } });
  }, 'https://example.test', { signal: controller.signal });
  await assert.rejects(pending, /abort/i);
  assert.equal(calls, 1);
  await fetchModelWithRetry(async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); }, 'https://example.test', {});
  assert.equal(calls, 2);
});
