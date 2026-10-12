import { execFile } from 'node:child_process';
import { existsSync, lstatSync, opendirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { permittedSourcePath, sourcePath, readSource, MAX_SOURCE_BYTES } from './workspace.js';
import { validateProjectRoot } from '../../lib/safe-resolve.js';
import { redactAgentText } from '../agent/redaction.js';

const exec = promisify(execFile);
const REGULAR_MODES = new Set(['100644', '100755']);
const MAX_FILES = 2000;
const MAX_RESULT_FILES = 20;
const MAX_SCANNED_FILES = 40;
const MAX_DIFF_CHARS = 180_000;
interface Entry { path: string; mode: string; oid: string; stage: string }
export interface ProjectDiffOptions { mode: 'working' | 'staged'; includeUntracked?: boolean; offset?: number }
export interface ProjectDiffFile { path: string; status: string; diff: string; beforeSha256: string | null; afterSha256: string | null }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Read index/tree metadata first; only permitted regular source blobs are ever requested. */
export async function readProjectDiff(root: string, options: ProjectDiffOptions, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const canonical = realpathSync(root); validateProjectRoot(canonical); assertGitRoot(canonical);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => controller.abort(new Error('COPILOT_GIT_TIMEOUT')), 10_000);
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_LITERAL_PATHSPECS: '1', GIT_NO_REPLACE_OBJECTS: '1',
    // Defense in depth for older Git versions that do not recognize NO_LAZY_FETCH.
    GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_PROTOCOL_FROM_USER: '0', GIT_SSH_COMMAND: 'false' };
  const git = async (args: string[], maxBuffer = 512 * 1024): Promise<string> => {
    assertGitRoot(canonical); controller.signal.throwIfAborted();
    try {
      const result = await exec('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', '-c', 'submodule.recurse=false',
        '-c', 'protocol.allow=never', '-c', 'core.sshCommand=false', '-c', 'credential.helper=',
        `--git-dir=${path.join(canonical, '.git')}`, `--work-tree=${canonical}`, ...args],
      { cwd: canonical, env, signal: controller.signal, timeout: 5000, maxBuffer, encoding: 'buffer', windowsHide: true });
      assertGitRoot(canonical);
      return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
    } catch {
      controller.signal.throwIfAborted();
      throw new Error('COPILOT_GIT_READ_FAILED'); // Never surface git stderr, config or host paths.
    }
  };
  try {
    const index = parseIndex(await git(['ls-files', '--stage', '-z']));
    let head: Entry[] = [];
    // Empty repositories have no HEAD; distinguish them without broad parent discovery.
    const references = await git(['rev-parse', '--revs-only', 'HEAD']);
    if (references.trim()) head = parseTree(await git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']));
    const current = new Map(index.map(entry => [entry.path, entry]));
    const previous = new Map(head.map(entry => [entry.path, entry]));
    const protectedOids = new Set([...index, ...head].filter(entry => !allowed(entry)).map(entry => entry.oid));
    const protectedRemoval = head.some(entry => !allowed(entry) && !current.has(entry.path));
    const untracked = options.mode === 'working' && options.includeUntracked
      ? (await git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean) : [];
    const candidates = [...new Set([...current.keys(), ...(options.mode === 'staged' ? previous.keys() : untracked)])].sort();
    if (candidates.length > MAX_FILES) throw new Error('COPILOT_GIT_FILE_LIMIT');
    const files: ProjectDiffFile[] = []; let skipped = 0, chars = 0;
    let cursor = options.offset ?? 0;
    const end = Math.min(candidates.length, cursor + MAX_SCANNED_FILES);
    for (; cursor < candidates.length; cursor++) {
      controller.signal.throwIfAborted();
      if (cursor >= end || files.length >= MAX_RESULT_FILES || chars >= MAX_DIFF_CHARS) break;
      const name = candidates[cursor]!, staged = current.get(name), committed = previous.get(name);
      if ([staged, committed].some(entry => entry && (!allowed(entry) || protectedOids.has(entry.oid)))
        || (protectedRemoval && !committed)) { skipped++; continue; }
      try {
        sourcePath(canonical, name, false);
        const before = options.mode === 'staged' ? await blob(committed) : await blob(staged);
        const after = options.mode === 'staged' ? await blob(staged) : existsSync(sourcePath(canonical, name, false)) ? readSource(canonical, name).content : null;
        if (before === after) continue;
        const diff = redactAgentText(unified(name, before, after)); chars += diff.length;
        files.push({ path: name, status: before === null ? 'added' : after === null ? 'deleted' : 'modified', diff,
          beforeSha256: before === null ? null : hash(before), afterSha256: after === null ? null : hash(after) });
      } catch {
        controller.signal.throwIfAborted(); skipped++;
      }
    }
    return { mode: options.mode, files, skipped, nextOffset: cursor < candidates.length ? cursor : null,
      truncated: cursor < candidates.length, coverage: 'permitted regular text files <=64KiB; no symlinks, gitlinks or hidden/secret paths',
      includesUntracked: options.mode === 'working' && !!options.includeUntracked, readOnly: true,
      repositoryStatus: 'not_assessed',
      note: 'This is a diff PAGE, not a repository status or total count. Empty files never proves a clean workspace; use get_project_git_status for counts. Continue with nextOffset when truncated. Snapshot of HEAD/index/worktree; concurrent edits may change it. Offsets traverse candidate paths, not matching files.' };

    async function blob(entry: Entry | undefined): Promise<string | null> {
      if (!entry) return null;
      if (!allowed(entry) || protectedOids.has(entry.oid)) throw new Error('scope');
      const size = Number((await git(['cat-file', '-s', entry.oid], 1024)).trim());
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SOURCE_BYTES) throw new Error('size');
      const text = await git(['cat-file', 'blob', entry.oid], MAX_SOURCE_BYTES + 1);
      if (text.includes('\0')) throw new Error('binary');
      return text;
    }
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', abort); }
}

export function assertGitRoot(root: string): void {
  const dir = path.join(root, '.git');
  try {
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink() || realpathSync(dir) !== dir) throw new Error('root');
    for (const relative of ['commondir', 'objects/info/alternates', 'objects/info/http-alternates']) if (existsSync(path.join(dir, relative))) throw new Error('alternate');
    // Git opens nested loose objects, packs and refs itself. Checking just their
    // parent directories would still permit links into another project.
    const pending = [dir]; let entries = 0;
    while (pending.length) {
      const parent = pending.pop()!;
      const directory = opendirSync(parent);
      try {
        let entry;
        while ((entry = directory.readSync()) !== null) {
          if (++entries > 20_000) throw new Error('metadata limit');
          const target = path.join(parent, entry.name), stat = lstatSync(target);
          if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('link or special file');
          if (realpathSync(target) !== target) throw new Error('external metadata');
          if (stat.isDirectory()) pending.push(target);
        }
      } finally { directory.closeSync(); }
    }
  } catch { throw new Error('COPILOT_GIT_ROOT_UNSUPPORTED'); }
}
function allowed(entry: Entry): boolean {
  try { permittedSourcePath(entry.path); return REGULAR_MODES.has(entry.mode) && entry.stage === '0' && /^[0-9a-f]{40,64}$/.test(entry.oid); }
  catch { return false; }
}
function parseIndex(text: string): Entry[] {
  const result = text.split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t'), [mode, oid, stage] = record.slice(0, tab).split(' ');
    return { path: record.slice(tab + 1), mode: mode!, oid: oid!, stage: stage! };
  });
  if (result.length > MAX_FILES) throw new Error('COPILOT_GIT_FILE_LIMIT');
  return result;
}
function parseTree(text: string): Entry[] {
  return text.split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t'), [mode, _kind, oid] = record.slice(0, tab).split(' ');
    return { path: record.slice(tab + 1), mode: mode!, oid: oid!, stage: '0' };
  });
}
/** One complete changed hunk with three context lines; display only, never an executable patch. */
function unified(name: string, before: string | null, after: string | null): string {
  const lines = (text: string | null) => text === null || text === '' ? [] : text.split('\n');
  const a = lines(before), b = lines(after); let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length-prefix && suffix < b.length-prefix && a[a.length-1-suffix] === b[b.length-1-suffix]) suffix++;
  const start = Math.max(0, prefix-3), endA = a.length-Math.max(0,suffix-3), endB = b.length-Math.max(0,suffix-3);
  return [`--- ${before === null ? '/dev/null' : `a/${name}`}`, `+++ ${after === null ? '/dev/null' : `b/${name}`}`,
    `@@ -${start+1},${endA-start} +${start+1},${endB-start} @@`, ...a.slice(start,prefix).map(line=>' '+line),
    ...a.slice(prefix,a.length-suffix).map(line=>'-'+line), ...b.slice(prefix,b.length-suffix).map(line=>'+'+line),
    ...b.slice(b.length-suffix,endB).map(line=>' '+line)].join('\n');
}
