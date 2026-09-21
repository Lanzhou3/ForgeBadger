import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { SANDBOX_SUPERVISOR_SOURCE } from './sandbox-supervisor.js';

const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const SYSTEM_READ_ROOTS = ['/System', '/private/preboot/Cryptexes/OS', '/usr/lib', '/usr/share/icu', '/private/var/db/dyld'];
export interface SandboxCheckResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; cancelled: boolean; durationMs: number }
interface SandboxCheckInput { workspace: string; checks: string[]; signal: AbortSignal; timeoutMs?: number }

function minimalEnv(scratch: string): Record<string, string> {
  return { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, LANG: 'C', LC_ALL: 'C' };
}

function policy(node: string, workspace?: string, scratch?: string): string {
  const subpaths = [...SYSTEM_READ_ROOTS, ...(workspace ? [workspace] : []), ...(scratch ? [scratch] : [])];
  const ancestors = new Set<string>(['/']);
  for (const value of [node, ...subpaths]) {
    let current = path.dirname(value);
    while (current !== path.dirname(current)) { ancestors.add(current); current = path.dirname(current); }
  }
  const literal = (value: string) => `(literal ${JSON.stringify(value)})`;
  return ['(version 1)', '(deny default)', '(import "dyld-support.sb")', '(allow syscall*)', '(allow mach-bootstrap)',
    `(allow process-exec ${literal(node)})`, '(allow signal (target self))', '(allow sysctl-read)',
    `(allow file-read-metadata ${[...ancestors].map(literal).join(' ')})`,
    `(allow file-read* ${subpaths.map(v => `(subpath ${JSON.stringify(v)})`).join(' ')} ${[node, '/dev/null', '/dev/random', '/dev/urandom'].map(literal).join(' ')})`,
    `(allow file-write* ${scratch ? `(subpath ${JSON.stringify(scratch)})` : ''} ${literal('/dev/null')})`,
    `(allow file-map-executable ${SYSTEM_READ_ROOTS.map(v => `(subpath ${JSON.stringify(v)})`).join(' ')} ${literal(node)})`
  ].join('\n');
}

export function sandboxCapability(): { available: boolean; reason: string | null } {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (process.platform !== 'darwin') return { available: false, reason: 'DEVELOPMENT_SANDBOX_REQUIRES_MACOS' };
  if (major < 22 || (major === 22 && minor < 8)) return { available: false, reason: 'DEVELOPMENT_SANDBOX_REQUIRES_NODE_22_8' };
  try {
    accessSync('/usr/bin/sandbox-exec', constants.X_OK);
    const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', policy('/usr/bin/true'), '/usr/bin/true'], {
      env: minimalEnv('/private/tmp'), timeout: 2_000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe']
    });
    return probe.status === 0 ? { available: true, reason: null } : { available: false, reason: 'DEVELOPMENT_SANDBOX_UNAVAILABLE' };
  } catch { return { available: false, reason: 'DEVELOPMENT_SANDBOX_UNAVAILABLE' }; }
}

function resolveChecks(workspace: string, checks: string[]): string[] {
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > 32) throw new Error('DEVELOPMENT_CHECKS_INVALID');
  return checks.map(check => {
    if (typeof check !== 'string' || check.length > 1024 || check.startsWith('-') || path.isAbsolute(check)
      || check.split(/[\\/]/u).includes('..') || !/\.(?:cjs|mjs|js)$/u.test(check) || /[\0\r\n*?]/u.test(check)) throw new Error('DEVELOPMENT_CHECKS_INVALID');
    const candidate = realpathSync(path.resolve(workspace, check));
    if (!candidate.startsWith(workspace + path.sep) || !statSync(candidate).isFile()) throw new Error('DEVELOPMENT_CHECK_OUTSIDE_WORKSPACE');
    return candidate;
  });
}

function killGroup(pid: number | undefined): void {
  if (!pid) return;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* The private process group is already gone. */ }
}

/** No shell, inherited credentials, network, source writes, child forks or unsandboxed fallback. */
export async function runSandboxChecks(input: SandboxCheckInput): Promise<SandboxCheckResult> {
  const started = Date.now();
  if (input.signal.aborted) return { exitCode: null, stdout: '', stderr: '', timedOut: false, cancelled: true, durationMs: 0 };
  const workspace = realpathSync(input.workspace);
  if (!statSync(workspace).isDirectory()) throw new Error('DEVELOPMENT_WORKSPACE_INVALID');
  const checks = resolveChecks(workspace, input.checks);
  const capability = sandboxCapability();
  if (!capability.available) throw new Error(capability.reason!);
  const timeoutMs = input.timeoutMs === undefined ? MAX_TIMEOUT_MS : Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.trunc(input.timeoutMs)));
  if (!Number.isFinite(timeoutMs)) throw new Error('DEVELOPMENT_TIMEOUT_INVALID');
  const scratch = await mkdtemp(path.join(path.dirname(workspace), '.copilot-sandbox-'));
  const node = realpathSync(process.execPath);
  try {
    if (input.signal.aborted) return { exitCode: null, stdout: '', stderr: '', timedOut: false, cancelled: true, durationMs: Date.now() - started };
    return await supervise({ node, workspace, checks, scratch, timeoutMs, signal: input.signal, started });
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

function supervise(input: { node: string; workspace: string; checks: string[]; scratch: string; timeoutMs: number; signal: AbortSignal; started: number }): Promise<SandboxCheckResult> {
  const config = JSON.stringify({ node: input.node, workspace: input.workspace, checks: input.checks, timeoutMs: input.timeoutMs,
    policy: policy(input.node, input.workspace, input.scratch), env: minimalEnv(input.scratch) });
  return new Promise(resolve => {
    const helper = spawn(input.node, ['--max-old-space-size=32', '-e', SANDBOX_SUPERVISOR_SOURCE, config], {
      cwd: input.scratch, env: minimalEnv(input.scratch), detached: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = ''; let diagnostic = ''; let expired = false;
    const abort = () => { helper.stdin.end('cancel\n'); };
    helper.stdin.on('error', () => undefined);
    const watchdog = setTimeout(() => { expired = true; killGroup(helper.pid); }, input.timeoutMs + 1_500);
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) abort();
    helper.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); if (Buffer.byteLength(output) > 128 * 1024) killGroup(helper.pid); });
    helper.stderr.on('data', (chunk: Buffer) => { if (diagnostic.length < 2048) diagnostic += chunk.toString().slice(0, 2048 - diagnostic.length); });
    helper.on('error', () => { diagnostic = 'Sandbox supervisor failed to start'; });
    helper.once('close', code => {
      // A killed helper cannot clean up its child; only this known detached group may be killed.
      killGroup(helper.pid); clearTimeout(watchdog); input.signal.removeEventListener('abort', abort);
      let result: SandboxCheckResult | undefined;
      if (code === 0) { try { result = decodeResult(JSON.parse(output) as unknown); } catch { /* fail closed */ } }
      resolve(result ? { ...result, cancelled: result.cancelled || input.signal.aborted, durationMs: Date.now() - input.started }
        : { exitCode: null, stdout: '', stderr: diagnostic || 'Sandbox supervisor exited unexpectedly', timedOut: expired,
          cancelled: input.signal.aborted, durationMs: Date.now() - input.started });
    });
  });
}

function decodeResult(value: unknown): SandboxCheckResult {
  const row = value as Record<string, unknown>;
  if (!row || (row.exitCode !== null && !Number.isInteger(row.exitCode)) || typeof row.stdout !== 'string' || typeof row.stderr !== 'string'
    || typeof row.timedOut !== 'boolean' || typeof row.cancelled !== 'boolean') throw new Error('Invalid supervisor result');
  const decode = (encoded: string, cap: number) => {
    let result = Buffer.from(encoded, 'base64').subarray(0, cap).toString('utf8');
    while (Buffer.byteLength(result) > cap) result = result.slice(0, -1);
    return result;
  };
  const stdout = decode(row.stdout, MAX_OUTPUT_BYTES);
  const stderr = decode(row.stderr, MAX_OUTPUT_BYTES - Buffer.byteLength(stdout));
  return { exitCode: row.exitCode as number | null, stdout, stderr, timedOut: row.timedOut, cancelled: row.cancelled, durationMs: 0 };
}
