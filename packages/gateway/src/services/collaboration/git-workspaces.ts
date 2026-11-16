import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { execFile } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, copyFileSync, rmdirSync, statSync, readFileSync, writeFileSync, unlinkSync, renameSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { safeResolve, validateProjectRoot } from "../../lib/safe-resolve.js";
import { CollaborationError } from "./types.js";
import type { InspectedWorktree, IntegrateWorktreeInput, ProvisionedWorktree, ProvisionWorktreeInput } from "./runtime-types.js";
import { WORKTREE_BRANCH_PREFIXES } from "./worktree-branches.js";

interface GitLease { path:string; token:string; ownerPid:number; childPid:number|null; phase:'idle'|'spawning'|'running' }
const gitLease=new AsyncLocalStorage<GitLease>();
function saveLease(lease:GitLease):void { writeFileSync(join(lease.path,'owner.json'),JSON.stringify(lease),{mode:0o600}); }
function alive(pid:number):boolean { try { process.kill(pid,0);return true; } catch(error) { return (error as NodeJS.ErrnoException).code!=='ESRCH'; } }
function reclaimLock(lock:string):boolean {
 try {
  if(lstatSync(lock).isSymbolicLink()||lstatSync(join(lock,'owner.json')).isSymbolicLink()) return false;
  const first=readFileSync(join(lock,'owner.json'),'utf8'),lease=JSON.parse(first) as GitLease;
  if(!Number.isInteger(lease.ownerPid)||lease.ownerPid<1||alive(lease.ownerPid)||lease.phase==='spawning') return false;
  if(lease.phase==='running'&&(!Number.isInteger(lease.childPid)||lease.childPid!<1||alive(lease.childPid!))) return false;
  if(lease.phase!=='running'&&lease.phase!=='idle') return false;
  // Only a known dead owner and known completed child may release this lock. Never signal a stored PID.
  const claim=join(lock,'reclaim');let fd:number;try {fd=openSync(claim,'wx',0o600);}catch{return false;}closeSync(fd);
  if(readFileSync(join(lock,'owner.json'),'utf8')!==first) {unlinkSync(claim);return false;}
  const retired=lock+'.retired-'+randomUUID();renameSync(lock,retired);rmSync(retired,{recursive:true});return true;
 } catch { return false; }
}

const GIT_SAFETY_ARGS = ["-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, "-c", "core.fsmonitor=false", "-c", "diff.external=", "-c", "commit.gpgsign=false", "-c", "merge.verifySignatures=false", "-c", "rerere.enabled=false"];
const MAX_GIT_OUTPUT = 2 * 1024 * 1024;
const MAX_DIFF = 128 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

function fail(message: string): never {
  throw new CollaborationError(409, "COLLABORATION_WORKSPACE_CONFLICT", message);
}

function canonicalRoot(value: string): string {
  if (!isAbsolute(value) || validateProjectRoot(value) !== value || !statSync(value).isDirectory()) {
    fail("Workspace must be an existing canonical directory without symlink aliases");
  }
  return value;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C"
  };
}

async function disabledFilterArgs(cwd: string): Promise<string[]> {
  return new Promise((resolveArgs, reject) => {
    execFile("git", [...GIT_SAFETY_ARGS, "config", "--null", "--name-only", "--get-regexp", "^(filter\\..*\\.(clean|smudge|process|required)|merge\\..*\\.driver)$"], {
      cwd, env: gitEnv(), timeout: 5000, maxBuffer: 64 * 1024, encoding: "utf8"
    }, (error, stdout) => {
      if (error && error.code !== 1) { reject(new Error("Cannot safely inspect Git filter configuration")); return; }
      const keys = stdout.split("\0").filter(Boolean);
      resolveArgs(keys.flatMap((key) => ["-c", `${key}=${key.endsWith(".required") || key.endsWith(".driver") ? "false" : ""}`]));
    });
  });
}

class GitOperationError extends CollaborationError {
  constructor(readonly ordinaryConflict: boolean) { super(409, 'COLLABORATION_GIT_FAILED', 'Git operation failed or exceeded its output/time limit'); }
}

async function git(cwd: string, args: string[], authorize?:()=>void, extraEnv?: NodeJS.ProcessEnv): Promise<string> {
  canonicalRoot(cwd);
  const before = statSync(cwd);
  const filters = await disabledFilterArgs(cwd);
  const output = await new Promise<string>((resolveOutput, reject) => {
    authorize?.();
    const lease=gitLease.getStore();if(lease) {lease.phase='spawning';lease.childPid=null;saveLease(lease);}
    const child=execFile("git", [...GIT_SAFETY_ARGS, ...filters, ...args], {
      cwd, env: { ...gitEnv(), ...extraEnv }, timeout: 15_000, maxBuffer: MAX_GIT_OUTPUT, encoding: "utf8"
    }, (error, stdout) => {
      if(lease) {lease.phase='idle';lease.childPid=null;saveLease(lease);}
      if (error) reject(new GitOperationError(error.code === 1 && !error.killed && !error.signal));
      else resolveOutput(stdout);
    });
    if(lease&&child.pid) {lease.phase='running';lease.childPid=child.pid;saveLease(lease);}
  });
  const after = statSync(canonicalRoot(cwd));
  if (before.ino !== after.ino || before.dev !== after.dev) fail("Workspace directory changed during Git operation");
  return output;
}

async function repository(root: string): Promise<{ root: string; common: string }> {
  canonicalRoot(root);
  try {
    if (lstatSync(join(root, ".git")).isSymbolicLink()) fail("Git metadata must not be a symlink");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("Workspace must be the Git top-level root");
    throw error;
  }
  const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
  if (top !== root) fail("Workspace must be the Git top-level root");
  const common = canonicalRoot(resolve(root, (await git(root, ["rev-parse", "--git-common-dir"])).trim()));
  return { root, common };
}

async function locked<T>(sourcePath: string, action: (common: string) => Promise<T>): Promise<T> {
  const repo = await repository(sourcePath);
  const lock = safeResolve(repo.common, "forgebadger-collaboration.lock");
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch {
    if(!reclaimLock(lock)) throw new CollaborationError(409, "COLLABORATION_WORKSPACE_BUSY", "Repository is busy or has an unresolved workspace lock");
    try { mkdirSync(lock,{mode:0o700}); } catch { throw new CollaborationError(409,'COLLABORATION_WORKSPACE_BUSY'); }
  }
  const lease:GitLease={path:lock,token:randomUUID(),ownerPid:process.pid,childPid:null,phase:'idle'};saveLease(lease);
  try { return await gitLease.run(lease,()=>action(repo.common)); }
  finally { unlinkSync(join(lock,'owner.json'));rmdirSync(lock); }
}

function commitArgument(value: string): string {
  if (!COMMIT.test(value)) fail("Expected an exact Git commit SHA");
  return value;
}

async function head(root: string): Promise<string> {
  return commitArgument((await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim());
}

async function assertClean(root: string, protectIgnored = false): Promise<void> {
  const args = ["status", "--porcelain=v1", "-z", "--untracked-files=all"];
  if (protectIgnored) args.push("--ignored=matching");
  if ((await git(root, args)).length) fail("Working tree must be clean; dirty files were preserved");
}

export async function provisionWorktree(input: ProvisionWorktreeInput): Promise<ProvisionedWorktree> {
  input.authorize?.();
  if (input.mergeCommit) commitArgument(input.mergeCommit);
  if (!UUID.test(input.runId)) fail("Invalid run UUID");
  const workspacesRoot = canonicalRoot(input.workspacesRoot);
  const relativeRoot = relative(input.sourcePath, workspacesRoot);
  if (!relativeRoot || (!relativeRoot.startsWith(`..${sep}`) && relativeRoot !== ".." && !isAbsolute(relativeRoot))) {
    fail("Managed workspaces must be outside the source repository");
  }
  const path = safeResolve(workspacesRoot, input.runId);
  const prefix = input.branchPrefix ?? "codex/task-";
  if (!WORKTREE_BRANCH_PREFIXES.includes(prefix)) fail("Invalid managed workspace branch prefix");
  const branch = `${prefix}${input.runId}`;
  return locked(input.sourcePath, async () => {
    try { lstatSync(path); fail("Workspace target already exists"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const targetBranch = (await git(input.sourcePath, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    const baseCommit = input.baseCommit ? commitArgument(input.baseCommit) : await head(input.sourcePath);
    if ((await git(input.sourcePath, ["rev-parse", "--verify", `${baseCommit}^{commit}`])).trim() !== baseCommit) {
      fail("Base must be an exact commit, not a tag object");
    }
    canonicalRoot(workspacesRoot);
    await git(input.sourcePath, ["worktree", "add", "-b", branch, "--", path, baseCommit], input.authorize);
    canonicalRoot(path);
    if (input.mergeCommit) await mergeForReconciliation(path, input.mergeCommit, input.authorize);
    input.authorize?.();
    return { path, branch, baseCommit, targetBranch };
  });
}

async function conflictPaths(root: string): Promise<string[]> {
  return (await git(root, ["diff", "--no-ext-diff", "--name-only", "--diff-filter=U", "-z", "--"]))
    .split("\0").filter(Boolean);
}

async function mergeForReconciliation(root: string, commit: string, authorize?: () => void): Promise<void> {
  try {
    await git(root, ["-c", "user.name=ForgeBadger", "-c", "user.email=forgebadger@localhost",
      "merge", "--no-ff", "--no-edit", "--no-stat", "--no-verify", "--no-gpg-sign", "--no-overwrite-ignore", "--", commit], authorize);
  } catch (error) {
    // Only an actual unmerged index is recoverable through the new private CLI.
    // Timeouts, missing objects and authorization errors must remain failures.
    if (!(error instanceof GitOperationError) || !error.ordinaryConflict
      || !(await conflictPaths(root)).length) throw error;
    authorize?.();
  }
}

export async function inspectWorktree(input: { path: string; baseCommit: string }): Promise<InspectedWorktree> {
  await repository(input.path);
  const commit = await head(input.path);
  const status = await git(input.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const changed = await git(input.path, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z", commitArgument(input.baseCommit), commit, "--"]);
  const fields = changed.split("\0");
  const files: InspectedWorktree["files"] = [];
  for (let index = 0; index + 1 < fields.length && files.length < 200; index += 2) {
    if (fields[index] && fields[index + 1]) files.push({ status: fields[index]!, path: fields[index + 1]! });
  }
  if (await head(input.path) !== commit) fail("Workspace HEAD changed during inspection");
  return { commit, dirty: status.length > 0, files, conflicts: await conflictPaths(input.path) };
}

export async function readDeliveryDiff(input: { path: string; baseCommit: string; filePath: string }): Promise<string> {
  await repository(input.path);
  if (!input.filePath || input.filePath.includes("\0")) fail("Invalid delivery file path");
  safeResolve(input.path, input.filePath);
  const output = await git(input.path, ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", commitArgument(input.baseCommit), "HEAD", "--", input.filePath]);
  return output.length <= MAX_DIFF ? output : `${output.slice(0, MAX_DIFF)}\n[Diff truncated]`;
}

export async function integrateWorktree(input: IntegrateWorktreeInput): Promise<{ commit: string }> {
  commitArgument(input.baseCommit); commitArgument(input.expectedCommit);
  return locked(input.sourcePath, async (common) => {
    if ((await repository(input.path)).common !== common) fail("Workspace belongs to another repository");
    const branch = (await git(input.sourcePath, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    if (branch !== input.targetBranch) fail("Source target branch changed");
    if (await head(input.sourcePath) !== input.baseCommit) fail("Source base revision changed or diverged");
    if (await head(input.path) !== input.expectedCommit) fail("Workspace commit changed");
    await assertClean(input.sourcePath); await assertClean(input.path);
    await git(input.sourcePath, ["merge-base", "--is-ancestor", input.baseCommit, input.expectedCommit]);
    await git(input.sourcePath, ["merge", "--ff-only", "--no-overwrite-ignore", "--no-edit", "--no-stat", "--", input.expectedCommit],input.authorize);
    if (await head(input.sourcePath) !== input.expectedCommit) fail("Source commit changed during integration");
    await assertClean(input.sourcePath);
    return { commit: input.expectedCommit };
  });
}

export async function closeWorktree(input: { sourcePath: string; path: string; branch: string }): Promise<void> {
  if (!input.branch.startsWith("codex/task-") || !UUID.test(input.branch.slice("codex/task-".length))) fail("Invalid managed workspace branch");
  await locked(input.sourcePath, async (common) => {
    if (input.path === input.sourcePath || (await repository(input.path)).common !== common) fail("Invalid managed workspace repository");
    const branch = (await git(input.path, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    if (branch !== input.branch) fail("Workspace branch changed");
    await assertClean(input.path, true);
    await git(input.sourcePath, ["worktree", "remove", "--", input.path]);
    // Preserve the generated branch and commits for recovery; never force-delete.
  });
}

export async function reconcileIntegration(input: IntegrateWorktreeInput):Promise<'integrated'|'not_applied'> {
 return locked(input.sourcePath,async()=>{
  const branch=(await git(input.sourcePath,['symbolic-ref','--quiet','--short','HEAD'])).trim();
  if(branch!==input.targetBranch) fail('Integration target branch changed; manual inspection required');
  await assertClean(input.sourcePath);
  const commit=await head(input.sourcePath);
  if(commit===input.expectedCommit) return 'integrated';
  if(commit===input.baseCommit) return 'not_applied';
  fail('Integration outcome is ambiguous; manual inspection required');
 });
}

/** No PID-only release: an unknown Git spawn/child keeps revocation pending. */
export async function isRepositoryGitIdle(sourcePath: string): Promise<boolean> {
  try { return await locked(sourcePath, async () => true); }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// Goal worktrees: Copilot goal workspaces merged by the owner over HTTP. Same
// safety envelope as delivery (hooks/filters disabled, repository lock, exact
// SHAs). Unlike delivery, the owner merge commits pending worktree edits and
// fast-forwards the source branch, merging a moved source head into the goal
// branch first; conflicts abort that merge and leave both trees untouched.
// ---------------------------------------------------------------------------

// Integration branch of a goal or a fleet scope (task branches are `goal-task-` and never match).
const GOAL_BRANCH = /^forgebadger\/(?:goal|fleet)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const GOAL_IDENTITY = ["-c", "user.name=ForgeBadger Goal", "-c", "user.email=forgebadger@localhost"];

export interface GoalWorktreeChange { status: "added" | "modified" | "deleted"; path: string }

function goalBranch(value: string): string {
  if (!GOAL_BRANCH.test(value)) fail("Invalid goal workspace branch");
  return value;
}

function excludePathspecs(paths: readonly string[]): string[] {
  return ["--", ".", ...paths.map((entry) => `:(exclude,literal)${entry}`)];
}

function parseNameStatus(output: string): GoalWorktreeChange[] {
  const fields = output.split("\0");
  const changes: GoalWorktreeChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const code = fields[index], path = fields[index + 1];
    if (!code || !path) continue;
    changes.push({ status: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified", path });
  }
  return changes;
}

function porcelainPaths(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 3).map((entry) => entry.slice(3));
}

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try { await git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]); return true; }
  catch (error) { if (error instanceof GitOperationError && error.ordinaryConflict) return false; throw error; }
}

/**
 * Tracked CLI hook files rewritten in the worktree by hook materialization
 * would make `git merge` refuse ("commit or stash"). They are never part of
 * the goal's work, so reset them; the next session launch rewrites them.
 */
async function restoreManagedPaths(cwd: string, paths: readonly string[]): Promise<void> {
  if (!paths.length) return;
  const dirty = (await git(cwd, ["--literal-pathspecs", "diff", "--name-only", "-z", "HEAD", "--", ...paths])).split("\0").filter(Boolean);
  if (dirty.length) await git(cwd, ["--literal-pathspecs", "checkout", "HEAD", "--", ...dirty]);
}

async function currentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
}

/** Worktree vs base commit: committed and working-tree edits plus untracked files, managed paths excluded. */
export async function listGoalWorktreeChanges(input: { path: string; baseCommit: string; excludePaths: readonly string[] }): Promise<GoalWorktreeChange[]> {
  await repository(input.path);
  const tracked = parseNameStatus(await git(input.path, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z",
    commitArgument(input.baseCommit), ...excludePathspecs(input.excludePaths)]));
  const untracked = (await git(input.path, ["ls-files", "--others", "--exclude-standard", "-z", ...excludePathspecs(input.excludePaths)]))
    .split("\0").filter(Boolean).map((path) => ({ status: "added" as const, path }));
  return [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path));
}

/** Unified diff of one tracked path, base commit vs working tree. */
export async function readGoalWorktreeDiff(input: { path: string; baseCommit: string; filePath: string }): Promise<string> {
  await repository(input.path);
  if (!input.filePath || input.filePath.includes("\0")) fail("Invalid goal workspace file path");
  safeResolve(input.path, input.filePath);
  return git(input.path, ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
    commitArgument(input.baseCommit), "--", input.filePath]);
}

/** Commit every pending worktree edit except managed paths; returns the new HEAD, or undefined when nothing was staged. */
export async function commitGoalWorktree(input: { path: string; branch: string; message: string; excludePaths: readonly string[] }): Promise<string | undefined> {
  return commitPendingEdits(input.path, goalBranch(input.branch), input.message, input.excludePaths);
}

async function commitPendingEdits(path: string, branch: string, message: string, excludePaths: readonly string[]): Promise<string | undefined> {
  await repository(path);
  if (await currentBranch(path) !== branch) fail("Goal workspace branch changed");
  await git(path, ["add", "-A", ...excludePathspecs(excludePaths)]);
  if (!(await git(path, ["diff", "--cached", "--name-only", "-z"])).length) return undefined;
  await git(path, [...GOAL_IDENTITY, "commit", "--no-verify", "--no-gpg-sign", "--quiet", "-m", message]);
  return head(path);
}

export interface GoalIntegration { commit: string; previous: string; changes: GoalWorktreeChange[] }

/**
 * Fast-forward the source branch to the goal branch. A source head that moved
 * since the fork is merged into the goal branch first (conflicts abort it and
 * are reported by path). Overlapping uncommitted source edits and committed
 * managed paths are refused rather than overwritten.
 */
export async function integrateGoalWorktree(input: { sourcePath: string; path: string; branch: string; targetBranch: string; excludePaths: readonly string[] }): Promise<GoalIntegration> {
  const branch = goalBranch(input.branch);
  return locked(input.sourcePath, async (common) => {
    if ((await repository(input.path)).common !== common) fail("Goal workspace belongs to another repository");
    const sourceBranch = await currentBranch(input.sourcePath);
    if (sourceBranch !== input.targetBranch) fail(`Project is on branch '${sourceBranch}', not '${input.targetBranch}'; switch back before merging`);
    if (await currentBranch(input.path) !== branch) fail("Goal workspace branch changed");
    if ((await git(input.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", ...excludePathspecs(input.excludePaths)])).length) {
      fail("Goal workspace has uncommitted changes");
    }
    const previous = await head(input.sourcePath);
    let tip = await head(input.path);
    // Nothing of the goal's own to bring over (the project may have moved on):
    // never manufacture an empty merge commit on the owner's branch.
    if (tip === previous || await isAncestor(input.path, tip, previous)) {
      // Keep the goal branch on the advanced merge base so later diffs stay forward-only.
      if (tip !== previous) {
        await restoreManagedPaths(input.path, input.excludePaths);
        await git(input.path, ["merge", "--ff-only", "--no-overwrite-ignore", "--no-edit", "--no-stat", "--", previous]);
      }
      return { commit: previous, previous, changes: [] };
    }
    if (!(await isAncestor(input.path, previous, tip))) {
      await restoreManagedPaths(input.path, input.excludePaths);
      try {
        await git(input.path, [...GOAL_IDENTITY, "merge", "--no-ff", "--no-edit", "--no-stat", "--no-verify", "--no-gpg-sign", "--no-overwrite-ignore", "--", previous]);
      } catch (error) {
        const conflicts = error instanceof GitOperationError && error.ordinaryConflict ? await conflictPaths(input.path) : [];
        await git(input.path, ["merge", "--abort"]).catch(() => undefined);
        if (conflicts.length) throw new CollaborationError(409, "GOAL_MERGE_CONFLICT", `Conflicts with project changes: ${conflicts.join(", ")}`);
        throw error;
      }
      tip = await head(input.path);
    }
    const changes = parseNameStatus(await git(input.sourcePath, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z", previous, tip, "--"]));
    const managed = changes.filter((change) => input.excludePaths.includes(change.path)).map((change) => change.path);
    if (managed.length) fail(`Goal branch commits CLI-managed files: ${managed.join(", ")}`);
    const touched = new Set(changes.map((change) => change.path));
    const overlap = porcelainPaths(await git(input.sourcePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]))
      .filter((path) => touched.has(path));
    if (overlap.length) fail(`Project has uncommitted changes in: ${overlap.join(", ")}`);
    await git(input.sourcePath, ["merge", "--ff-only", "--no-overwrite-ignore", "--no-edit", "--no-stat", "--", tip]);
    if (await head(input.sourcePath) !== tip) fail("Project commit changed during merge");
    return { commit: tip, previous, changes };
  });
}

/**
 * Re-adopt a goal worktree whose provisioning outlived its database record
 * (crash between `worktree add` and persistence). The base is the fork point
 * with the source head, never a guess beyond the repository's own history.
 */
export async function adoptGoalWorktree(input: { sourcePath: string; path: string; branch: string }): Promise<{ baseCommit: string; targetBranch: string }> {
  const branch = goalBranch(input.branch);
  return locked(input.sourcePath, async (common) => {
    if ((await repository(input.path)).common !== common) fail("Goal workspace belongs to another repository");
    if (await currentBranch(input.path) !== branch) fail("Goal workspace branch changed");
    const targetBranch = await currentBranch(input.sourcePath);
    const baseCommit = commitArgument((await git(input.sourcePath, ["merge-base", await head(input.sourcePath), await head(input.path)])).trim());
    return { baseCommit, targetBranch };
  });
}

// ---------------------------------------------------------------------------
// Goal task worktrees (parallel writers). One extra worktree per task, forked
// from the goal branch tip on `forgebadger/goal-task-<taskId>`. Same safety
// envelope as the goal worktree; the repository lock is taken through the
// goal worktree (it shares the common git directory with the project). Nothing
// here touches the project branch or the project working tree.
// ---------------------------------------------------------------------------

const GOAL_TASK_BRANCH_PREFIX = "forgebadger/goal-task-";
const GOAL_TASK_BRANCH = /^forgebadger\/goal-task-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LOCK_RETRY_MS = 3000;
const LOCK_RETRY_STEP_MS = 100;

export function goalTaskBranchName(taskId: string): string {
  if (!UUID.test(taskId)) fail("Invalid task UUID");
  return `${GOAL_TASK_BRANCH_PREFIX}${taskId}`;
}

function goalTaskBranch(value: string): string {
  if (!GOAL_TASK_BRANCH.test(value)) fail("Invalid goal task workspace branch");
  return value;
}

export class GoalTaskConflictError extends CollaborationError {
  constructor(readonly paths: string[]) {
    super(409, "GOAL_TASK_CONFLICT", `Task changes conflict with the goal branch: ${paths.join(", ")}`);
  }
}

/** `locked` that waits briefly for a concurrent git operation instead of failing at once. */
async function lockedRetry<T>(sourcePath: string, action: (common: string) => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_RETRY_MS;
  for (;;) {
    try { return await locked(sourcePath, action); }
    catch (error) {
      if (!(error instanceof CollaborationError) || error.code !== "COLLABORATION_WORKSPACE_BUSY") throw error;
      if (Date.now() >= deadline)
        throw new CollaborationError(409, "GOAL_TASK_BUSY", "Another git operation on this goal is in progress, try again in a moment");
      await new Promise((done) => setTimeout(done, LOCK_RETRY_STEP_MS));
    }
  }
}

async function mergeInProgress(cwd: string): Promise<boolean> {
  try { await git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]); return true; }
  catch (error) { if (error instanceof GitOperationError && error.ordinaryConflict) return false; throw error; }
}

/** We own these trees: a merge left behind by a crash is aborted so the goal never wedges. */
async function abortStaleMerge(cwd: string, label: string, recovered: string[]): Promise<void> {
  if (!(await mergeInProgress(cwd))) return;
  await git(cwd, ["merge", "--abort"]);
  recovered.push(label);
}

/** HEAD and index of a tree, so a rollback restores both (staged vs unstaged edits included). */
async function snapshotTree(cwd: string): Promise<() => Promise<void>> {
  const before = await head(cwd);
  // write-tree fails on intent-to-add entries; those fall back to a plain HEAD reset.
  const index = await git(cwd, ["write-tree"]).then((value) => commitArgument(value.trim())).catch(() => undefined);
  return async () => {
    await git(cwd, ["reset", "--mixed", "--quiet", before]);
    if (index) await git(cwd, ["read-tree", index]);
  };
}

interface TaskTrees { goalPath: string; goalBranch: string; taskPath: string; taskBranch: string }

async function assertTaskTrees(trees: TaskTrees, common: string, recovered?: string[]): Promise<void> {
  if (trees.taskPath === trees.goalPath) fail("Task workspace must be a separate worktree");
  if ((await repository(trees.taskPath)).common !== common) fail("Task workspace belongs to another repository");
  if (await currentBranch(trees.goalPath) !== trees.goalBranch) fail("Goal workspace branch changed");
  if (await currentBranch(trees.taskPath) !== trees.taskBranch) fail("Task workspace branch changed");
  if (!recovered) return;
  await abortStaleMerge(trees.goalPath, "goal", recovered);
  await abortStaleMerge(trees.taskPath, "task", recovered);
}

function workspacesRootOutside(goalPath: string, rootInput: string): string {
  const workspacesRoot = canonicalRoot(rootInput);
  const relativeRoot = relative(goalPath, workspacesRoot);
  if (!relativeRoot || (!relativeRoot.startsWith(`..${sep}`) && relativeRoot !== ".." && !isAbsolute(relativeRoot))) {
    fail("Task workspaces must be outside the goal worktree");
  }
  return workspacesRoot;
}

async function assertTargetAbsent(path: string): Promise<void> {
  try { lstatSync(path); fail("Workspace target already exists"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** True when a local branch of this exact name exists in the goal's repository. */
export async function goalTaskBranchExists(input: { goalPath: string; taskBranch: string }): Promise<boolean> {
  const branch = goalTaskBranch(input.taskBranch);
  await repository(input.goalPath);
  try { await git(input.goalPath, ["rev-parse", "-q", "--verify", `refs/heads/${branch}^{commit}`]); return true; }
  catch (error) { if (error instanceof GitOperationError && error.ordinaryConflict) return false; throw error; }
}

/** Task branch tip already contained in the goal branch (used when the task directory is gone). */
export async function goalTaskBranchIntegrated(input: { goalPath: string; goalBranch: string; taskBranch: string }): Promise<boolean> {
  const branch = goalTaskBranch(input.taskBranch);
  goalBranch(input.goalBranch);
  await repository(input.goalPath);
  return isAncestor(input.goalPath, `refs/heads/${branch}`, "HEAD");
}

/**
 * Checkpoint pending goal-tree edits, then fork a task worktree from the goal
 * branch tip. The target directory must not exist (existence is the record).
 */
export async function forkGoalTaskWorktree(input: { goalPath: string; goalBranch: string; workspacesRoot: string; taskId: string; message: string; excludePaths: readonly string[] }): Promise<{ path: string; branch: string; baseCommit: string; recovered: string[] }> {
  const parent = goalBranch(input.goalBranch);
  const branch = goalTaskBranchName(input.taskId);
  const workspacesRoot = workspacesRootOutside(input.goalPath, input.workspacesRoot);
  const path = safeResolve(workspacesRoot, input.taskId);
  return lockedRetry(input.goalPath, async () => {
    await assertTargetAbsent(path);
    if (await currentBranch(input.goalPath) !== parent) fail("Goal workspace branch changed");
    const recovered: string[] = [];
    await abortStaleMerge(input.goalPath, "goal", recovered);
    await commitPendingEdits(input.goalPath, parent, input.message, input.excludePaths);
    const baseCommit = await head(input.goalPath);
    await git(input.goalPath, ["worktree", "add", "-b", branch, "--", path, baseCommit]);
    canonicalRoot(path);
    return { path, branch, baseCommit, recovered };
  });
}

/** Bring a lost task worktree (directory deleted, branch kept) back on its existing branch. */
export async function restoreGoalTaskWorktree(input: { goalPath: string; workspacesRoot: string; taskId: string }): Promise<{ path: string; branch: string }> {
  const branch = goalTaskBranchName(input.taskId);
  const workspacesRoot = workspacesRootOutside(input.goalPath, input.workspacesRoot);
  const path = safeResolve(workspacesRoot, input.taskId);
  return lockedRetry(input.goalPath, async () => {
    await assertTargetAbsent(path);
    await git(input.goalPath, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
    await git(input.goalPath, ["worktree", "prune"]);
    await git(input.goalPath, ["worktree", "add", "--", path, branch]);
    canonicalRoot(path);
    return { path, branch };
  });
}

/** Read-only state of a task worktree relative to the goal branch (no lock, no writes). */
export async function inspectGoalTaskWorktree(input: TaskTrees & { excludePaths: readonly string[] }): Promise<{ dirty: boolean; integrated: boolean }> {
  const trees = { ...input, goalBranch: goalBranch(input.goalBranch), taskBranch: goalTaskBranch(input.taskBranch) };
  const goalRepo = await repository(trees.goalPath);
  await assertTaskTrees(trees, goalRepo.common);
  const dirty = (await git(trees.taskPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", ...excludePathspecs(input.excludePaths)])).length > 0;
  const integrated = !dirty && await isAncestor(trees.taskPath, await head(trees.taskPath), await head(trees.goalPath));
  return { dirty, integrated };
}

/**
 * Hash of the task tree's content right now (tracked + untracked, managed
 * paths excluded), computed in a throwaway copy of the index so nothing in the
 * worktree changes. Recorded at verification and compared at integration.
 */
export async function goalTaskTreeIdentity(input: TaskTrees & { excludePaths: readonly string[] }): Promise<string> {
  const trees = { ...input, goalBranch: goalBranch(input.goalBranch), taskBranch: goalTaskBranch(input.taskBranch) };
  await assertTaskTrees(trees, (await repository(trees.goalPath)).common);
  const dir = mkdtempSync(join(tmpdir(), "fb-tree-"));
  try {
    const index = join(dir, "index");
    const real = resolve(trees.taskPath, (await git(trees.taskPath, ["rev-parse", "--git-path", "index"])).trim());
    try { copyFileSync(real, index); } catch { /* no index yet: start empty */ }
    const env = { GIT_INDEX_FILE: index };
    await git(trees.taskPath, ["add", "-A", ...excludePathspecs(input.excludePaths)], undefined, env);
    return commitArgument((await git(trees.taskPath, ["write-tree"], undefined, env)).trim());
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Task tree (committed, uncommitted and untracked) vs. its fork point with the goal branch. */
export async function listGoalTaskWorktreeChanges(input: TaskTrees & { excludePaths: readonly string[] }): Promise<GoalWorktreeChange[]> {
  const goalRepo = await repository(input.goalPath);
  const trees = { ...input, goalBranch: goalBranch(input.goalBranch), taskBranch: goalTaskBranch(input.taskBranch) };
  await assertTaskTrees(trees, goalRepo.common);
  const forkPoint = commitArgument((await git(trees.goalPath, ["merge-base", await head(trees.goalPath), await head(trees.taskPath)])).trim());
  return listGoalWorktreeChanges({ path: trees.taskPath, baseCommit: forkPoint, excludePaths: input.excludePaths });
}

export interface GoalTaskIntegration { commit: string; previous: string; changes: GoalWorktreeChange[]; recovered: string[] }

/**
 * Merge a task branch into the goal branch (inside the goal worktree, `--no-ff`).
 * Pending edits of both trees are checkpoint-committed first (managed paths
 * excluded). A managed file the member committed is untracked again in a
 * ForgeBadger commit on the task branch (file stays on disk); the merged diff
 * must still touch no managed path. A conflict aborts the merge and restores
 * HEAD and index of both trees. After a successful merge the task branch is
 * fast-forwarded to the merged tip, so rework starts from the integrated state.
 */
export async function integrateGoalTaskWorktree(input: TaskTrees & { message: string; excludePaths: readonly string[] }): Promise<GoalTaskIntegration> {
  const trees = { ...input, goalBranch: goalBranch(input.goalBranch), taskBranch: goalTaskBranch(input.taskBranch) };
  return lockedRetry(trees.goalPath, async (common) => {
    const recovered: string[] = [];
    await assertTaskTrees(trees, common, recovered);
    const rollbacks: Array<() => Promise<void>> = [];
    try {
      rollbacks.push(await snapshotTree(trees.taskPath), await snapshotTree(trees.goalPath));
      return { ...await integrateLocked(trees, input, rollbacks), recovered };
    } catch (error) {
      for (const undo of rollbacks.reverse()) await undo().catch(() => undefined);
      throw error;
    }
  });
}

async function managedTouched(trees: TaskTrees, forkPoint: string, taskTip: string, excludePaths: readonly string[]): Promise<string[]> {
  if (!excludePaths.length) return [];
  // Limited to the managed paths so the output stays tiny however large the task diff is.
  const committed = parseNameStatus(await git(trees.goalPath, ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z", forkPoint, taskTip, "--", ...excludePaths]));
  return committed.filter((change) => excludePaths.includes(change.path)).map((change) => change.path);
}

/** Put managed paths back to their fork-point state in the task branch's index (files stay on disk) and commit that. */
async function untrackManaged(trees: TaskTrees, forkPoint: string, paths: string[]): Promise<void> {
  await git(trees.taskPath, ["--literal-pathspecs", "reset", "-q", forkPoint, "--", ...paths]);
  if (!(await git(trees.taskPath, ["diff", "--cached", "--name-only", "-z"])).length) return;
  await git(trees.taskPath, [...GOAL_IDENTITY, "commit", "--no-verify", "--no-gpg-sign", "--quiet", "-m", "goal: leave ForgeBadger-managed files out of the task"]);
}

async function integrateLocked(trees: TaskTrees, input: { message: string; excludePaths: readonly string[] }, rollbacks: Array<() => Promise<void>>): Promise<Omit<GoalTaskIntegration, "recovered">> {
  await commitPendingEdits(trees.taskPath, trees.taskBranch, "goal: checkpoint task work", input.excludePaths);
  await commitPendingEdits(trees.goalPath, trees.goalBranch, "goal: checkpoint before task integration", input.excludePaths);
  const previous = await head(trees.goalPath);
  let taskTip = await head(trees.taskPath);
  const forkPoint = commitArgument((await git(trees.goalPath, ["merge-base", previous, taskTip])).trim());
  const managed = await managedTouched(trees, forkPoint, taskTip, input.excludePaths);
  if (managed.length) {
    await untrackManaged(trees, forkPoint, managed);
    taskTip = await head(trees.taskPath);
    const remaining = await managedTouched(trees, forkPoint, taskTip, input.excludePaths);
    if (remaining.length) fail(`Task branch commits CLI-managed files: ${remaining.join(", ")}`);
  }
  if (taskTip === previous || await isAncestor(trees.goalPath, taskTip, previous)) {
    rollbacks.length = 0;
    await fastForwardTaskBranch(trees, previous);
    return { commit: previous, previous, changes: [] };
  }
  try {
    await git(trees.goalPath, [...GOAL_IDENTITY, "merge", "--no-ff", "--no-edit", "--no-stat", "--no-verify", "--no-gpg-sign", "--no-overwrite-ignore", "-m", input.message, "--", trees.taskBranch]);
  } catch (error) {
    const conflicts = error instanceof GitOperationError && error.ordinaryConflict ? await conflictPaths(trees.goalPath).catch(() => []) : [];
    await git(trees.goalPath, ["merge", "--abort"]).catch(() => undefined);
    if (conflicts.length) throw new GoalTaskConflictError(conflicts);
    throw error;
  }
  // The merge is done: nothing below may un-merge it.
  rollbacks.length = 0;
  const tip = await head(trees.goalPath);
  const changes = await git(trees.goalPath, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z", previous, tip, "--"])
    .then(parseNameStatus).catch((): GoalWorktreeChange[] => []);
  await fastForwardTaskBranch(trees, tip);
  return { commit: tip, previous, changes };
}

/** Best effort: the merge already succeeded, and status derives from ancestry, so a failure here is harmless and retried on the next integrate. */
async function fastForwardTaskBranch(trees: TaskTrees, tip: string): Promise<void> {
  try {
    if (await head(trees.taskPath) === tip) return;
    await git(trees.taskPath, ["merge", "--ff-only", "--no-overwrite-ignore", "--no-edit", "--no-stat", "--", tip]);
  } catch { /* retried by the next integrate */ }
}

// ---------------------------------------------------------------------------
// Goal review checkouts: a one-off, detached copy of a tree's content right
// now, for a reviewer CLI. The snapshot is a dangling commit built in a
// throwaway index, so no branch, index or working tree of the goal or the task
// moves. Removing the checkout drops the only reference to that commit.
// ---------------------------------------------------------------------------

const REVIEW_CHECKOUT_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-r[1-9]$/i;

function reviewCheckoutPath(goalPath: string, rootInput: string, name: string): string {
  if (!REVIEW_CHECKOUT_NAME.test(name)) fail("Invalid review checkout name");
  return safeResolve(workspacesRootOutside(goalPath, rootInput), name);
}

export interface GoalReviewCheckout { path: string; commit: string; baseCommit: string; tree: string }

/**
 * Snapshot `sourcePath` (the goal worktree or one of its task worktrees:
 * tracked, uncommitted and untracked content, managed paths excluded) and
 * check it out detached at `<workspacesRoot>/<name>`. `baseCommit` is what the
 * review diffs against; omitted, it is the fork point with the goal branch.
 */
export async function createGoalReviewCheckout(input: {
  goalPath: string; goalBranch: string; sourcePath: string; baseCommit?: string | undefined; workspacesRoot: string; name: string; excludePaths: readonly string[]
}): Promise<GoalReviewCheckout> {
  goalBranch(input.goalBranch);
  const path = reviewCheckoutPath(input.goalPath, input.workspacesRoot, input.name);
  return lockedRetry(input.goalPath, async (common) => {
    await assertTargetAbsent(path);
    if (await currentBranch(input.goalPath) !== input.goalBranch) fail("Goal workspace branch changed");
    if (input.sourcePath !== input.goalPath && (await repository(input.sourcePath)).common !== common) fail("Review source belongs to another repository");
    const parent = await head(input.sourcePath);
    const baseCommit = input.baseCommit !== undefined ? commitArgument(input.baseCommit)
      : commitArgument((await git(input.goalPath, ["merge-base", await head(input.goalPath), parent])).trim());
    const dir = mkdtempSync(join(tmpdir(), "fb-review-"));
    let tree: string, commit: string;
    try {
      const index = join(dir, "index");
      const real = resolve(input.sourcePath, (await git(input.sourcePath, ["rev-parse", "--git-path", "index"])).trim());
      try { copyFileSync(real, index); } catch { /* no index yet: start empty */ }
      const env = { GIT_INDEX_FILE: index };
      await git(input.sourcePath, ["add", "-A", ...excludePathspecs(input.excludePaths)], undefined, env);
      tree = commitArgument((await git(input.sourcePath, ["write-tree"], undefined, env)).trim());
      commit = commitArgument((await git(input.sourcePath, [...GOAL_IDENTITY, "commit-tree", tree, "-p", parent, "-m", "goal: review snapshot"])).trim());
    } finally { rmSync(dir, { recursive: true, force: true }); }
    await git(input.goalPath, ["worktree", "add", "--detach", "--", path, commit]);
    canonicalRoot(path);
    return { path, commit, baseCommit, tree };
  });
}

/** Unified diff the reviewer gets (base vs snapshot, managed paths excluded); undefined when it exceeds the git output cap. */
export async function readGoalReviewDiff(input: { path: string; baseCommit: string; commit: string; excludePaths: readonly string[] }): Promise<string | undefined> {
  await repository(input.path);
  try {
    return await git(input.path, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", commitArgument(input.baseCommit), commitArgument(input.commit),
      ...excludePathspecs(input.excludePaths)]);
  } catch (error) {
    if (error instanceof GitOperationError) return undefined;
    throw error;
  }
}

/** Delete a review checkout (forced: whatever the reviewer left there is discarded). Idempotent. */
export async function removeGoalReviewCheckout(input: { goalPath: string; workspacesRoot: string; name: string }): Promise<void> {
  const path = reviewCheckoutPath(input.goalPath, input.workspacesRoot, input.name);
  await lockedRetry(input.goalPath, async () => {
    let present = true;
    try { if (lstatSync(path).isSymbolicLink()) fail("Review checkout must not be a symlink"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; present = false; }
    if (present) {
      try { await git(input.goalPath, ["worktree", "remove", "--force", "--", path]); }
      catch (error) { if (!(error instanceof GitOperationError)) throw error; rmSync(path, { recursive: true, force: true }); }
    }
    await git(input.goalPath, ["worktree", "prune"]);
  });
}

/**
 * Remove a task worktree and its branch once nothing would be lost: no
 * uncommitted work besides managed paths, and the branch tip is contained in
 * the goal branch. Anything else is kept and reported. Idempotent.
 */
export async function removeIntegratedGoalTaskWorktree(input: { goalPath: string; goalBranch: string; workspacesRoot: string; taskId: string; excludePaths: readonly string[] }): Promise<"removed" | "kept" | "absent"> {
  goalBranch(input.goalBranch);
  const branch = goalTaskBranchName(input.taskId);
  const path = safeResolve(workspacesRootOutside(input.goalPath, input.workspacesRoot), input.taskId);
  return lockedRetry(input.goalPath, async (common) => {
    if (await currentBranch(input.goalPath) !== input.goalBranch) fail("Goal workspace branch changed");
    let present = true;
    try { if (lstatSync(path).isSymbolicLink()) fail("Task workspace must not be a symlink"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; present = false; }
    const hasBranch = await git(input.goalPath, ["rev-parse", "-q", "--verify", `refs/heads/${branch}^{commit}`]).then(() => true)
      .catch((error) => { if (error instanceof GitOperationError && error.ordinaryConflict) return false; throw error; });
    if (!present && !hasBranch) return "absent";
    if (hasBranch && !(await isAncestor(input.goalPath, `refs/heads/${branch}`, "HEAD"))) return "kept";
    if (present) {
      if ((await repository(path)).common !== common) fail("Task workspace belongs to another repository");
      if (await mergeInProgress(path)) return "kept";
      const dirty = (await git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", ...excludePathspecs(input.excludePaths)])).length > 0;
      if (dirty) return "kept";
      // Forced only past the managed hook files, which were just shown to be the sole leftovers.
      await git(input.goalPath, ["worktree", "remove", "--force", "--", path]);
    }
    await git(input.goalPath, ["worktree", "prune"]);
    if (hasBranch) await git(input.goalPath, ["branch", "-D", "--", branch]);
    return "removed";
  });
}
