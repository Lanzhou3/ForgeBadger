import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { it } from 'node:test';
import { matchSearchPage, type SearchMatchInput } from '../src/services/agent/tools/machine-search-matcher.js';

const expensive: SearchMatchInput = {
  files: [{ path: 'sample.txt', content: 'a'.repeat(100) + '!' }],
  query: '(a+)+$', mode: 'regex', lineOffset: 0, limit: 20,
};
const ordinary: SearchMatchInput = {
  files: [{ path: 'sample.txt', content: 'one\nNEEDLE\nthree' }],
  query: 'needle', mode: 'literal', lineOffset: 0, limit: 20,
};

it('rejects malformed patterns without leaking them and releases worker capacity', async () => {
  for (let index = 0; index < 6; index++) {
    await assert.rejects(matchSearchPage({ ...ordinary, mode: 'regex', query: '(private-pattern' }),
      { message: 'MACHINE_SEARCH_INVALID_PATTERN' });
  }
  assert.deepEqual((await matchSearchPage(ordinary)).matches, [{ path: 'sample.txt', line: 2, text: 'NEEDLE' }]);
});

it('honors cancellation before and during matching, removes listeners and permits a later search', async () => {
  const cancelled = AbortSignal.abort();
  await assert.rejects(matchSearchPage(expensive, cancelled), /MACHINE_SEARCH_CANCELLED/);
  const controller = new AbortController();
  const pending = matchSearchPage(expensive, controller.signal);
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(pending, /MACHINE_SEARCH_CANCELLED/); }
  finally { clearTimeout(timer); }
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal((await matchSearchPage(ordinary)).matches.length, 1);
});

it('bounds concurrent workers and frees all capacity after cancellation', async () => {
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const pending = controllers.map(controller => matchSearchPage(expensive, controller.signal));
  // Attach rejection handlers before triggering aborts.
  const settled = Promise.allSettled(pending);
  try { await assert.rejects(matchSearchPage(ordinary), /MACHINE_SEARCH_BUSY/); }
  finally { controllers.forEach(controller => controller.abort()); }
  for (const outcome of await settled) {
    assert.equal(outcome.status, 'rejected');
    if (outcome.status === 'rejected') assert.match(String(outcome.reason), /MACHINE_SEARCH_CANCELLED/);
  }
  assert.equal((await matchSearchPage(ordinary)).matches.length, 1);
});
