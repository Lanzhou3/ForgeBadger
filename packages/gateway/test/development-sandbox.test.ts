import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import { runSandboxChecks, sandboxCapability } from '../src/services/development/sandbox.js';

const unsupported = process.platform !== 'darwin';
async function fixture(t: TestContext, source: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'development-sandbox-'));
  const workspace = path.join(root, 'work');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'check.test.cjs'), source);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, workspace };
}
const run = (workspace: string, timeoutMs = 5_000, signal = new AbortController().signal) => runSandboxChecks({ workspace, checks: ['check.test.cjs'], timeoutMs, signal });
async function until<T>(read: () => Promise<T | undefined>, timeout = 5_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await read(); if (result !== undefined) return result; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('fixture observation timed out');
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

it('reports actual sandbox capability without executing unsandboxed fallback', { skip: unsupported }, () => {
  assert.deepEqual(sandboxCapability(), { available: true, reason: null });
});

it('runs real passing and failing Node tests', { skip: unsupported }, async t => {
  const { workspace } = await fixture(t, "require('node:test').test('passes',()=>require('node:assert/strict').equal(2+2,4));");
  const pass = await run(workspace);
  assert.equal(pass.exitCode, 0, pass.stderr); assert.match(pass.stdout, /passes/);
  await writeFile(path.join(workspace, 'check.test.cjs'), "require('node:test').test('fails',()=>require('node:assert/strict').equal(2+2,5));");
  const fail = await run(workspace);
  assert.notEqual(fail.exitCode, 0); assert.equal(fail.cancelled, false); assert.equal(fail.timedOut, false);
});

it('caps combined output and enforces a real timeout', { skip: unsupported }, async t => {
  const { workspace } = await fixture(t, "process.stdout.write('x'.repeat(200000));process.stderr.write('y'.repeat(200000));");
  const output = await run(workspace);
  assert.equal(output.exitCode, 0, output.stderr);
  assert.ok(Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr) <= 64 * 1024);
  await writeFile(path.join(workspace, 'check.test.cjs'), 'while(true){}');
  const timeout = await run(workspace, 150);
  assert.equal(timeout.timedOut, true); assert.equal(timeout.cancelled, false); assert.equal(timeout.exitCode, null);
});

it('cancels a running sandbox and rejects pre-cancelled work', { skip: unsupported }, async t => {
  const { workspace } = await fixture(t, 'setInterval(()=>{},1000)');
  const controller = new AbortController();
  const pending = run(workspace, 5_000, controller.signal);
  setTimeout(() => controller.abort(), 150);
  const result = await pending;
  assert.equal(result.cancelled, true); assert.equal(result.exitCode, null);
  const again = await run(workspace, 5_000, controller.signal);
  assert.equal(again.cancelled, true);
});

it('blocks source mutation, host reads/writes, detached children, loopback and Unix IPC', { skip: unsupported }, async t => {
  const { root, workspace } = await fixture(t, '');
  const sentinel = path.join(root, 'host-private.txt');
  const unixPath = path.join(root, 'sentinel.sock');
  await writeFile(sentinel, 'fixture-only-private-data');
  const previousMarker = process.env.FORGEBADGER_SANDBOX_TEST_ONLY;
  process.env.FORGEBADGER_SANDBOX_TEST_ONLY = randomUUID();
  t.after(() => { if (previousMarker === undefined) delete process.env.FORGEBADGER_SANDBOX_TEST_ONLY; else process.env.FORGEBADGER_SANDBOX_TEST_ONLY = previousMarker; });
  let connections = 0;
  const tcp = net.createServer(socket => { connections++; socket.destroy(); });
  const unix = net.createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(resolve => tcp.listen(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => unix.listen(unixPath, resolve));
  t.after(() => { tcp.close(); unix.close(); });
  const port = (tcp.address() as net.AddressInfo).port;
  const source = `const test=require('node:test').test,assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net');
test('immutable source and private host',()=>{assert.throws(()=>fs.writeFileSync(__filename,'bad'));assert.throws(()=>fs.readFileSync(${JSON.stringify(sentinel)}));assert.throws(()=>fs.writeFileSync(${JSON.stringify(sentinel)},'bad'));fs.writeFileSync(process.env.TMPDIR+'/okay','okay');assert.equal(fs.readFileSync(process.env.TMPDIR+'/okay','utf8'),'okay');assert.equal(process.env.FORGEBADGER_MASTER_KEY,undefined);assert.equal(process.env.FORGEBADGER_SANDBOX_TEST_ONLY,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);fs.symlinkSync(${JSON.stringify(sentinel)},process.env.TMPDIR+'/escape');assert.throws(()=>fs.readFileSync(process.env.TMPDIR+'/escape'));assert.throws(()=>fs.writeFileSync(process.env.TMPDIR+'/escape','bad'))});
test('cannot detach subprocess',()=>{const r=require('node:child_process').spawnSync(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true});assert.ok(r.error)});
const blocked=opts=>new Promise((resolve,reject)=>{const s=net.connect(opts);s.once('error',()=>resolve());s.once('connect',()=>{s.destroy();reject(Error('connection unexpectedly allowed'))})});
test('loopback blocked',()=>blocked({host:'127.0.0.1',port:${port}}));test('Unix IPC blocked',()=>blocked({path:${JSON.stringify(unixPath)}}));`;
  await writeFile(path.join(workspace, 'check.test.cjs'), source);
  const result = await run(workspace);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(await readFile(path.join(workspace, 'check.test.cjs'), 'utf8'), source);
  assert.equal(await readFile(sentinel, 'utf8'), 'fixture-only-private-data');
  assert.equal(connections, 0);
});

for (const victim of ['gateway', 'supervisor', 'stopped_gateway'] as const) {
  it(victim === 'stopped_gateway' ? 'enforces the independent supervisor deadline while the Gateway is stopped' : `kills sandbox child when the ${victim} receives SIGKILL`, { skip: unsupported }, async t => {
    const { root, workspace } = await fixture(t, "require('node:fs').writeFileSync(process.env.TMPDIR+'/child.pid',String(process.pid));setInterval(()=>{},1000)");
    const moduleUrl = new URL('../src/services/development/sandbox.ts', import.meta.url).href;
    const code = `const {runSandboxChecks}=await import(${JSON.stringify(moduleUrl)});try{const r=await runSandboxChecks({workspace:${JSON.stringify(workspace)},checks:['check.test.cjs'],timeoutMs:${victim === 'stopped_gateway' ? 500 : 60_000},signal:new AbortController().signal});console.log(JSON.stringify(r))}catch(e){console.error(e.message)}`;
    const gateway = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (gateway.pid && alive(gateway.pid)) gateway.kill('SIGKILL'); });
    const childPid = await until(async () => {
      for (const entry of await readdir(root)) if (entry.startsWith('.copilot-sandbox-')) {
        try { return Number(await readFile(path.join(root, entry, 'child.pid'), 'utf8')); } catch { /* not started */ }
      }
      return undefined;
    });
    const supervisorPid = Number(execFileSync('/bin/ps', ['-p', String(childPid), '-o', 'ppid='], { encoding: 'utf8' }).trim());
    const childGroup = Number(execFileSync('/bin/ps', ['-p', String(childPid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
    const helperGroup = Number(execFileSync('/bin/ps', ['-p', String(supervisorPid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
    assert.equal(childGroup, supervisorPid); assert.equal(helperGroup, supervisorPid);
    t.after(() => { for (const pid of [childPid, supervisorPid]) try { process.kill(pid, 'SIGKILL'); } catch { /* cleaned */ } });
    if (victim === 'stopped_gateway') process.kill(gateway.pid!, 'SIGSTOP');
    else process.kill(victim === 'gateway' ? gateway.pid! : supervisorPid, 'SIGKILL');
    await until(async () => !alive(childPid) ? true : undefined);
    // A stopped parent cannot reap its exited helper; resume only after proving the child is gone.
    if (victim === 'stopped_gateway') process.kill(gateway.pid!, 'SIGCONT');
    await until(async () => !alive(supervisorPid) ? true : undefined);
  });
}

it('rejects shell flags and paths outside the approved workspace', { skip: unsupported }, async t => {
  const { root, workspace } = await fixture(t, '');
  for (const check of ['--eval=process.exit(0)', '../outside.test.cjs', '/tmp/outside.test.cjs', 'node check.test.cjs']) {
    await assert.rejects(runSandboxChecks({ workspace, checks: [check], signal: new AbortController().signal }));
  }
  await writeFile(path.join(root, 'outside.test.cjs'), 'throw Error("must not execute")');
  await symlink(path.join(root, 'outside.test.cjs'), path.join(workspace, 'symlink.test.cjs'));
  await assert.rejects(runSandboxChecks({ workspace, checks: ['symlink.test.cjs'], signal: new AbortController().signal }), /OUTSIDE_WORKSPACE/);
});

it('keeps multi-byte output within the combined byte cap and removes successful scratch', { skip: unsupported }, async t => {
  const { root, workspace } = await fixture(t, "process.stdout.write('你'.repeat(100000));process.stderr.write('好'.repeat(100000));");
  const result = await run(workspace);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 64 * 1024);
  assert.equal((await readdir(root)).some(entry => entry.startsWith('.copilot-sandbox-')), false);
});
