import { execFile } from "node:child_process";
import { lstat, unlink } from "node:fs/promises";

import { safeResolve, validateProjectRoot } from "../lib/safe-resolve.js";
import { readWorkspaceFile } from "./workspace-context.js";
import { ProjectGitChangesCache } from "./project-git-cache.js";

export interface GitWorkingTreeEntry {
  path: string;
  /** Two-letter porcelain status code, e.g. "M ", "??", "A ". */
  status: string;
  staged: boolean;
}

export interface GitCommitEntry {
  hash: string;
  subject: string;
  author: string;
  relativeDate: string;
}

export interface ProjectGitChanges {
  isGitRepo: boolean;
  branch?: string;
  changed: GitWorkingTreeEntry[];
  commits: GitCommitEntry[];
}

const MAX_COMMITS = 15;
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const FIELD_SEPARATOR = "\x1f";

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        // Large working trees (e.g. untracked node_modules/.pnpm-store content)
        // can produce git status output far beyond 1 MiB. execFile rejects with
        // ENOBUFS when stdout exceeds maxBuffer. Keep the buffer generous;
        // failed status reads are surfaced instead of reporting a clean tree.
        maxBuffer: GIT_MAX_BUFFER_BYTES,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(typeof stderr === "string" && stderr.trim() ? stderr.trim() : error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function parsePorcelain(output: string): GitWorkingTreeEntry[] {
  const entries: GitWorkingTreeEntry[] = [];
  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 4) continue;
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (!path) continue;
    // Rename/copy entries carry a second NUL-separated path (the source); skip it.
    if (xy.includes("R") || xy.includes("C")) {
      index += 1;
    }
    entries.push({
      path,
      status: xy,
      staged: xy[0] !== " " && xy[0] !== "?",
    });
  }
  return entries;
}

function parseLog(output: string): GitCommitEntry[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash = "", subject = "", author = "", relativeDate = ""] = line.split(FIELD_SEPARATOR);
      return { hash, subject, author, relativeDate };
    });
}

// Short-TTL cache + in-flight coalescing: the projects list fires one
// git-changes request per project and panels poll the same project, each
// costing 4 spawned git processes. Identical concurrent calls share one
// computation and repeat calls within the TTL reuse it, which collapses the
// process storm. Results may be up to five seconds old; retained payloads
// expire actively and are bounded by both entry count and serialized bytes.
const gitChangesCache = new ProjectGitChangesCache();
const gitChangesInFlight = new Map<string, Promise<ProjectGitChanges>>();

export function getProjectGitChangesCached(projectPath: string): Promise<ProjectGitChanges> {
  const cached = gitChangesCache.get(projectPath);
  if (cached) return Promise.resolve(cached);
  const inFlight = gitChangesInFlight.get(projectPath);
  if (inFlight) return inFlight;
  const pending = getProjectGitChanges(projectPath)
    .then((value) => {
      gitChangesCache.set(projectPath, value);
      return value;
    })
    .finally(() => {
      gitChangesInFlight.delete(projectPath);
    });
  gitChangesInFlight.set(projectPath, pending);
  return pending;
}

export async function getProjectGitChanges(projectPath: string): Promise<ProjectGitChanges> {
  try {
    await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { isGitRepo: false, changed: [], commits: [] };
  }

  const [branch, statusOutput, logOutput] = await Promise.all([
    runGit(projectPath, ["branch", "--show-current"]).catch(() => ""),
    runGit(projectPath, ["status", "--porcelain=v1", "-z", "-uall"]),
    runGit(projectPath, [
      "log",
      `-${MAX_COMMITS}`,
      `--pretty=format:%h${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%cr`,
    ]).catch(() => ""),
  ]);

  const trimmedBranch = branch.trim();
  return {
    isGitRepo: true,
    ...(trimmedBranch ? { branch: trimmedBranch } : {}),
    changed: parsePorcelain(statusOutput),
    commits: parseLog(logOutput),
  };
}

export interface ProjectGitFileDiff {
  path: string;
  kind: "diff" | "untracked";
  /** Unified diff text for tracked files. */
  diff?: string;
  /** File preview for untracked files (git has no diff for them). */
  content?: string;
  truncated: boolean;
}

const MAX_DIFF_CHARS = 200_000;

function assertGitRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim();
  if (!trimmed || trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new Error("Invalid file path");
  }
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === ".." || segment === "" || segment === ".")) {
    throw new Error("Invalid file path");
  }
  return trimmed;
}

function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= MAX_DIFF_CHARS) return { diff, truncated: false };
  return { diff: diff.slice(0, MAX_DIFF_CHARS), truncated: true };
}

export async function getProjectGitFileDiff(
  projectPath: string,
  relativePath: string,
  options: { untracked: boolean }
): Promise<ProjectGitFileDiff> {
  const safePath = assertGitRelativePath(relativePath);

  if (options.untracked) {
    // git diff does not cover untracked files; show the file preview instead,
    // reusing the workspace safe-path boundary (traversal/symlink/binary).
    const file = await readWorkspaceFile(projectPath, safePath);
    return {
      path: safePath,
      kind: "untracked",
      content: file.content,
      truncated: file.truncated,
    };
  }

  let diff: string;
  try {
    // Diff against HEAD covers both staged and unstaged changes.
    diff = await runGit(projectPath, ["diff", "HEAD", "--", safePath]);
  } catch {
    // Repositories without any commit have no HEAD to diff against.
    const [unstaged, staged] = await Promise.all([
      runGit(projectPath, ["diff", "--", safePath]).catch(() => ""),
      runGit(projectPath, ["diff", "--cached", "--", safePath]).catch(() => ""),
    ]);
    diff = [staged, unstaged].filter(Boolean).join("\n");
  }

  const truncated = truncateDiff(diff);
  return { path: safePath, kind: "diff", diff: truncated.diff, truncated: truncated.truncated };
}

export interface GitBranchEntry {
  name: string;
  isCurrent: boolean;
}

export interface ProjectGitWorkingTree {
  clean: boolean;
  changedCount: number;
  /** First few changed paths, for block-message display. */
  sample: string[];
}

export interface ProjectGitBranches {
  isGitRepo: boolean;
  /** Null on detached HEAD. */
  current: string | null;
  branches: GitBranchEntry[];
  workingTree: ProjectGitWorkingTree;
}

export type ProjectGitErrorCode =
  | "GIT_NOT_REPO"
  | "GIT_BRANCH_NOT_FOUND"
  | "GIT_BRANCH_EXISTS"
  | "GIT_WORKING_TREE_DIRTY"
  | "GIT_INVALID_BRANCH_NAME"
  | "GIT_SWITCH_FAILED"
  | "GIT_NOTHING_STAGED"
  | "GIT_COMMIT_FAILED";

export class ProjectGitError extends Error {
  constructor(
    readonly code: ProjectGitErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ProjectGitError";
  }
}

const WORKING_TREE_SAMPLE_SIZE = 5;

function summarizeWorkingTree(statusOutput: string): ProjectGitWorkingTree {
  const entries = parsePorcelain(statusOutput);
  return {
    clean: entries.length === 0,
    changedCount: entries.length,
    sample: entries.slice(0, WORKING_TREE_SAMPLE_SIZE).map((entry) => entry.path)
  };
}

export async function getProjectGitBranches(projectPath: string): Promise<ProjectGitBranches> {
  try {
    await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return {
      isGitRepo: false,
      current: null,
      branches: [],
      workingTree: { clean: true, changedCount: 0, sample: [] }
    };
  }

  const [current, listOutput, statusOutput] = await Promise.all([
    runGit(projectPath, ["branch", "--show-current"]).catch(() => ""),
    runGit(projectPath, ["branch", "--list", "--format=%(refname:short)"]).catch(() => ""),
    runGit(projectPath, ["status", "--porcelain=v1", "-z", "-uall"]).catch(() => "")
  ]);

  const trimmedCurrent = current.trim() || null;
  return {
    isGitRepo: true,
    current: trimmedCurrent,
    branches: listOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name, isCurrent: name === trimmedCurrent })),
    workingTree: summarizeWorkingTree(statusOutput)
  };
}

async function assertGitBranchName(projectPath: string, branchName: string): Promise<string> {
  const trimmed = branchName.trim();
  // Reject leading dashes outright so a name can never be parsed as a git
  // option, then let git's own ref-format rules decide the rest.
  if (!trimmed || trimmed !== branchName || trimmed.length > 200 || trimmed.startsWith("-")) {
    throw new ProjectGitError("GIT_INVALID_BRANCH_NAME", "Invalid branch name");
  }
  try {
    await runGit(projectPath, ["check-ref-format", "--branch", trimmed]);
  } catch {
    throw new ProjectGitError("GIT_INVALID_BRANCH_NAME", "Invalid branch name");
  }
  return trimmed;
}

/**
 * Switch the project's working tree to another branch, optionally creating it
 * from HEAD first. Switching is refused while the working tree has any
 * uncommitted change (tracked or untracked) so an operator never loses work
 * to an accidental checkout.
 */
export async function checkoutProjectGitBranch(
  projectPath: string,
  branchName: string,
  options: { create: boolean }
): Promise<{ current: string; created: boolean }> {
  const root = validateProjectRoot(projectPath);

  try {
    await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new ProjectGitError("GIT_NOT_REPO", "Project is not a git repository");
  }

  const name = await assertGitBranchName(root, branchName);
  const existing = new Set(
    (await runGit(root, ["branch", "--list", "--format=%(refname:short)"]).catch(() => ""))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
  if (options.create && existing.has(name)) {
    throw new ProjectGitError("GIT_BRANCH_EXISTS", `Branch already exists: ${name}`);
  }
  if (!options.create && !existing.has(name)) {
    throw new ProjectGitError("GIT_BRANCH_NOT_FOUND", `Branch not found: ${name}`);
  }

  const workingTree = summarizeWorkingTree(
    await runGit(root, ["status", "--porcelain=v1", "-z", "-uall"]).catch(() => "")
  );
  if (!workingTree.clean) {
    throw new ProjectGitError(
      "GIT_WORKING_TREE_DIRTY",
      `Working tree has ${workingTree.changedCount} uncommitted change(s); commit or clean them before switching branches`,
      { changedCount: workingTree.changedCount, sample: workingTree.sample }
    );
  }

  try {
    await runGit(root, options.create ? ["switch", "-c", name] : ["switch", name]);
  } catch (error) {
    throw new ProjectGitError(
      "GIT_SWITCH_FAILED",
      error instanceof Error ? error.message : "git switch failed"
    );
  }
  gitChangesCache.delete(root);
  gitChangesCache.delete(projectPath);
  gitSummaryCache.delete(root);
  gitSummaryCache.delete(projectPath);
  return { current: name, created: options.create };
}

export interface DirectoryGitSummary {
  isGitRepo: boolean;
  branch: string | null;
  changedCount: number;
}

const GIT_SUMMARY_TTL_MS = 5_000;
const GIT_SUMMARY_MAX_ENTRIES = 128;
const gitSummaryCache = new Map<string, { value: DirectoryGitSummary; expiresAt: number }>();
const gitSummaryInFlight = new Map<string, Promise<DirectoryGitSummary>>();

function setGitSummaryCache(key: string, value: DirectoryGitSummary): void {
  if (gitSummaryCache.size >= GIT_SUMMARY_MAX_ENTRIES) {
    const oldestKey = gitSummaryCache.keys().next().value;
    if (oldestKey !== undefined) gitSummaryCache.delete(oldestKey);
  }
  gitSummaryCache.set(key, { value, expiresAt: Date.now() + GIT_SUMMARY_TTL_MS });
}

/** Lightweight status summary for directory scans and project-list badges. */
export async function inspectDirectoryGitSummary(directoryPath: string): Promise<DirectoryGitSummary> {
  const root = validateProjectRoot(directoryPath);
  try {
    await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { isGitRepo: false, branch: null, changedCount: 0 };
  }

  const [branch, statusOutput] = await Promise.all([
    runGit(root, ["branch", "--show-current"]).catch(() => ""),
    runGit(root, ["status", "--porcelain=v1", "-z", "-uall"]).catch(() => "")
  ]);

  const trimmedBranch = branch.trim();
  const changed = parsePorcelain(statusOutput);
  return {
    isGitRepo: true,
    branch: trimmedBranch || null,
    changedCount: changed.length
  };
}

/** Short-TTL cached + in-flight coalesced summary, reusing gitChangesCache when warm. */
export function inspectDirectoryGitSummaryCached(directoryPath: string): Promise<DirectoryGitSummary> {
  const root = validateProjectRoot(directoryPath);
  const warmChanges = gitChangesCache.get(root) ?? gitChangesCache.get(directoryPath);
  if (warmChanges) {
    return Promise.resolve({
      isGitRepo: warmChanges.isGitRepo,
      branch: warmChanges.branch ?? null,
      changedCount: warmChanges.changed.length
    });
  }
  const cached = gitSummaryCache.get(root);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value);
  }
  if (cached) gitSummaryCache.delete(root);

  const inFlight = gitSummaryInFlight.get(root);
  if (inFlight) return inFlight;

  const pending = inspectDirectoryGitSummary(root)
    .then((summary) => {
      setGitSummaryCache(root, summary);
      return summary;
    })
    .finally(() => {
      gitSummaryInFlight.delete(root);
    });
  gitSummaryInFlight.set(root, pending);
  return pending;
}

/** Initializes a new git repository when the project root is not already inside one. */
export async function initProjectGitRepo(projectPath: string): Promise<{ initialized: boolean; alreadyRepo: boolean }> {
  const root = validateProjectRoot(projectPath);
  try {
    await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    return { initialized: false, alreadyRepo: true };
  } catch {
    await runGit(root, ["init"]);
    gitChangesCache.delete(root);
    gitChangesCache.delete(projectPath);
    gitSummaryCache.delete(root);
    gitSummaryCache.delete(projectPath);
    return { initialized: true, alreadyRepo: false };
  }
}

function assertSafeGitMutationPath(root: string, relativePath: string): string {
  const safePath = assertGitRelativePath(relativePath);
  if (
    safePath.startsWith("-") ||
    safePath.split(/[\\/]+/u).some((segment) => segment.toLowerCase() === ".git")
  ) {
    throw new Error("Invalid file path");
  }
  safeResolve(root, safePath);
  return safePath;
}

async function assertGitRepoRoot(projectPath: string): Promise<string> {
  const root = validateProjectRoot(projectPath);
  try {
    await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new ProjectGitError("GIT_NOT_REPO", "Project is not a git repository");
  }
  return root;
}

async function hasGitHead(root: string): Promise<boolean> {
  try {
    await runGit(root, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function existsInGitHead(root: string, safePath: string): Promise<boolean> {
  try {
    await runGit(root, ["cat-file", "-e", `HEAD:${safePath}`]);
    return true;
  } catch {
    return false;
  }
}

async function refreshGitChangesCache(root: string, originalPath?: string): Promise<ProjectGitChanges> {
  gitChangesCache.delete(root);
  gitSummaryCache.delete(root);
  if (originalPath && originalPath !== root) {
    gitChangesCache.delete(originalPath);
    gitSummaryCache.delete(originalPath);
  }
  const fresh = await getProjectGitChanges(root);
  gitChangesCache.set(root, fresh);
  setGitSummaryCache(root, {
    isGitRepo: fresh.isGitRepo,
    branch: fresh.branch ?? null,
    changedCount: fresh.changed.length
  });
  return fresh;
}

/** Stages selected files or all working-tree changes inside the approved project root. */
export async function stageProjectGitFiles(
  projectPath: string,
  input: { paths?: string[] | undefined; all?: boolean | undefined }
): Promise<ProjectGitChanges> {
  const root = await assertGitRepoRoot(projectPath);
  if (input.all) {
    await runGit(root, ["add", "-A"]);
  } else {
    const safePaths = (input.paths ?? []).map((entry) => assertSafeGitMutationPath(root, entry));
    if (safePaths.length === 0) {
      throw new Error("At least one file path is required");
    }
    await runGit(root, ["add", "--", ...safePaths]);
  }
  return refreshGitChangesCache(root, projectPath);
}

/** Unstages selected files or all staged changes back to the working tree. */
export async function unstageProjectGitFiles(
  projectPath: string,
  input: { paths?: string[] | undefined; all?: boolean | undefined }
): Promise<ProjectGitChanges> {
  const root = await assertGitRepoRoot(projectPath);
  const headExists = await hasGitHead(root);
  if (input.all) {
    if (headExists) {
      await runGit(root, ["reset", "HEAD"]);
    } else {
      await runGit(root, ["rm", "--cached", "-r", "--force", "--ignore-unmatch", "."]);
    }
  } else {
    const safePaths = (input.paths ?? []).map((entry) => assertSafeGitMutationPath(root, entry));
    if (safePaths.length === 0) {
      throw new Error("At least one file path is required");
    }
    if (headExists) {
      await runGit(root, ["reset", "HEAD", "--", ...safePaths]);
    } else {
      await runGit(root, ["rm", "--cached", "-r", "--force", "--ignore-unmatch", "--", ...safePaths]);
    }
  }
  return refreshGitChangesCache(root, projectPath);
}

/** Commits currently staged changes with a non-empty operator commit message. */
export async function commitProjectGitChanges(
  projectPath: string,
  message: string
): Promise<{ hash: string | null; branch: string | null; git: ProjectGitChanges }> {
  const root = await assertGitRepoRoot(projectPath);
  const trimmed = message.trim();
  if (!trimmed) {
    throw new ProjectGitError("GIT_COMMIT_FAILED", "Commit message is required");
  }
  const statusOutput = await runGit(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  const entries = parsePorcelain(statusOutput);
  if (!entries.some((entry) => entry.staged)) {
    throw new ProjectGitError("GIT_NOTHING_STAGED", "No staged changes to commit");
  }

  try {
    await runGit(root, ["commit", "-m", trimmed]);
  } catch (error) {
    throw new ProjectGitError(
      "GIT_COMMIT_FAILED",
      error instanceof Error ? error.message : "git commit failed"
    );
  }
  const hash = (await runGit(root, ["rev-parse", "--short", "HEAD"]).catch(() => "")).trim() || null;
  const git = await refreshGitChangesCache(root, projectPath);
  return { hash, branch: git.branch ?? null, git };
}

/** Discards working-tree changes (or deletes an untracked file) for a single safe project path. */
export async function discardProjectGitFile(
  projectPath: string,
  relativePath: string,
  options: { untracked?: boolean | undefined } = {}
): Promise<ProjectGitChanges> {
  const root = await assertGitRepoRoot(projectPath);
  const safePath = assertSafeGitMutationPath(root, relativePath);
  const absolutePath = safeResolve(root, safePath);
  const statusOutput = await runGit(root, ["status", "--porcelain=v1", "-z", "-uall", "--", safePath]).catch(() => "");
  const entry = parsePorcelain(statusOutput).find((candidate) => candidate.path === safePath);
  if (!entry) {
    throw new Error("File has no uncommitted changes to discard");
  }

  // Truth comes from git status, never trusting a stale untracked hint to unlink a tracked file.
  if (entry.status === "??") {
    const fileStats = await lstat(absolutePath);
    if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
      throw new Error("Only untracked regular files can be discarded");
    }
    await unlink(absolutePath);
    return refreshGitChangesCache(root, projectPath);
  }
  if (options.untracked === true) {
    throw new Error("File is tracked by git; refresh status before discarding");
  }

  const headExists = await hasGitHead(root);
  const inHead = headExists ? await existsInGitHead(root, safePath) : false;

  if (entry.staged) {
    if (headExists) {
      await runGit(root, ["reset", "HEAD", "--", safePath]);
    } else {
      await runGit(root, ["rm", "--cached", "--force", "--", safePath]);
    }
  }

  if (inHead) {
    await runGit(root, ["checkout", "--", safePath]);
  } else if (entry.status[0] === "A" && entry.status[1] !== "D") {
    try {
      const fileStats = await lstat(absolutePath);
      if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
        throw new Error("Only newly staged regular files can be discarded");
      }
      await unlink(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return refreshGitChangesCache(root, projectPath);
}
