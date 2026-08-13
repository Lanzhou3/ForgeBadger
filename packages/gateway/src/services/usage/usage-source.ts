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

export type UsageTokenAdapter = "claude" | "opencode" | "codex";

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

function pathJoinHome(...parts: string[]): string {
  return path.join(homedir(), ...parts);
}

/** Root of Claude Code JSONL transcripts (CLAUDE_CONFIG_DIR-aware). */
export function claudeProjectsRoot(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return configDir ? path.join(configDir, "projects") : pathJoinHome(".claude", "projects");
}

/** Absolute path of the OpenCode SQLite database (OPENCODE_DB override aware). */
export function opencodeDbPath(): string {
  const override = process.env.OPENCODE_DB?.trim();
  if (override) return path.join(override, "opencode.db");
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const base = xdg || pathJoinHome(".local", "share");
  return path.join(base, "opencode", "opencode.db");
}

/** Root of Codex rollout transcripts (CODEX_HOME-aware). */
export function codexSessionsRoot(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  return path.join(codexHome || pathJoinHome(".codex"), "sessions");
}

/** Decode a Claude encode-project-dir into an absolute path (`-Users-a-B` -> `/Users/a/B`). */
export function decodeClaudeProjectDir(dirName: string): string {
  if (!dirName.startsWith("-")) return dirName;
  return `/${dirName.slice(1).replace(/-/g, "/")}`;
}