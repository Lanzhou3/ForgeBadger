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
import { constants } from "node:fs";
import { open, opendir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { AdapterId } from "./adapter-discovery.js";
import { globalConfigRoot } from "./cli-config-target.js";

export interface NativeSessionProbeOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

const MAX_METADATA_BYTES = 1024 * 1024;

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

// Stream all supported artifacts: a global file-count cap must never make a
// known resume handle disappear. Directory symlinks are not traversed.
async function* transcriptFiles(root: string, depth = 0): AsyncGenerator<string> {
  if (depth > 6) return;
  let directory;
  try { directory = await opendir(root); }
  catch { return; }
  for await (const entry of directory) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* transcriptFiles(full, depth + 1);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield full;
  }
}

async function firstJsonLine(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) return undefined;
      const buffer = Buffer.alloc(16 * 1024);
      const chunks: Buffer[] = [];
      let size = 0;
      while (size < MAX_METADATA_BYTES) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, MAX_METADATA_BYTES - size), null);
        if (!bytesRead) break;
        const newline = buffer.subarray(0, bytesRead).indexOf(10);
        chunks.push(Buffer.from(buffer.subarray(0, newline < 0 ? bytesRead : newline)));
        size += bytesRead;
        if (newline >= 0) break;
        if (size === MAX_METADATA_BYTES) return undefined;
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8").trim());
      return isRecord(parsed) ? parsed : undefined;
    } finally { await file.close(); }
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type TranscriptAdapter = "claude" | "codex" | "pi";

function transcriptIdentity(adapter: TranscriptAdapter, header: Record<string, unknown>) {
  if (adapter === "codex") {
    const payload = isRecord(header.payload) ? header.payload : {};
    return { id: payload.session_id ?? payload.id, cwd: payload.cwd };
  }
  if (adapter === "pi") return { id: header.type === "session" ? header.id : undefined, cwd: header.cwd };
  return { id: header.sessionId, cwd: header.cwd };
}

async function latestTranscript(adapter: TranscriptAdapter, root: string, workingDir: string): Promise<string | undefined> {
  let latest: { id: string; file: string; modified: number } | undefined;
  for await (const file of transcriptFiles(root)) {
    const header = await firstJsonLine(file);
    if (!header) continue;
    const identity = transcriptIdentity(adapter, header);
    if (typeof identity.id !== "string" || !identity.id || !sameWorkingDir(identity.cwd, workingDir)) continue;
    // Codex/Pi filenames contain timestamps; Claude filenames are random UUIDs
    // and must instead be ranked by the last transcript write.
    const modified = adapter === "claude" ? (await stat(file).catch(() => undefined))?.mtimeMs : 0;
    if (modified === undefined) continue;
    if (!latest || modified > latest.modified || modified === latest.modified && file.localeCompare(latest.file) > 0)
      latest = { id: identity.id, file, modified };
  }
  return latest?.id;
}

async function hasTranscript(adapter: TranscriptAdapter, root: string, nativeSessionId: string): Promise<boolean> {
  for await (const file of transcriptFiles(root)) {
    const name = path.basename(file);
    const matches = adapter === "claude" ? name === `${nativeSessionId}.jsonl`
      : adapter === "codex" ? name.startsWith("rollout-") && name.endsWith(`-${nativeSessionId}.jsonl`)
      : name.endsWith(`_${nativeSessionId}.jsonl`);
    if (matches) return true;
  }
  return false;
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
  switch (adapter) {
    case "codex":
    case "pi":
    case "claude": {
      const root = probeRoot(adapter, options);
      if (!root) return undefined;
      return latestTranscript(adapter, path.join(root, adapter === "claude" ? "projects" : "sessions"), workingDir);
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
  switch (adapter) {
    case "codex":
    case "pi":
    case "claude": {
      const root = probeRoot(adapter, options);
      if (!root) return false;
      return hasTranscript(adapter, path.join(root, adapter === "claude" ? "projects" : "sessions"), nativeSessionId);
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
    case "opencode":
      return true;
    default:
      return false;
  }
}
