import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SHELL_COMMAND_DEFAULT_TIMEOUT_MS, SHELL_COMMAND_MAX_LENGTH, SHELL_COMMAND_MAX_TIMEOUT_MS } from '../shell-command-execution.js';
import { safeResolve } from '../../lib/safe-resolve.js';
import { AgentError } from './types.js';
import type { Database } from '../../db/types.js';

/**
 * Goal sandbox: an isolated copy of the project root where goal runs edit and
 * verify files without touching the real project. The sandbox is created
 * lazily on the first write, reused afterwards (idempotent), kept after
 * cancel (audit) and after merge. Paths are always sandbox-relative and
 * guarded by safeResolve plus per-component symlink checks, mirroring the
 * development workspace guards.
 */

export const GOAL_SANDBOX_EXCLUDES = ['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'vendor'] as const;
/**
 * Creation-time manifest: every copied path with its sha256 (the merge base).
 * Merge deletions are limited to it, and the hashes drive the three-way merge.
 */
export const GOAL_MANIFEST_NAME = '.goal-manifest.json';
const MAX_FILE_BYTES = 512 * 1024;
const MAX_READ_BYTES = 512 * 1024;
const MAX_DIFF_LINES = 2000;
const MAX_DIFF_RESPONSE_BYTES = 512 * 1024;

const sandboxBases = new WeakMap<Database, string>();

/**
 * Root that holds every goal sandbox. Production uses
 * `<FORGEBADGER_STATE_DIR>/goal-sandboxes`; file-backed test databases fall
 * back to a sibling of the database file, in-memory ones to a per-database
 * private temp directory (cached, 0700).
 */
export function goalSandboxBase(db: Database): string {
  const existing = sandboxBases.get(db);
  if (existing) return existing;
  const fromEnv = process.env.FORGEBADGER_STATE_DIR;
  const raw = fromEnv
    ? path.join(fromEnv, 'goal-sandboxes')
    : db.name && db.name !== ':memory:'
      ? path.join(path.dirname(path.resolve(db.name)), 'goal-sandboxes')
      : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forgebadger-goal-sandboxes-')), 'sandboxes');
  fs.mkdirSync(raw, { recursive: true, mode: 0o700 });
  const base = fs.realpathSync(raw);
  fs.chmodSync(base, 0o700);
  sandboxBases.set(db, base);
  return base;
}

export function goalSandboxDir(db: Database, goalId: string): string {
  return path.join(goalSandboxBase(db), goalId);
}

function isExcluded(relative: string): boolean {
  return relative.split('/').some(part => (GOAL_SANDBOX_EXCLUDES as readonly string[]).includes(part));
}

/** sandbox-relative path resolution with traversal, absolute and symlink-escape rejection. */
export function sandboxPath(root: string, relative: string): string {
  if (typeof relative !== 'string' || !relative.trim()) throw new AgentError('COPILOT_GOAL_PATH_INVALID', 'A non-empty sandbox-relative path is required');
  const resolved = safeResolve(root, relative);
  let current = fs.realpathSync(root);
  for (const part of relative.split(/[\\/]+/u)) {
    if (!part || part === '.') continue;
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new AgentError('COPILOT_GOAL_PATH_INVALID', `Symbolic links are not allowed inside the goal sandbox: ${relative}`);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return resolved;
}

function copyTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if ((GOAL_SANDBOX_EXCLUDES as readonly string[]).includes(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) continue; // never copy or follow symlinks
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
  }
}

function hashFile(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listTree(root: string): string[] {
  const files: string[] = [];
  (function walk(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === GOAL_MANIFEST_NAME) continue;
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!isExcluded(relative)) walk(full); }
      else if (entry.isFile() && !isExcluded(relative)) files.push(relative);
    }
  })(root);
  return files.sort();
}

/** Lazily materialize the sandbox as a copy of the project root; reuse if present. */
export function ensureGoalSandbox(projectRoot: string, sandboxDir: string): string {
  const project = fs.realpathSync(projectRoot);
  const existing = fs.existsSync(sandboxDir) ? fs.realpathSync(sandboxDir) : undefined;
  if (existing) {
    if (existing !== path.resolve(sandboxDir)) throw new AgentError('COPILOT_GOAL_SANDBOX_INVALID', 'Goal sandbox path must not be a symbolic link');
    if (!fs.lstatSync(existing).isDirectory()) throw new AgentError('COPILOT_GOAL_SANDBOX_INVALID', 'Goal sandbox is not a directory');
    return existing;
  }
  const parent = path.dirname(sandboxDir);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = path.join(parent, `.staging-${process.pid}-${Date.now()}`);
  try {
    copyTree(project, staging);
    const files = Object.fromEntries(listTree(staging).map(relative => [relative, hashFile(path.join(staging, relative))]));
    fs.writeFileSync(path.join(staging, GOAL_MANIFEST_NAME), JSON.stringify({ version: 2, files }), { mode: 0o600 });
    fs.renameSync(staging, sandboxDir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return fs.realpathSync(sandboxDir);
}

/**
 * Paths goal file tools must never touch. Git metadata (`.git` is a gitdir
 * pointer inside a worktree) and CLI configuration that a dispatched CLI
 * would execute from (hooks, MCP servers, plugins) are owner territory.
 */
const PROTECTED_CLI_CONFIG = new Set(['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', 'opencode.json', 'opencode.jsonc']);
const PROTECTED_CLI_DIRECTORIES = ['.claude/hooks/', '.codex/', '.opencode/', '.grok/', '.kimi/', '.pi/'];

function assertGoalToolPath(relative: string, write: boolean): void {
  const normalized = relative.replace(/\\/gu, '/').split('/').filter(part => part && part !== '.').join('/');
  if (normalized.split('/').some(part => part.toLowerCase() === '.git'))
    throw new AgentError('COPILOT_GOAL_PATH_INVALID', `Git metadata is not accessible to goal file tools: ${relative}`);
  const lower = normalized.toLowerCase();
  if (write && (PROTECTED_CLI_CONFIG.has(lower) || PROTECTED_CLI_DIRECTORIES.some(prefix => lower.startsWith(prefix))))
    throw new AgentError('COPILOT_GOAL_PATH_INVALID', `CLI configuration cannot be written by goal file tools: ${relative}`);
}

export function readSandboxFile(sandboxDir: string, relative: string, offset = 0, limit?: number): { path: string; content: string; totalLines: number; truncated: boolean } {
  assertGoalToolPath(relative, false);
  const target = sandboxPath(sandboxDir, relative);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new AgentError('COPILOT_GOAL_PATH_INVALID', 'Not a regular file');
    if (stat.size > MAX_READ_BYTES) throw new AgentError('COPILOT_GOAL_FILE_TOO_LARGE', `Sandbox files are limited to ${MAX_READ_BYTES} bytes`);
    const buffer = Buffer.allocUnsafe(stat.size);
    let read = 0;
    while (read < buffer.length) { const count = fs.readSync(fd, buffer, read, buffer.length - read, null); if (!count) break; read += count; }
    if (buffer.subarray(0, read).includes(0)) throw new AgentError('COPILOT_GOAL_PATH_INVALID', 'Binary files cannot be read as text');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, read));
    const lines = text.split('\n');
    const start = Math.max(0, offset);
    const end = limit === undefined ? lines.length : Math.min(lines.length, start + Math.max(1, limit));
    return { path: relative, content: lines.slice(start, end).join('\n'), totalLines: lines.length, truncated: end < lines.length };
  } finally { fs.closeSync(fd); }
}

export function writeSandboxFile(sandboxDir: string, relative: string, content: string): { path: string; bytes: number } {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new AgentError('COPILOT_GOAL_FILE_TOO_LARGE', `Sandbox file writes are limited to ${MAX_FILE_BYTES} bytes`);
  assertGoalToolPath(relative, true);
  const target = sandboxPath(sandboxDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) throw new AgentError('COPILOT_GOAL_PATH_INVALID', 'Target exists and is not a regular file');
  fs.writeFileSync(target, content);
  return { path: relative, bytes: Buffer.byteLength(content) };
}

export function editSandboxFile(sandboxDir: string, relative: string, oldString: string, newString: string): { path: string; replacements: number } {
  if (!oldString) throw new AgentError('COPILOT_GOAL_INPUT_INVALID', 'old_string must be non-empty');
  if (Buffer.byteLength(oldString) > MAX_FILE_BYTES || Buffer.byteLength(newString) > MAX_FILE_BYTES)
    throw new AgentError('COPILOT_GOAL_FILE_TOO_LARGE', `Edit strings are limited to ${MAX_FILE_BYTES} bytes`);
  assertGoalToolPath(relative, true);
  if (oldString === newString) return { path: relative, replacements: 0 };
  const { content } = readSandboxFile(sandboxDir, relative);
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) throw new AgentError('COPILOT_GOAL_EDIT_NO_MATCH', `old_string was not found in ${relative}`);
  if (occurrences > 1) throw new AgentError('COPILOT_GOAL_EDIT_AMBIGUOUS', `old_string matches ${occurrences} locations in ${relative}; provide more context`);
  return { ...writeSandboxFile(sandboxDir, relative, content.replace(oldString, newString)), replacements: 1 };
}

// ---------------------------------------------------------------------------
// Diff generation (minimal unified LCS diff, line based)
// ---------------------------------------------------------------------------

export function isBinary(buffer: Buffer): boolean { return buffer.subarray(0, 8192).includes(0); }

export function unifiedDiff(before: string, after: string, filePath: string): { diff: string; truncated: boolean } {
  const a = before === '' ? [] : before.replace(/\n$/u, '').split('\n');
  const b = after === '' ? [] : after.replace(/\n$/u, '').split('\n');
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return { diff: `--- a/${filePath}\n+++ b/${filePath}\n@@ file exceeds ${MAX_DIFF_LINES} diff lines @@\n`, truncated: true };
  }
  const width = b.length;
  const table: number[] = new Array((a.length + 1) * (b.length + 1)).fill(0);
  const index = (i: number, j: number) => i * (width + 1) + j;
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      table[index(i, j)] = a[i] === b[j] ? table[index(i + 1, j + 1)]! + 1 : Math.max(table[index(i + 1, j)]!, table[index(i, j + 1)]!);
  const hunks: string[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; }
    else if (table[index(i + 1, j)]! >= table[index(i, j + 1)]!) { hunks.push(`-${a[i]}`); i += 1; }
    else { hunks.push(`+${b[j]}`); j += 1; }
  }
  while (i < a.length) { hunks.push(`-${a[i]}`); i += 1; }
  while (j < b.length) { hunks.push(`+${b[j]}`); j += 1; }
  const header = `--- ${a.length ? `a/${filePath}` : '/dev/null'}\n+++ ${b.length ? `b/${filePath}` : '/dev/null'}\n@@ -${a.length ? 1 : 0},${a.length} +${b.length ? 1 : 0},${b.length} @@\n`;
  return { diff: header + hunks.join('\n') + '\n', truncated: false };
}

export interface GoalFileChange { path: string; status: 'added' | 'modified' | 'deleted'; diff: string; truncated: boolean }

/**
 * Sandbox vs project root, file by file, limited to what a merge would act
 * on: files the sandbox left at their base content and project-only files
 * added after sandbox creation are skipped. Response is capped; the cut file
 * is flagged truncated.
 */
export function diffGoalSandbox(sandboxDir: string, projectRoot: string): { files: GoalFileChange[]; truncated: boolean } {
  if (!fs.existsSync(sandboxDir)) return { files: [], truncated: false };
  const project = fs.realpathSync(projectRoot);
  const sandboxList = listTree(sandboxDir);
  const manifest = readManifest(sandboxDir, sandboxList);
  const sandboxAll = new Set(sandboxList);
  const sandboxFiles = new Set(sandboxList.filter(relative => {
    const base = manifest.hashes?.get(relative);
    return base === undefined || base !== hashFile(path.join(sandboxDir, relative));
  }));
  const projectFiles = new Set(listTree(project));
  const files: GoalFileChange[] = [];
  let bytes = 0;
  let truncated = false;
  const emit = (change: GoalFileChange): boolean => {
    bytes += Buffer.byteLength(change.diff) + change.path.length + 32;
    if (bytes > MAX_DIFF_RESPONSE_BYTES) { truncated = true; return false; }
    files.push(change);
    return true;
  };
  for (const relative of sandboxFiles) {
    const inProject = projectFiles.has(relative);
    const sandboxTarget = sandboxPath(sandboxDir, relative);
    const sandboxBuffer = fs.readFileSync(sandboxTarget);
    if (isBinary(sandboxBuffer)) {
      const placeholder = `--- a/${relative}\n+++ b/${relative}\n@@ binary file omitted @@\n`;
      if (!emit({ path: relative, status: inProject ? 'modified' : 'added', diff: placeholder, truncated: false })) break;
      continue;
    }
    const sandboxText = sandboxBuffer.toString('utf8');
    if (!inProject) {
      const { diff, truncated: fileTruncated } = unifiedDiff('', sandboxText, relative);
      if (!emit({ path: relative, status: 'added', diff, truncated: fileTruncated })) break;
      continue;
    }
    const projectTarget = sandboxPath(project, relative);
    const projectBuffer = fs.readFileSync(projectTarget);
    if (isBinary(projectBuffer)) {
      if (!emit({ path: relative, status: 'modified', diff: `--- a/${relative}\n+++ b/${relative}\n@@ binary file omitted @@\n`, truncated: false })) break;
      continue;
    }
    const projectText = projectBuffer.toString('utf8');
    if (projectText === sandboxText) continue;
    const { diff, truncated: fileTruncated } = unifiedDiff(projectText, sandboxText, relative);
    if (!emit({ path: relative, status: 'modified', diff, truncated: fileTruncated })) break;
  }
  if (!truncated) {
    for (const relative of projectFiles) {
      if (sandboxAll.has(relative) || !manifest.paths.has(relative)) continue;
      const projectBuffer = fs.readFileSync(sandboxPath(project, relative));
      if (isBinary(projectBuffer)) {
        if (!emit({ path: relative, status: 'deleted', diff: '(binary file omitted)\n', truncated: false })) break;
        continue;
      }
      const { diff, truncated: fileTruncated } = unifiedDiff(projectBuffer.toString('utf8'), '', relative);
      if (!emit({ path: relative, status: 'deleted', diff, truncated: fileTruncated })) break;
    }
  }
  return { files, truncated };
}

// ---------------------------------------------------------------------------
// Merge (dry-run conflicts, manifest-bounded deletions, external-file keep)
// ---------------------------------------------------------------------------

interface GoalManifest {
  paths: Set<string>;
  /** Creation-time sha256 per path; null for legacy (v1, path-only) manifests. */
  hashes: Map<string, string> | null;
}

function readManifest(sandboxDir: string, sandboxFiles: string[]): GoalManifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(sandboxDir, GOAL_MANIFEST_NAME), 'utf8')) as unknown;
    if (Array.isArray(parsed)) {
      return { paths: new Set(parsed.filter((entry): entry is string => typeof entry === 'string')), hashes: null };
    }
    const files = (parsed as { files?: unknown } | null)?.files;
    if (files && typeof files === 'object' && !Array.isArray(files)) {
      const hashes = new Map<string, string>();
      for (const [relative, hash] of Object.entries(files)) if (typeof hash === 'string') hashes.set(relative, hash);
      return { paths: new Set(hashes.keys()), hashes };
    }
  } catch { /* missing or malformed manifest: fall through */ }
  return { paths: new Set(sandboxFiles), hashes: null };
}

interface GoalMergePlan { copy: string[]; remove: string[]; kept: string[]; conflicts: string[] }

function hashIfFile(target: string): string | undefined {
  return fs.existsSync(target) && fs.lstatSync(target).isFile() ? hashFile(target) : undefined;
}

function mergePathTypeConflict(project: string, relative: string, deletion = false): string | undefined {
  if (!deletion) {
    const parts = relative.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const ancestor = parts.slice(0, index).join('/');
      const ancestorTarget = path.join(project, ancestor);
      if (fs.existsSync(ancestorTarget) && !fs.lstatSync(ancestorTarget).isDirectory())
        return `${relative} (parent path '${ancestor}' is a file in the project)`;
    }
  }
  const target = path.join(project, relative);
  if (fs.existsSync(target) && fs.lstatSync(target).isDirectory()) {
    return deletion
      ? `${relative} (deletion target became a directory in the project)`
      : `${relative} (a directory exists in the project)`;
  }
  return undefined;
}

/**
 * Three-way merge plan (base = manifest hash, ours = sandbox, theirs =
 * project). A path is copied only when the sandbox changed it and the
 * project did not (or changed it identically); deletions likewise require an
 * unchanged project file. Divergent edits are conflicts, never overwrites.
 * Legacy path-only manifests have no base, so they keep the v1 overwrite
 * semantics. Type conflicts only apply to paths the sandbox actually changed.
 */
function planGoalMerge(sandboxDir: string, project: string): GoalMergePlan {
  const sandboxFiles = listTree(sandboxDir);
  const sandboxSet = new Set(sandboxFiles);
  const manifest = readManifest(sandboxDir, sandboxFiles);
  const plan: GoalMergePlan = { copy: [], remove: [], kept: [], conflicts: [] };
  for (const relative of sandboxFiles) {
    const ours = hashFile(sandboxPath(sandboxDir, relative));
    const base = manifest.hashes?.get(relative);
    if (base === ours) continue; // sandbox left it alone: keep any project-side edit or type change
    const typeConflict = mergePathTypeConflict(project, relative);
    if (typeConflict) { plan.conflicts.push(typeConflict); continue; }
    const target = path.join(project, relative);
    const theirs = hashIfFile(target);
    if (theirs === ours) continue; // already identical
    if (!manifest.hashes) { plan.copy.push(relative); continue; }
    if (theirs === base) plan.copy.push(relative); // only the sandbox changed it (or added it)
    else if (base === undefined) plan.conflicts.push(`${relative} (added in both sandbox and project with different content)`);
    else if (theirs === undefined) plan.conflicts.push(`${relative} (modified in the sandbox but deleted in the project)`);
    else plan.conflicts.push(`${relative} (modified in both sandbox and project)`);
  }
  for (const relative of manifest.paths) {
    if (sandboxSet.has(relative) || isExcluded(relative)) continue;
    const typeConflict = mergePathTypeConflict(project, relative, true);
    if (typeConflict) { plan.conflicts.push(typeConflict); continue; }
    const target = path.join(project, relative);
    if (!fs.existsSync(target)) continue;
    const base = manifest.hashes?.get(relative);
    if (base !== undefined && hashFile(target) !== base) {
      plan.conflicts.push(`${relative} (deleted in the sandbox but modified in the project)`);
    } else {
      plan.remove.push(relative);
    }
  }
  // Files that appeared on the project side after sandbox creation survive.
  for (const relative of listTree(project)) {
    if (!sandboxSet.has(relative) && !manifest.paths.has(relative)) plan.kept.push(relative);
  }
  return plan;
}

/** Return all content and type conflicts in one merge plan, without writing. */
export function detectMergeConflicts(sandboxDir: string, projectRoot: string): string[] {
  if (!fs.existsSync(sandboxDir)) return [];
  const project = fs.realpathSync(projectRoot);
  return [...new Set(planGoalMerge(sandboxDir, project).conflicts)].sort();
}

export interface GoalMergeResult { merged: string[]; deleted: string[]; kept: string[] }

/**
 * Apply the sandbox to the project root with three-way semantics: only
 * sandbox-side changes are written, project-side edits made after sandbox
 * creation are preserved, and any divergence aborts the whole merge before
 * the first write. Returns the three path classes.
 */
export function mergeGoalSandbox(sandboxDir: string, projectRoot: string): GoalMergeResult {
  if (!fs.existsSync(sandboxDir)) throw new AgentError('COPILOT_GOAL_SANDBOX_MISSING', 'Goal sandbox does not exist; nothing to merge');
  const project = fs.realpathSync(projectRoot);
  const plan = planGoalMerge(sandboxDir, project);
  const conflicts = [...new Set(plan.conflicts)].sort();
  if (conflicts.length) throw new AgentError('COPILOT_GOAL_MERGE_CONFLICT', `Merge conflicts: ${conflicts.join('; ')}`);
  for (const relative of plan.copy) {
    const to = sandboxPath(project, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(sandboxPath(sandboxDir, relative), to);
  }
  for (const relative of plan.remove) fs.rmSync(sandboxPath(project, relative));
  return { merged: plan.copy.sort(), deleted: plan.remove.sort(), kept: plan.kept.sort() };
}

// ---------------------------------------------------------------------------
// Sandbox command execution (host shell, sandbox cwd, host environment)
// ---------------------------------------------------------------------------

export interface SandboxCommandResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number; truncated: boolean }

const COMMAND_OUTPUT_CAP = 48 * 1024;

/**
 * Minimal command environment. The model controls the command line, so the
 * child must never see gateway secrets: start from a small name allowlist and
 * drop anything FORGEBADGER_* or KEY/SECRET/TOKEN/PASSWORD-named regardless.
 */
const COMMAND_ENV_ALLOWLIST = new Set(['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'USER', 'LOGNAME', 'TMPDIR', 'SHELL',
  'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'ProgramData']);
const COMMAND_ENV_DENIED = /FORGEBADGER_|KEY|SECRET|TOKEN|PASSWORD/iu;

export function sandboxCommandEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!COMMAND_ENV_ALLOWLIST.has(name)) continue;
    if (COMMAND_ENV_DENIED.test(name)) continue;
    env[name] = value;
  }
  return env;
}

/**
 * Run a shell command with the sandbox as cwd. Reuses the shell-command
 * length/timeout ceilings (default 5 min, max 10 min) and the 48 KiB output
 * truncation convention. v1 runs with a minimal, secret-free environment
 * inside the copy; isolation is by convention, not an OS-level sandbox.
 */
export function runSandboxCommand(cwd: string, command: string, timeoutMs?: number, signal?: AbortSignal): Promise<SandboxCommandResult> {
  const trimmed = command.trim();
  if (!trimmed) return Promise.reject(new AgentError('COPILOT_GOAL_INPUT_INVALID', 'command must be non-empty'));
  if (trimmed.length > SHELL_COMMAND_MAX_LENGTH) return Promise.reject(new AgentError('COPILOT_GOAL_INPUT_INVALID', `command exceeds ${SHELL_COMMAND_MAX_LENGTH} characters`));
  const limit = timeoutMs === undefined ? SHELL_COMMAND_DEFAULT_TIMEOUT_MS : Math.min(SHELL_COMMAND_MAX_TIMEOUT_MS, Math.max(1, Math.trunc(timeoutMs)));
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn(trimmed, { cwd, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: sandboxCommandEnv() });
    let stdout = ''; let stderr = ''; let truncated = false;
    const cap = (value: string) => {
      if (Buffer.byteLength(value) <= COMMAND_OUTPUT_CAP) return value;
      truncated = true;
      return value.slice(-COMMAND_OUTPUT_CAP);
    };
    child.stdout.on('data', chunk => { stdout = cap(stdout + (chunk as Buffer).toString()); });
    child.stderr.on('data', chunk => { stderr = cap(stderr + (chunk as Buffer).toString()); });
    let settled = false;
    const finish = (result: Omit<SandboxCommandResult, 'durationMs' | 'truncated'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ ...result, truncated, durationMs: Date.now() - started });
    };
    const kill = () => { try { if (process.platform !== 'win32') process.kill(-child.pid!, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(() => { kill(); finish({ exitCode: null, stdout, stderr, timedOut: true }); }, limit);
    timer.unref?.();
    const onAbort = () => { kill(); finish({ exitCode: null, stdout, stderr, timedOut: false }); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', () => finish({ exitCode: null, stdout, stderr, timedOut: false }));
    child.on('close', code => finish({ exitCode: code, stdout, stderr, timedOut: false }));
  });
}
