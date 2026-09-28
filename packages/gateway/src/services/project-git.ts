import { execFile } from "node:child_process";

import { validateProjectRoot } from "../lib/safe-resolve.js";
import { readWorkspaceFile } from "./workspace-context.js";

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

const MAX_CHANGED_ENTRIES = 200;
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
        // ENOBUFS when stdout exceeds maxBuffer, which getProjectGitChanges
        // would silently swallow and report an empty change list. Keep the
        // buffer generous so the working tree is actually reported.
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
    if (entries.length >= MAX_CHANGED_ENTRIES) break;
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

export async function getProjectGitChanges(projectPath: string): Promise<ProjectGitChanges> {
  try {
    await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { isGitRepo: false, changed: [], commits: [] };
  }

  const [branch, statusOutput, logOutput] = await Promise.all([
    runGit(projectPath, ["branch", "--show-current"]).catch(() => ""),
    runGit(projectPath, ["status", "--porcelain=v1", "-z", "-uall"]).catch(() => ""),
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
  | "GIT_SWITCH_FAILED";

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
  return { current: name, created: options.create };
}
