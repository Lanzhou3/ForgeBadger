import { execFile } from "node:child_process";

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
const FIELD_SEPARATOR = "\x1f";

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
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
