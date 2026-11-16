import { execFile } from "node:child_process";

import { validateProjectRoot } from "../../lib/safe-resolve.js";

export interface LocalGitState {
  branch: string | null;
  commit: string;
  dirty: boolean;
  /** True when the upstream tracking ref points at the same commit as HEAD. */
  pushed: boolean;
}

export type LocalGitReader = (projectPath: string) => Promise<LocalGitState>;

// Read-only inspection of the member's own clone. Repository-defined hooks,
// fsmonitor and external diff helpers are disabled so looking at a repository
// never runs code from it; global and system config are ignored.
const SAFETY_ARGS = [
  "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
  "-c", "core.fsmonitor=false",
  "-c", "diff.external="
];

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C"
  };
}

function git(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile("git", [...SAFETY_ARGS, ...args], { cwd, env: gitEnv(), timeout: 10_000, maxBuffer: 1024 * 1024, encoding: "utf8" },
      (error, stdout) => resolve(error ? undefined : stdout.trim()));
  });
}

/** Reads branch, HEAD and push state. Throws LOCAL_REPOSITORY_UNAVAILABLE when the path is not a usable Git checkout. */
export const readLocalGitState: LocalGitReader = async (projectPath) => {
  const root = validateProjectRoot(projectPath);
  const commit = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const status = await git(root, ["status", "--porcelain", "--untracked-files=normal"]);
  if (!commit || status === undefined) throw new Error("LOCAL_REPOSITORY_UNAVAILABLE");
  const branch = await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const upstream = await git(root, ["rev-parse", "--verify", "--quiet", "@{upstream}^{commit}"]);
  return { branch: branch || null, commit, dirty: status.length > 0, pushed: upstream === commit };
};
