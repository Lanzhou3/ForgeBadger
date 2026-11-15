import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentError } from './types.js';

/**
 * Opt-in OS isolation for `goal_run_checks` (macOS seatbelt).
 *
 * The admin "goal check isolation" switch (runtime setting
 * `goal_check_sandbox`, Copilot settings page) runs every check inside
 * `sandbox-exec`; a host that cannot isolate refuses the command instead of
 * falling back. What the profile enforces for the check process tree:
 * writes only inside the goal workspace and a per-call scratch directory
 * (never Git metadata, the copy-sandbox manifest or CLI configuration), no
 * reads of the home directory, the ForgeBadger state directory or the real
 * project, no network, no Mach services beyond user lookup, and no view of
 * other processes (their environment holds the Gateway secrets).
 *
 * It is not a trust boundary for workspace CONTENT: the model can already
 * write workspace files through the goal file tools.
 */

export type GoalCheckSandboxMode = 'off' | 'on';
export type GoalCheckIsolation = 'seatbelt' | 'none';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const SCRATCH_DIRNAME = 'goal-check-scratch';
/** Longer than the 10 minute command ceiling, so a live call is never swept. */
const STALE_SCRATCH_MS = 30 * 60_000;

/** Process-wide: pushed by the runtime-settings applier, read at each call. */
let configuredMode: GoalCheckSandboxMode = 'off';

export function setGoalCheckSandboxMode(mode: GoalCheckSandboxMode): void {
  configuredMode = mode;
}

export function goalCheckSandboxMode(): GoalCheckSandboxMode {
  return configuredMode;
}

/** True when this call must take the host path and therefore needs the owner's per-call approval. */
export function isUnsandboxedCheckRequest(input: unknown): boolean {
  return configuredMode === 'on' && !!input && typeof input === 'object'
    && (input as { unsandboxed?: unknown }).unsandboxed === true;
}

/** Workspace-relative paths a dispatched CLI executes from; shared with the goal file tools. */
export const PROTECTED_CLI_CONFIG_FILES = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', 'opencode.json', 'opencode.jsonc'] as const;
export const PROTECTED_CLI_CONFIG_DIRECTORIES = ['.claude/hooks', '.codex', '.opencode', '.grok', '.kimi', '.pi'] as const;

/**
 * System locations outside the home directory that hold other users' or
 * applications' data. `/Library/Preferences` stays readable: the Xcode
 * command-line shims (`/usr/bin/python3`, `git`, `cc`) read their license
 * state there and refuse to start without it.
 */
const SYSTEM_READ_DENIES = ['/Users', '/Volumes', '/private/var/folders', '/private/tmp', '/private/var/tmp',
  '/private/var/run', '/Library/Keychains', '/Library/Application Support'];

/**
 * sysctl names toolchains read at startup. Everything else is denied: with
 * `process-info*` also denied this closes KERN_PROCARGS2, which otherwise
 * returns the environment of every same-user process.
 */
const SYSCTL_PREFIXES = ['hw.', 'machdep.', 'vm.', 'security.'];
const SYSCTL_NAMES = ['kern.osrelease', 'kern.ostype', 'kern.osversion', 'kern.version', 'kern.hostname',
  'kern.maxfilesperproc', 'kern.argmax', 'kern.ngroups', 'kern.osproductversion', 'kern.boottime', 'kern.clockrate',
  'kern.usrstack64', 'kern.secure_kernel', 'kern.osvariant_status', 'kern.iossupportversion', 'kern.maxproc',
  'sysctl.name2oid', 'kern.bootargs', 'kern.willshutdown'];

/** Content-addressed package stores that sit inside otherwise allowed toolchain directories. */
const PACKAGE_STORES = ['Library/pnpm/store', '.local/share/pnpm/store'];

/** Version-manager install trees under the home directory (read-only; none of them stores credentials). */
const KNOWN_TOOLCHAIN_DIRS = ['.cache/node/corepack', '.nvm/versions', '.local/share/fnm', '.volta/tools', '.asdf/installs',
  '.local/share/mise/installs', '.pyenv/versions', '.rbenv/versions', '.rustup/toolchains', '.cargo/bin', '.bun/bin',
  '.deno/bin', 'go/bin', 'Library/pnpm'];

export interface SeatbeltProfileInput {
  /** Canonical (realpath) absolute paths. */
  workspace: string;
  scratch: string;
  home: string;
  /** Directories whose whole subtree is unreadable, in addition to `home` and the system list. */
  denyRead: string[];
  /** Read-only subtrees re-opened after the denies (toolchains, the shared git directory). */
  allowRead: string[];
}

function assertProfilePath(value: string): string {
  // SBPL has no escape for control characters, and a relative path would be matched against nothing.
  if (!path.isAbsolute(value) || /[\u0000-\u001f\u007f]/u.test(value))
    throw new AgentError('COPILOT_GOAL_SANDBOX_UNAVAILABLE', 'A sandbox path is not a plain absolute path');
  return value;
}

const quote = (value: string) => JSON.stringify(assertProfilePath(value));
const subpath = (value: string) => `(subpath ${quote(value)})`;
const literal = (value: string) => `(literal ${quote(value)})`;

function ancestorsOf(paths: string[]): string[] {
  const result = new Set<string>();
  for (const entry of paths) {
    let current = path.dirname(entry);
    while (current !== path.dirname(current)) { result.add(current); current = path.dirname(current); }
  }
  return [...result];
}

/**
 * Pure profile text. Seatbelt applies the LAST matching rule, so the order
 * below is the policy: broad allow, then denies, then narrow re-allows, then
 * the write denies that must win over the workspace allow.
 */
export function buildSeatbeltProfile(input: SeatbeltProfileInput): string {
  const { workspace, scratch } = input;
  const inWorkspace = (relative: string) => path.join(workspace, relative);
  const readDenies = [...new Set([input.home, ...input.denyRead, ...SYSTEM_READ_DENIES])];
  const readAllows = [...new Set([workspace, scratch, ...input.allowRead])];
  const protectedFiles = ['.git', '.goal-manifest.json', ...PROTECTED_CLI_CONFIG_FILES, ...PROTECTED_CLI_CONFIG_DIRECTORIES];
  const protectedTrees = ['.git', ...PROTECTED_CLI_CONFIG_DIRECTORIES];
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(allow network* (local unix-socket ${subpath(scratch)}) (remote unix-socket ${subpath(scratch)}))`,
    '(deny mach-lookup)',
    '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))',
    '(deny mach-priv-task-port)',
    '(deny signal)',
    '(allow signal (target same-sandbox))',
    '(deny sysctl-read)',
    `(allow sysctl-read ${SYSCTL_PREFIXES.map(prefix => `(sysctl-name-prefix ${JSON.stringify(prefix)})`).join(' ')} (sysctl-name ${SYSCTL_NAMES.map(name => JSON.stringify(name)).join(' ')}))`,
    '(deny sysctl-write)',
    '(deny process-info*)',
    '(allow process-info* (target self))',
    '(deny file-write*)',
    `(allow file-write* ${subpath(workspace)} ${subpath(scratch)} (literal "/dev/null") (literal "/dev/dtracehelper") (literal "/dev/tty"))`,
    `(deny file-write* ${protectedFiles.map(entry => literal(inWorkspace(entry))).join(' ')} ${protectedTrees.map(entry => subpath(inWorkspace(entry))).join(' ')})`,
    // `.claude` holds protected leaves, so the directory itself must not be renamed away, replaced or
    // created as a symlink; files beside the protected ones stay writable.
    `(deny file-write-create file-write-unlink ${literal(inWorkspace('.claude'))})`,
    `(deny file-read* ${readDenies.map(subpath).join(' ')})`,
    `(allow file-read* ${readAllows.map(subpath).join(' ')})`,
    // A package store holds every project's dependencies; an allowed toolchain root must not re-open it.
    `(deny file-read* ${PACKAGE_STORES.map(store => subpath(path.join(input.home, store))).join(' ')})`,
    `(allow file-read-metadata ${ancestorsOf(readAllows).map(literal).join(' ')})`
  ].join('\n');
}

function realpathOrNull(value: string): string | null {
  try { return fs.realpathSync(value); } catch { return null; }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Home-directory subtrees the check may read: PATH entries, the Node install
 * that runs the Gateway and well-known version-manager trees. A root that
 * would re-open the home directory, the state directory or the real project
 * is dropped, so a Node binary in `~/bin` cannot unmask `$HOME`.
 */
export function toolchainReadRoots(input: { home: string; protectedRoots: string[]; pathValue?: string; execPath?: string }): string[] {
  const { home } = input;
  const candidates: Array<{ root: string; minDepth: number }> = [];
  for (const entry of (input.pathValue ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    if (!path.isAbsolute(entry)) continue;
    candidates.push({ root: path.resolve(entry), minDepth: 2 });
    const resolved = realpathOrNull(entry);
    if (resolved) candidates.push({ root: resolved, minDepth: 2 });
  }
  const node = realpathOrNull(input.execPath ?? process.execPath);
  if (node) candidates.push({ root: path.dirname(path.dirname(node)), minDepth: 3 });
  for (const known of KNOWN_TOOLCHAIN_DIRS) {
    const resolved = realpathOrNull(path.join(home, known));
    if (resolved) candidates.push({ root: resolved, minDepth: 2 });
  }
  const roots = new Set<string>();
  for (const { root, minDepth } of candidates) {
    if (!isInside(home, root) || root === home) continue;
    if (path.relative(home, root).split(path.sep).length < minDepth) continue;
    if (input.protectedRoots.some(blocked => isInside(root, blocked) || isInside(blocked, root))) continue;
    roots.add(root);
  }
  return [...roots];
}

let capability: { available: boolean; reason: string | null } | undefined;

/** Probed once per process: the platform, the binary and whether a profile using our vocabulary applies. */
export function goalCheckSandboxCapability(): { available: boolean; reason: string | null } {
  if (capability) return capability;
  if (process.platform !== 'darwin') return capability = { available: false, reason: 'OS isolation for goal checks is only implemented for macOS' };
  try {
    fs.accessSync(SANDBOX_EXEC, fs.constants.X_OK);
    const probe = spawnSync(SANDBOX_EXEC, ['-p', buildSeatbeltProfile({ workspace: '/private/var/empty', scratch: '/private/var/empty', home: '/private/var/empty', denyRead: [], allowRead: [] }), '/usr/bin/true'],
      { env: { PATH: '/usr/bin:/bin' }, timeout: 5_000, stdio: 'ignore' });
    // A probe that timed out under load says nothing about the host: answer "unavailable" for this call only.
    if (probe.error) return { available: false, reason: 'the sandbox-exec probe did not finish' };
    return capability = probe.status === 0 ? { available: true, reason: null } : { available: false, reason: 'sandbox-exec rejected the goal check profile' };
  } catch {
    return capability = { available: false, reason: 'sandbox-exec is not available on this host' };
  }
}

/** Test seam: forget the cached probe. */
export function resetGoalCheckSandboxCapability(): void { capability = undefined; }

function removeScratch(directory: string): void {
  try { fs.rmSync(directory, { recursive: true, force: true }); return; } catch { /* a 000 or immutable entry left by the command */ }
  try {
    spawnSync('/usr/bin/chflags', ['-R', 'nouchg', directory], { stdio: 'ignore', timeout: 10_000 });
    spawnSync('/bin/chmod', ['-R', 'u+rwx', directory], { stdio: 'ignore', timeout: 10_000 });
    fs.rmSync(directory, { recursive: true, force: true });
  } catch { /* best effort: the stale sweep retries on a later call */ }
}

function sweepStaleScratch(base: string): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const target = path.join(base, entry.name);
    try { if (entry.isDirectory() && Date.now() - fs.lstatSync(target).mtimeMs > STALE_SCRATCH_MS) removeScratch(target); } catch { /* raced */ }
  }
}

export interface CheckSandboxPlan {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
}

export interface CheckSandboxInput {
  /** Goal workspace (worktree or copy). */
  workspace: string;
  /** The real project root; its subtree is unreadable except a shared `.git` directory. */
  projectRoot?: string;
  command: string;
  env: NodeJS.ProcessEnv;
}

const UNAVAILABLE_HELP = 'Goal check isolation is on: every check needs an isolated run and never falls back to the host. '
  + 'Retry with unsandboxed: true (the owner approves each such call) or ask the owner with goal_ask_user.';

/**
 * Build the `sandbox-exec` invocation for one check. Throws
 * COPILOT_GOAL_SANDBOX_UNAVAILABLE without running anything when the host
 * cannot isolate or the profile for these paths does not apply.
 */
export function prepareCheckSandbox(input: CheckSandboxInput): CheckSandboxPlan {
  const probe = goalCheckSandboxCapability();
  if (!probe.available) throw new AgentError('COPILOT_GOAL_SANDBOX_UNAVAILABLE', `${probe.reason}. ${UNAVAILABLE_HELP}`);
  const workspace = fs.realpathSync(input.workspace);
  const home = fs.realpathSync(os.homedir());
  // <state>/goal-worktrees/<goal> or <state>/goal-sandboxes/<goal>: everything else under <state> is Gateway data.
  const stateRoot = path.dirname(path.dirname(workspace));
  const configuredState = process.env.FORGEBADGER_STATE_DIR ? realpathOrNull(process.env.FORGEBADGER_STATE_DIR) : null;
  const projectRoot = input.projectRoot ? realpathOrNull(input.projectRoot) : null;
  const denyRead = [stateRoot, ...(configuredState ? [configuredState] : []), ...(projectRoot ? [projectRoot] : [])]
    .filter(entry => entry !== path.parse(entry).root);
  const scratchBase = path.join(stateRoot, SCRATCH_DIRNAME);
  fs.mkdirSync(scratchBase, { recursive: true, mode: 0o700 });
  sweepStaleScratch(scratchBase);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(scratchBase, `${randomBytes(4).toString('hex')}-`)));
  const cleanup = () => removeScratch(scratch);
  try {
    const allowRead = toolchainReadRoots({ home, protectedRoots: [...denyRead, workspace] });
    // The shared git directory is derived from the trusted project path, never from the workspace's own `.git` pointer.
    const commonGit = projectRoot ? path.join(projectRoot, '.git') : null;
    if (commonGit && fs.existsSync(commonGit) && fs.lstatSync(commonGit).isDirectory()) allowRead.push(commonGit);
    const profile = buildSeatbeltProfile({ workspace, scratch, home, denyRead, allowRead });
    const corepack = realpathOrNull(path.join(home, '.cache/node/corepack'));
    const env: NodeJS.ProcessEnv = { ...input.env, HOME: scratch, TMPDIR: scratch, ...(corepack ? { COREPACK_HOME: corepack } : {}) };
    // A profile is path-specific: prove it applies before running the command, so a profile
    // failure is never mistaken for a failing check.
    const preflight = spawnSync(SANDBOX_EXEC, ['-p', profile, '/usr/bin/true'], { cwd: workspace, env, timeout: 5_000, stdio: 'ignore' });
    if (preflight.status !== 0)
      throw new AgentError('COPILOT_GOAL_SANDBOX_UNAVAILABLE', `sandbox-exec could not apply the profile for this workspace. ${UNAVAILABLE_HELP}`);
    return { file: SANDBOX_EXEC, args: ['-p', profile, '/bin/sh', '-c', input.command], env, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Appended to a failed isolated check so the model can tell a sandbox limit from a real failure. */
export const SANDBOX_FAILURE_HINT = 'This check ran inside the macOS sandbox: no network (including localhost), Git metadata and CLI configuration are read-only, '
  + 'and the home directory, the real project and other processes are not readable. Dependency installs, local servers, real PTYs and commits cannot run there. '
  + 'If the failure comes from one of these limits, rerun the same command with unsandboxed: true — the owner approves each such call — instead of retrying it unchanged.';

/** Logged when the switch is applied so `on` on an unsupported host is not discovered through failing goals. */
export function goalCheckSandboxStartupWarning(): string | null {
  if (goalCheckSandboxMode() !== 'on') return null;
  const probe = goalCheckSandboxCapability();
  return probe.available ? null
    : `Goal check isolation is on but this host cannot isolate goal checks (${probe.reason}); every goal_run_checks call will need unsandboxed: true and owner approval.`;
}
