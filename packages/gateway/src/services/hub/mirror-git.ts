import { execFile } from "node:child_process";

import { validateProjectRoot } from "../../lib/safe-resolve.js";

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
// Same branch grammar as routes/hub.ts: never starts with `-`, no `..`.
const BRANCH = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const REMOTE_REF_PREFIX = "refs/remotes/origin/";
const MAX_FILES = 2000;
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

interface GitResult {
  code: number;
  stdout: string;
}

export function assertSha(value: string): string {
  if (!SHA.test(value)) throw new Error("MIRROR_INVALID_REF");
  return value;
}

export function assertBranch(value: string): string {
  if (!BRANCH.test(value)) throw new Error("MIRROR_INVALID_REF");
  return value;
}

export function remoteRef(branch: string): string {
  return `${REMOTE_REF_PREFIX}${assertBranch(branch)}`;
}

/** A ref is either a full commit id or a remote-tracking ref of origin. */
function assertRef(value: string): string {
  if (SHA.test(value)) return value;
  if (value.startsWith(REMOTE_REF_PREFIX)) {
    assertBranch(value.slice(REMOTE_REF_PREFIX.length));
    return value;
  }
  throw new Error("MIRROR_INVALID_REF");
}

const SAFETY_ARGS = ["-c", `core.hooksPath=${NULL_DEVICE}`, "-c", "core.fsmonitor=false", "-c", "diff.external="];

/** Read-only analysis: global and system configuration are ignored. */
function isolatedEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C"
  };
}

/** Fetch needs the host's own credentials, so the user's identity variables and global config stay visible. */
function fetchEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "USERPROFILE", "SystemRoot", "SSH_AUTH_SOCK", "XDG_CONFIG_HOME", "APPDATA"];
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  for (const name of keep) if (process.env[name]) env[name] = process.env[name];
  return env;
}

function run(cwd: string, args: string[], env: NodeJS.ProcessEnv, timeout: number, extra: string[] = []): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile("git", [...SAFETY_ARGS, ...extra, ...args], { cwd, env, timeout, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (!error) return resolve({ code: 0, stdout });
        const code = (error as NodeJS.ErrnoException).code;
        // A numeric code is git's own exit status; anything else is a spawn/timeout failure.
        if (typeof code === "number") return resolve({ code, stdout: stdout ?? "" });
        reject(new Error("MIRROR_GIT_FAILED"));
      });
  });
}

const read = (cwd: string, args: string[]) => run(cwd, args, isolatedEnv(), 30_000);

function normalizeRemote(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(/\.git$/u, "").replace(/\/+$/u, "");
}

/** Fetches every branch of the configured remote into refs/remotes/origin/*. */
export async function fetchMirror(mirrorPath: string, expectedRemoteUrl: string): Promise<void> {
  const root = validateProjectRoot(mirrorPath);
  const origin = await read(root, ["remote", "get-url", "origin"]);
  if (origin.code !== 0 || normalizeRemote(origin.stdout) !== normalizeRemote(expectedRemoteUrl)) {
    throw new Error("MIRROR_REMOTE_MISMATCH");
  }
  const fetched = await run(root,
    ["fetch", "--prune", "--no-tags", "--no-recurse-submodules", "origin", "+refs/heads/*:refs/remotes/origin/*"],
    fetchEnv(), 60_000, ["-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=user", "-c", "fetch.recurseSubmodules=false"]
  ).catch(() => ({ code: 1, stdout: "" }));
  if (fetched.code !== 0) throw new Error("MIRROR_FETCH_FAILED");
}

export async function hasCommit(mirrorPath: string, sha: string): Promise<boolean> {
  const result = await read(validateProjectRoot(mirrorPath), ["rev-parse", "--verify", "--quiet", `${assertSha(sha)}^{commit}`]);
  return result.code === 0;
}

function splitNul(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

/** Files the commit changed relative to its merge base with `baseRef` (capped). */
export async function changedFiles(mirrorPath: string, baseRef: string, sha: string): Promise<string[]> {
  const root = validateProjectRoot(mirrorPath);
  const base = assertRef(baseRef);
  const head = assertSha(sha);
  const mergeBase = await read(root, ["merge-base", base, head]);
  const baseId = mergeBase.stdout.trim();
  if (mergeBase.code !== 0 || !SHA.test(baseId)) throw new Error("MIRROR_NO_MERGE_BASE");
  const diff = await read(root, ["diff", "--name-only", "--no-renames", "--no-ext-diff", "-z", baseId, head, "--"]);
  if (diff.code !== 0) throw new Error("MIRROR_GIT_FAILED");
  return splitNul(diff.stdout).slice(0, MAX_FILES);
}

/** Conflicted file names of merging `theirsSha` into `oursRef`; empty when the merge is clean. */
export async function mergeConflicts(mirrorPath: string, oursRef: string, theirsSha: string): Promise<string[]> {
  const root = validateProjectRoot(mirrorPath);
  const result = await read(root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", assertRef(oursRef), assertSha(theirsSha)]);
  if (result.code === 0) return [];
  if (result.code !== 1) throw new Error("MIRROR_GIT_FAILED");
  // The first record is the resulting tree id; the rest are conflicted paths.
  return [...new Set(splitNul(result.stdout).slice(1))].slice(0, MAX_FILES);
}

/** True when `refs/remotes/origin/<branch>` resolves to a commit in the mirror. */
export async function remoteBranchExists(mirrorPath: string, branch: string): Promise<boolean> {
  const result = await read(validateProjectRoot(mirrorPath), ["rev-parse", "--verify", "--quiet", `${remoteRef(branch)}^{commit}`]);
  return result.code === 0;
}

/**
 * Reads the first existing candidate file from a remote-tracking ref. Only
 * regular blobs (100644/100755) are read; a symlink, tree or submodule entry
 * stops the search and yields null, as does an oversized blob.
 */
export async function readFileAtRef(mirrorPath: string, ref: string, candidates: readonly string[], maxBytes: number): Promise<string | null> {
  const root = validateProjectRoot(mirrorPath);
  const safeRef = assertRef(ref);
  for (const candidate of candidates) {
    const listed = await read(root, ["ls-tree", "-z", safeRef, "--", candidate]);
    const match = /^(\d{6}) (\w+) ([a-f0-9]+)\t/u.exec(splitNul(listed.stdout)[0] ?? "");
    if (listed.code !== 0 || !match) continue;
    if (!["100644", "100755"].includes(match[1]!) || match[2] !== "blob") return null;
    const oid = assertSha(match[3]!);
    const size = await read(root, ["cat-file", "-s", oid]);
    if (size.code !== 0 || Number(size.stdout.trim()) > maxBytes) return null;
    const blob = await read(root, ["cat-file", "blob", oid]);
    return blob.code === 0 ? blob.stdout : null;
  }
  return null;
}
