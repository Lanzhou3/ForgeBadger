import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateProjectRoot } from '../../lib/safe-resolve.js';
import { assertGitRoot } from './project-diff.js';

const exec = promisify(execFile);
const MAX_STATUS_BYTES = 8 * 1024 * 1024;
const CONFLICTS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const SAFE_CORE = ['repositoryformatversion', 'filemode', 'ignorecase', 'symlinks', 'precomposeunicode',
  'autocrlf', 'eol', 'checkstat', 'trustctime', 'excludesfile', 'attributesfile', 'protectntfs', 'protecthfs'];
const CONFIG_PATTERN = `^(core\\.(${SAFE_CORE.join('|')}|sparsecheckout)|extensions\\.objectformat|filter\\..*\\.(clean|process|required))$`;
const fixedArgs = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
  '-c', 'diff.external=', '-c', 'submodule.recurse=false', '-c', 'protocol.allow=never', '-c', 'credential.helper='];

/** Parse byte-framed paths without UTF-8 normalization or filename disclosure. */
function* statusEntries(data: Buffer): Generator<{ code: string; identity: string }> {
  if (data.length > MAX_STATUS_BYTES) throw new Error('COPILOT_GIT_STATUS_LIMIT');
  let cursor = 0;
  while (cursor < data.length) {
    const end = data.indexOf(0, cursor);
    if (end < cursor + 4 || data[cursor + 2] !== 32) throw new Error('COPILOT_GIT_STATUS_INVALID');
    const code = data.subarray(cursor, cursor + 2).toString('ascii');
    const identity = data.subarray(cursor + 3, end).toString('base64');
    cursor = end + 1;
    if (!CONFLICTS.has(code) && code !== '??' && (!/^[ MTADRC]{2}$/.test(code) || code === '  ')) throw new Error('COPILOT_GIT_STATUS_INVALID');
    if (code.includes('R') || code.includes('C')) {
      const sourceEnd = data.indexOf(0, cursor);
      if (sourceEnd <= cursor) throw new Error('COPILOT_GIT_STATUS_INVALID');
      cursor = sourceEnd + 1;
    }
    yield { code, identity };
  }
}

/** Parse the complete status stream. Categories overlap; total is unique paths. */
export function summarizeGitStatus(data: Buffer) {
  const counts = { total: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, stagedAndUnstaged: 0 };
  const byStatus: Record<string, number> = {};
  const paths = new Set<string>(), entries = new Set<string>();
  for (const { code, identity } of statusEntries(data)) {
    if (entries.has(code + identity)) continue;
    entries.add(code + identity); paths.add(identity); counts.total = paths.size;
    byStatus[code] = (byStatus[code] ?? 0) + 1;
    if (code === '??') { counts.untracked++; continue; }
    if (CONFLICTS.has(code)) { counts.conflicted++; continue; }
    if (code[0] !== ' ') counts.staged++;
    if (code[1] !== ' ') counts.unstaged++;
    if (code[0] !== ' ' && code[1] !== ' ') counts.stagedAndUnstaged++;
  }
  return { counts, byStatus, clean: counts.total === 0, complete: true as const };
}

/** --ignore-submodules=all hides staged gitlinks too; recover those from index/HEAD only. */
function stagedGitlinks(data: Buffer, status: Buffer): Buffer {
  const knownPaths = new Set([...statusEntries(status)].map(entry => entry.identity));
  const records: Buffer[] = [];
  let cursor = 0;
  const field = () => {
    const end = data.indexOf(0, cursor);
    if (end <= cursor) throw new Error('COPILOT_GIT_STATUS_INVALID');
    const result = data.subarray(cursor, end); cursor = end + 1; return result;
  };
  while (cursor < data.length) {
    const header = field().toString('ascii');
    const match = /^:([0-7]{6}) ([0-7]{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])(?:[0-9]+)?$/.exec(header);
    if (!match) throw new Error('COPILOT_GIT_STATUS_INVALID');
    const source = field(), renamed = match[3] === 'R' || match[3] === 'C';
    const target = renamed ? field() : source;
    if (match[1] !== '160000' && match[2] !== '160000') continue;
    if (knownPaths.has(target.toString('base64'))) continue;
    if (match[3] === 'U') throw new Error('COPILOT_GIT_STATUS_INVALID');
    records.push(Buffer.from(`${match[3]}  `), target, Buffer.from([0]));
    if (renamed) records.push(source, Buffer.from([0]));
  }
  return Buffer.concat(records);
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_PROTOCOL_FROM_USER: '0' };
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'USERPROFILE', 'SYSTEMROOT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

/** No helper/filter configuration is copied. Paths/config may never become error messages. */
function snapshotConfig(data: Buffer): string {
  const entries = new Map<string, string>();
  for (const record of data.toString('utf8').split('\0').filter(Boolean)) {
    const split = record.indexOf('\n');
    if (split < 0) entries.set(record, 'true'); // Git's implicit boolean value.
    else entries.set(record.slice(0, split), record.slice(split + 1));
  }
  for (const [key, value] of entries) {
    if (/^filter\..*\.(clean|process)$/.test(key) && value.trim()) throw new Error('COPILOT_GIT_STATUS_FILTER_UNSUPPORTED');
    if (/^filter\..*\.required$/.test(key) && /^(true|yes|on|1)$/i.test(value)) throw new Error('COPILOT_GIT_STATUS_FILTER_UNSUPPORTED');
    if (key === 'core.sparsecheckout' && /^(true|yes|on|1)$/i.test(value)) throw new Error('COPILOT_GIT_STATUS_SPARSE_UNSUPPORTED');
  }
  const quoted = (value: string) => {
    if (/[\x00-\x07\x0b-\x1f\x7f]/.test(value)) throw new Error('COPILOT_GIT_STATUS_CONFIG_UNSUPPORTED');
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\x08/g, '\\b') + '"';
  };
  const core = SAFE_CORE.filter(key => entries.has(`core.${key}`)).map(key => `\t${key} = ${quoted(entries.get(`core.${key}`)!)}`);
  const format = entries.get('extensions.objectformat');
  return `[core]\n${core.join('\n')}\n\tbare = false\n` + (format ? `[extensions]\n\tobjectFormat = ${quoted(format)}\n` : '');
}

function copyMetadata(source: string, destination: string, maxBytes: number): number {
  let fd: number;
  try { fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw new Error('COPILOT_GIT_ROOT_UNSUPPORTED'); }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('COPILOT_GIT_STATUS_LIMIT');
    const data = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < data.length) { const n = fs.readSync(fd, data, size, data.length - size, null); if (!n) break; size += n; }
    if (size !== stat.size) throw new Error('COPILOT_GIT_STATUS_CHANGED');
    fs.writeFileSync(destination, data.subarray(0, size), { mode: 0o600, flag: 'wx' });
    return size;
  } finally { fs.closeSync(fd); }
}

/** Stable config/index snapshots prevent status from executing mutable repo/global filter drivers. */
export async function readProjectGitStatus(root: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const canonical = fs.realpathSync(root); validateProjectRoot(canonical); assertGitRoot(canonical);
  const sourceGit = path.join(canonical, '.git');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('COPILOT_GIT_STATUS_TIMEOUT')), 10_000);
  const env = safeEnvironment();
  let temporary: string | undefined;
  const git = async (gitDir: string, args: string[], environment = env, allowMissing = false, maxBuffer = MAX_STATUS_BYTES) => {
    controller.signal.throwIfAborted(); assertGitRoot(canonical);
    try {
      const result = await exec('git', [...fixedArgs, `--git-dir=${gitDir}`, `--work-tree=${canonical}`, ...args],
        { cwd: canonical, env: environment, signal: controller.signal, timeout: 10000, maxBuffer, encoding: 'buffer', windowsHide: true });
      assertGitRoot(canonical); return result.stdout;
    } catch (error) {
      controller.signal.throwIfAborted();
      const code = (error as NodeJS.ErrnoException).code;
      if (allowMissing && (error as { code?: unknown }).code === 1) return Buffer.alloc(0);
      if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('COPILOT_GIT_STATUS_LIMIT');
      throw new Error('COPILOT_GIT_STATUS_FAILED');
    }
  };
  try {
    const values = await git(sourceGit, ['config', '--includes', '--null', '--get-regexp', CONFIG_PATTERN], env, true, 256 * 1024);
    const booleans = await git(sourceGit, ['config', '--includes', '--null', '--type=bool', '--get-regexp', '^(core\\.sparsecheckout|filter\\..*\\.required)$'], env, true, 256 * 1024);
    const config = snapshotConfig(Buffer.concat([values, booleans]));
    const head = (await git(sourceGit, ['rev-parse', '--revs-only', 'HEAD'], env, false, 1024)).toString('ascii').trim();
    if (head && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) throw new Error('COPILOT_GIT_STATUS_INVALID');
    temporary = fs.mkdtempSync(path.join(tmpdir(), 'fb-git-status-'));
    fs.mkdirSync(path.join(temporary, 'refs')); fs.mkdirSync(path.join(temporary, 'info'));
    fs.writeFileSync(path.join(temporary, 'HEAD'), head ? `${head}\n` : 'ref: refs/heads/unborn\n', { mode: 0o600 });
    fs.writeFileSync(path.join(temporary, 'config'), config, { mode: 0o600 });
    let remaining = 64 * 1024 * 1024;
    for (const file of ['index', ...fs.readdirSync(sourceGit).filter(name => /^sharedindex\.[0-9a-f]+$/.test(name))]) {
      remaining -= copyMetadata(path.join(sourceGit, file), path.join(temporary, file), remaining);
    }
    for (const file of ['attributes', 'exclude']) copyMetadata(path.join(sourceGit, 'info', file), path.join(temporary, 'info', file), 1024 * 1024);
    const isolatedEnv = { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_OBJECT_DIRECTORY: path.join(sourceGit, 'objects') };
    const status = await git(temporary, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all', '--renames'], isolatedEnv);
    const gitlinks = stagedGitlinks(await git(temporary, ['diff', '--cached', '--raw', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--find-renames'], isolatedEnv), status);
    const result = summarizeGitStatus(Buffer.concat([status, gitlinks]));
    return { ...result, observedAt: new Date().toISOString(), unit: 'unique_git_status_paths',
      scope: 'superproject; ignored files and submodule worktree changes excluded; nested untracked repositories count as one entry',
      note: 'Counts cover the complete status output, not a diff page. Categories can overlap; use total for unique paths. Conflicts count separately. Staged gitlinks count; submodule worktrees are not inspected. Concurrent edits can change the snapshot.', readOnly: true };
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', abort);
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}
