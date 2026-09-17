/**
 * Usage token source abstraction.
 *
 * Each CLI adapter implements a `UsageSource` that scans that CLI's local
 * data (JSONL logs or read-only SQLite) and returns normalized per-request
 * token records. Sync cursors (watermarks) let a source resume from where it
 * stopped. Sources are stateless — the cursor for a given `(userId, adapter)`
 * is persisted by the caller and passed back on the next scan.
 */

import { homedir } from "node:os";
import path from "node:path";

import { expandUserPath } from "../../lib/user-path.js";

export type UsageTokenAdapter = "claude" | "opencode" | "codex" | "kimi";

export interface TokenUsageRecord {
  /** Which CLI the record came from. */
  adapter: UsageTokenAdapter;
  /** CLI-side persistent session id (e.g. Claude session UUID / OpenCode session id). */
  sessionId: string | null;
  /** Working directory of the request, used for project attribution. */
  projectPath: string;
  /** Model id as reported by the CLI (e.g. `anthropic/claude-sonnet-4-5`). */
  modelId: string | null;
  /** Dedupe key within `(user, adapter)` — CLAUDE message.id, OpenCode message.id. */
  requestId: string;
  /** When the request completed (or was last touched). */
  occurredAt: Date;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** Absolute path of the underlying source file/db (for traceability + dedupe). */
  sourceFile: string;
}

export interface UsageScanResult {
  records: TokenUsageRecord[];
  /** Opaque resume position; pass it back as `lastWatermark` on next scan. */
  nextWatermark: string;
}

export interface UsageSource {
  readonly adapter: UsageTokenAdapter;
  /** Scan for records newer than `lastWatermark`; null = full scan. */
  scan(lastWatermark: string | null): UsageScanResult;
}

interface UsagePathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

function usagePathContext(options: UsagePathOptions): {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  pathApi: typeof path.posix | typeof path.win32;
} {
  const platform = options.platform ?? process.platform;
  return {
    env: options.env ?? process.env,
    homeDir: options.homeDir ?? homedir(),
    pathApi: platform === "win32" ? path.win32 : path.posix
  };
}

/** Root of Claude Code JSONL transcripts (CLAUDE_CONFIG_DIR-aware). */
export function claudeProjectsRoot(options: UsagePathOptions = {}): string {
  const { env, homeDir, pathApi } = usagePathContext(options);
  const configDir = expandUserPath(
    env.CLAUDE_CONFIG_DIR?.trim() || pathApi.join(homeDir, ".claude"),
    homeDir,
    pathApi
  );
  return pathApi.join(configDir, "projects");
}

/** Absolute path of the OpenCode SQLite database (OPENCODE_DB override aware). */
export function opencodeDbPath(options: UsagePathOptions = {}): string {
  const { env, homeDir, pathApi } = usagePathContext(options);
  const override = env.OPENCODE_DB?.trim();
  if (override) return pathApi.join(expandUserPath(override, homeDir, pathApi), "opencode.db");
  const base = expandUserPath(
    env.XDG_DATA_HOME?.trim() || pathApi.join(homeDir, ".local", "share"),
    homeDir,
    pathApi
  );
  return pathApi.join(base, "opencode", "opencode.db");
}

/** Root of Codex rollout transcripts (CODEX_HOME-aware). */
export function codexSessionsRoot(options: UsagePathOptions = {}): string {
  const { env, homeDir, pathApi } = usagePathContext(options);
  const codexHome = expandUserPath(
    env.CODEX_HOME?.trim() || pathApi.join(homeDir, ".codex"),
    homeDir,
    pathApi
  );
  return pathApi.join(codexHome, "sessions");
}

/** Root of Kimi Code session transcripts (KIMI_CODE_HOME-aware). */
export function kimiSessionsRoot(options: UsagePathOptions = {}): string {
  const { env, homeDir, pathApi } = usagePathContext(options);
  const kimiHome = expandUserPath(
    env.KIMI_CODE_HOME?.trim() || pathApi.join(homeDir, ".kimi-code"),
    homeDir,
    pathApi
  );
  return pathApi.join(kimiHome, "sessions");
}

/** Decode a Claude encode-project-dir into an absolute path (`-Users-a-B` -> `/Users/a/B`). */
export function decodeClaudeProjectDir(
  dirName: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "win32" && /^[A-Za-z]--/u.test(dirName)) {
    return `${dirName[0]}:\\${dirName.slice(3).replace(/-/g, "\\")}`;
  }
  if (!dirName.startsWith("-")) return dirName;
  return `/${dirName.slice(1).replace(/-/g, "/")}`;
}
