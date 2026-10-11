import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEnv } from '../src/config/env.js';
import { gatewayLoopbackUrl } from '../src/services/claude-route/gateway-url.js';

test('Claude proxy URL uses the same default port as Gateway startup', () => {
  const input = { FORGEBADGER_MASTER_KEY: 'a'.repeat(64), FORGEBADGER_JWT_SECRET: 'fixture-'.repeat(8) };
  assert.equal(gatewayLoopbackUrl(input), `http://127.0.0.1:${loadEnv(input).FORGEBADGER_PORT}`);
  assert.equal(gatewayLoopbackUrl({ ...input, FORGEBADGER_PORT: '' }), 'http://127.0.0.1:18332');
});

test('Claude proxy URL preserves explicitly configured host and port', () => {
  assert.equal(gatewayLoopbackUrl({ FORGEBADGER_HOST: ' localhost ', FORGEBADGER_PORT: '19432' }), 'http://localhost:19432');
});
