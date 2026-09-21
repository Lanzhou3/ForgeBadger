import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { execFile } from "node:child_process";
import { lstatSync, mkdirSync, rmdirSync, statSync, readFileSync, writeFileSync, unlinkSync, renameSync, rmSync, openSync, closeSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { safeResolve, validateProjectRoot } from "../../lib/safe-resolve.js";
import { CollaborationError } from "./types.js";
import type { InspectedWorktree, IntegrateWorktreeInput, ProvisionedWorktree, ProvisionWorktreeInput } from "./runtime-types.js";

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

async function git(cwd: string, args: string[], authorize?:()=>void): Promise<string> {
  canonicalRoot(cwd);
  const before = statSync(cwd);
  const filters = await disabledFilterArgs(cwd);
  const output = await new Promise<string>((resolveOutput, reject) => {
    authorize?.();
    const lease=gitLease.getStore();if(lease) {lease.phase='spawning';lease.childPid=null;saveLease(lease);}
    const child=execFile("git", [...GIT_SAFETY_ARGS, ...filters, ...args], {
      cwd, env: gitEnv(), timeout: 15_000, maxBuffer: MAX_GIT_OUTPUT, encoding: "utf8"
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
  const branch = `codex/task-${input.runId}`;
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
