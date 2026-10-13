import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test, type TestContext } from 'node:test';
import type { IPty } from 'node-pty';
import { SessionHandle } from '../src/services/session-server/session-handle.js';
import { ProcessClaims, confirmHandleStopped, type ProcessBirth } from '../src/services/session-server/confirmed-stop.js';

const linux = { skip: process.platform !== 'linux' };
interface FixtureOptions {
  environment: (read: number) => string;
  birth?: (read: number) => string;
  signalError?: boolean;
}
function fixture(t: TestContext, options: FixtureOptions) {
  const pty = { pid: 4242, cols: 80, rows: 24, pause() {}, resume() {}, kill() {}, write() {}, resize() {}, onData() { return { dispose() {} }; }, onExit() { return { dispose() {} }; } } as unknown as IPty;
  const handle = new SessionHandle({ sessionId: 'observation', userId: 'fixture', attachToken: 'fixture', pty });
  const claims = new ProcessClaims(); claims.register(handle, 'generation');
  const birth: ProcessBirth = { pid: pty.pid, ppid: process.pid, pgid: pty.pid, birth: '100', nonce: 'generation' };
  let reads = 0, absent = false;
  const signals: Array<string | number | undefined> = [];
  const originalRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file: fs.PathOrFileDescriptor, optionsArg?: unknown) => {
    if (file === '/proc/4242/stat') {
      const fields = Array<string>(20).fill('0'); fields[0] = 'S'; fields[1] = String(process.pid); fields[2] = '4242'; fields[19] = options.birth?.(reads + 1) ?? '100';
      return '4242 (fixture) ' + fields.join(' ');
    }
    if (file === '/proc/4242/environ') return options.environment(++reads);
    return Reflect.apply(originalRead, fs, [file, optionsArg]);
  });
  syncBuiltinESMExports();
  t.mock.method(process, 'kill', (_pid: number, signal?: string | number) => {
    if (signal === 0) { if (absent) throw Object.assign(new Error('gone'), { code: 'ESRCH' }); return true; }
    signals.push(signal);
    if (options.signalError) throw Object.assign(new Error('denied'), { code: 'EPERM' });
    handle.markExited(0); absent = true; return true;
  });
  t.after(() => { handle.disposeResources(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { handle, claims, birth, signals, reads: () => reads, stop: () => confirmHandleStopped(handle, birth, true, () => claims.owns(handle, 'generation')) };
}
const validEnvironment = 'FORGEBADGER_RUNTIME_NONCE=generation\0';

test('empty exec-transition environment is re-read before signalling the same generation', linux, async t => {
  const f = fixture(t, { environment: read => read === 1 ? '' : validEnvironment });
  assert.equal(await f.stop(), true); assert.equal(f.reads(), 2); assert.deepEqual(f.signals, ['SIGHUP']);
});
test('a temporary OS read error can recover only with complete matching identity', linux, async t => {
  const f = fixture(t, { environment: read => { if (read === 1) throw Object.assign(new Error('temporarily unavailable'), { code: 'EACCES' }); return validEnvironment; } });
  assert.equal(await f.stop(), true); assert.equal(f.reads(), 2); assert.deepEqual(f.signals, ['SIGHUP']);
});
test('persistent unavailable identity stays bounded and never signals', linux, async t => {
  const f = fixture(t, { environment: () => '' });
  assert.equal(await f.stop(), false); assert.ok(f.reads() >= 1 && f.reads() <= 8); assert.deepEqual(f.signals, []);
});
test('nonempty environment with the wrong nonce is rejected without retry', linux, async t => {
  const f = fixture(t, { environment: read => read === 1 ? 'FORGEBADGER_RUNTIME_NONCE=other\0' : validEnvironment });
  assert.equal(await f.stop(), false); assert.equal(f.reads(), 1); assert.deepEqual(f.signals, []);
});
test('a changed birth after an unavailable observation is rejected immediately', linux, async t => {
  const f = fixture(t, { environment: read => read === 1 ? '' : validEnvironment, birth: read => read === 1 ? '100' : '200' });
  assert.equal(await f.stop(), false); assert.equal(f.reads(), 1); assert.deepEqual(f.signals, []);
});
for (const unavailable of ['empty', 'error']) {
  test(`changed stat identity is rejected before an ${unavailable} environment can hide it`, linux, async t => {
    const f = fixture(t, { birth: () => '200', environment: () => { if (unavailable === 'error') throw new Error('unreadable'); return ''; } });
    assert.equal(await f.stop(), false); assert.equal(f.reads(), 0); assert.deepEqual(f.signals, []);
  });
}
test('a replaced claim during the observation wait prevents signalling', linux, async t => {
  const f = fixture(t, { environment: () => { f.claims.release(f.handle, 'generation'); return ''; } });
  assert.equal(await f.stop(), false); assert.equal(f.reads(), 1); assert.deepEqual(f.signals, []);
});
test('leader exit during observation cannot confirm a surviving process group', linux, async t => {
  const f = fixture(t, { environment: () => { f.handle.markExited(0); return ''; } });
  assert.equal(await f.stop(), false); assert.equal(f.reads(), 1); assert.deepEqual(f.signals, []);
});
test('missing original birth is never reconstructed from a later observation', linux, async t => {
  const f = fixture(t, { environment: () => validEnvironment });
  assert.equal(await confirmHandleStopped(f.handle, undefined, true, () => true), false); assert.equal(f.reads(), 0); assert.deepEqual(f.signals, []);
});
test('a signal error is not retried as an observation failure', linux, async t => {
  const f = fixture(t, { environment: () => validEnvironment, signalError: true });
  assert.equal(await f.stop(), false); assert.equal(f.reads(), 1); assert.deepEqual(f.signals, ['SIGHUP']);
});
