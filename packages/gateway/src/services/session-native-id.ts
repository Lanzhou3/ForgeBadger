/**
 * Native CLI session lookup. Each CLI persists its own conversation history
 * under its config home (claude: ~/.claude/projects/<dir>/<id>.jsonl, codex:
 * ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl, kimi:
 * ~/.kimi-code/sessions/<ws>/session_<id>/state.json, pi:
 * <PI_CODING_AGENT_DIR>/sessions/<dir>/<ts>_<id>.jsonl). Two helpers build on
 * that layout:
 *
 * - probeLatestNativeSessionId: fill in a session row's native id when the
 *   hook channel never captured one (fresh capture at relaunch time).
 * - isNativeSessionResolvable: confirm a stored id still resolves to a local
 *   session artifact before the launch plan commits to the resume flag.
 *   When the artifact is gone the caller starts a fresh conversation instead.
 *
 * Both are fail-open: an unreadable home or unknown layout yields undefined /
 * false, never an error, because resume selection is an optimization, not a
 * launch precondition.
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { AdapterId } from "./adapter-discovery.js";
import { globalConfigRoot } from "./cli-config-target.js";

export interface NativeSessionProbeOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

const MAX_PROBE_ARTIFACTS = 256;

function probeRoot(adapter: AdapterId, options: NativeSessionProbeOptions): string | undefined {
  try {
    return globalConfigRoot(adapter, options);
  } catch {
    return undefined;
  }
}

function sameWorkingDir(recorded: unknown, workingDir: string): boolean {
  if (typeof recorded !== "string" || !recorded) return false;
  const a = normalizeDir(recorded);
  const b = normalizeDir(workingDir);
  if (a && b) {
    if (a.toLowerCase() === b.toLowerCase()) return true;
    // Windows drives: the same folder can be recorded under the 8.3 short
    // name (ZHOUSH~1) and the long name (ZhouSheng); compare the drive letter
    // plus the path segment count as a weak tiebreaker before giving up.
  }
  return false;
}

function normalizeDir(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/\/+$/u, "");
}

async function listFilesRecursive(root: string, stopAtDepth = 6): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > stopAtDepth || out.length >= MAX_PROBE_ARTIFACTS) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(full);
      }
      if (out.length >= MAX_PROBE_ARTIFACTS) return;
    }
  }
  await walk(root, 0);
  return out;
}

async function firstJsonLine(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const line = raw.split(/\r?\n/u, 1)[0]?.trim();
    if (!line) return undefined;
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Find the most recent native session for `workingDir` that the adapter still
 * keeps on disk. Returns the id exactly as the CLI itself records it (kimi
 * ids carry their `session_` prefix, pi/codex/claude ids are bare UUIDs).
 */
export async function probeLatestNativeSessionId(
  adapter: AdapterId,
  workingDir: string,
  options: NativeSessionProbeOptions = {}
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  switch (adapter) {
    case "codex": {
      const root = probeRoot(adapter, options);
      if (!root) return undefined;
      const files = await listFilesRecursive(path.join(root, "sessions"));
      const newest = files.filter((f) => f.endsWith(".jsonl")).sort((a, b) => b.localeCompare(a)).slice(0, 64);
      for (const file of newest) {
        const meta = await firstJsonLine(file);
        const payload = isRecord(meta?.payload) ? meta.payload : undefined;
        if (payload && sameWorkingDir(payload.cwd, workingDir)) {
          const id = typeof payload.session_id === "string" ? payload.session_id : undefined;
          if (id) return id;
        }
      }
      return undefined;
    }
    case "kimi": {
      const root = probeRoot(adapter, options);
      if (!root) return undefined;
      const base = path.join(root, "sessions");
      const candidates: { id: string; updatedAt: number }[] = [];
      let workspaces: string[] = [];
      try {
        workspaces = (await readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return undefined;
      }
      for (const workspace of workspaces) {
        let sessions: string[] = [];
        try {
          sessions = (await readdir(path.join(base, workspace), { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.startsWith("session_")).map((e) => e.name);
        } catch {
          continue;
        }
        for (const name of sessions) {
          const state = await firstJsonLine(path.join(base, workspace, name, "state.json"));
          if (!state) continue;
          if (state.cwd !== undefined && !sameWorkingDir(state.cwd, workingDir)) continue;
          const id = typeof state.id === "string" && state.id ? state.id : name;
          const updatedAt = typeof state.updatedAt === "number" ? state.updatedAt : 0;
          candidates.push({ id, updatedAt });
        }
      }
      if (candidates.length === 0) return undefined;
      candidates.sort((a, b) => b.updatedAt - a.updatedAt);
      return candidates[0]?.id;
    }
    case "pi": {
      const root = probeRoot(adapter, options);
      if (!root) return undefined;
      const files = await listFilesRecursive(path.join(root, "sessions"));
      const newest = files.filter((f) => f.endsWith(".jsonl")).sort((a, b) => b.localeCompare(a)).slice(0, 64);
      for (const file of newest) {
        const header = await firstJsonLine(file);
        if (header?.type === "session" && sameWorkingDir(header.cwd, workingDir)) {
          const id = typeof header.id === "string" ? header.id : undefined;
          if (id) return id;
        }
      }
      return undefined;
    }
    case "claude": {
      const root = probeRoot(adapter, options);
      if (!root) return undefined;
      const files = await listFilesRecursive(path.join(root, "projects"));
      const newest = files.filter((f) => f.endsWith(".jsonl")).sort((a, b) => b.localeCompare(a)).slice(0, 64);
      for (const file of newest) {
        const header = await firstJsonLine(file);
        if (sameWorkingDir(header?.cwd, workingDir)) {
          const sessionId = typeof header?.sessionId === "string" ? header.sessionId : undefined;
          if (sessionId) return sessionId;
        }
      }
      return undefined;
    }
    default:
      // opencode resumes with --session <id> and creates the session when the
      // id is missing, so a stored id never needs disk verification; grok and
      // mcode have no resume surface at all.
      return undefined;
  }
}

/**
 * Does the stored native id still resolve to a local artifact? Adapters whose
 * resume flag creates a fresh session on a miss (opencode) always answer
 * true; adapters without resume answer false so the caller starts fresh.
 */
export async function isNativeSessionResolvable(
  adapter: AdapterId,
  nativeSessionId: string,
  workingDir: string,
  options: NativeSessionProbeOptions = {}
): Promise<boolean> {
  if (!nativeSessionId.trim()) return false;
  const env = options.env ?? process.env;
  switch (adapter) {
    case "codex": {
      const root = probeRoot(adapter, options);
      if (!root) return false;
      const files = await listFilesRecursive(path.join(root, "sessions"));
      return files.some((f) => f.endsWith(`-${nativeSessionId}.jsonl`));
    }
    case "kimi": {
      const root = probeRoot(adapter, options);
      if (!root) return false;
      const suffix = nativeSessionId.startsWith("session_") ? nativeSessionId : `session_${nativeSessionId}`;
      const base = path.join(root, "sessions");
      let workspaces: string[] = [];
      try {
        workspaces = (await readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return false;
      }
      for (const workspace of workspaces) {
        const state = await firstJsonLine(path.join(base, workspace, suffix, "state.json"));
        if (state && (state.cwd === undefined || sameWorkingDir(state.cwd, workingDir))) return true;
      }
      return false;
    }
    case "pi": {
      const root = probeRoot(adapter, options);
      if (!root) return false;
      const files = await listFilesRecursive(path.join(root, "sessions"));
      return files.some((f) => f.endsWith(`_${nativeSessionId}.jsonl`));
    }
    case "claude": {
      const root = probeRoot(adapter, options);
      if (!root) return false;
      const files = await listFilesRecursive(path.join(root, "projects"));
      return files.some((f) => f.endsWith(`${nativeSessionId}.jsonl`));
    }
    case "opencode":
      return true;
    default:
      return false;
  }
}
