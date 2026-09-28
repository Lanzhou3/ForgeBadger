/**
 * Kimi Code usage source.
 *
 * Reads `<KIMI_CODE_HOME|~/.kimi-code>/sessions/wd_X/session_Y/agents/Z/
 * wire.jsonl` transcripts. Relevant line shape:
 *
 * - `{"type":"usage.record","agentId":"main","model":"kimi-code/k3",
 *    "usage":{"inputOther","output","inputCacheRead","inputCacheCreation"},
 *    "usageScope":"turn","time":<epochMs>}`
 *
 * `usageScope:"turn"` records are per-request deltas — one record per line.
 * `usageScope:"session"` records are cumulative snapshots (including subagent
 * rollups written into the parent wire file) and are skipped to avoid double
 * counting; subagent turn usage is collected from that agent's own wire file.
 *
 * Session id and project cwd come from the session directory's `state.json`
 * (`{"id","cwd",...}`; older sessions store the working directory as
 * `workDir`); the wire file itself carries neither. Kimi writes the directory
 * with forward slashes even on Windows, so it is canonicalized with
 * `realpathSync` into the exact form the ownership roots use (native
 * separators, on-disk casing) — otherwise the syncer's exact-match root
 * filter drops every Kimi record from the stats.
 *
 * Watermark: `{ "v": 2, "files": { [fileKey]: { bytes, mtimeMs } } }`. Files
 * whose size and mtime are unchanged are skipped; any change triggers a full
 * re-parse. Legacy v1 watermarks (the flat file map written before path
 * canonicalization) are rejected, so the first scan after an upgrade re-runs
 * in full and the idempotent upsert repairs the misattributed rows.
 * Dedupe key: `<relative-path>@<byteOffset>` — wire files are append-only, so
 * a line's byte offset is stable and the repository's
 * `(user, adapter, requestId)` unique constraint makes re-parses idempotent.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import {
  kimiSessionsRoot,
  type TokenUsageRecord,
  type UsageScanResult,
  type UsageSource
} from "./usage-source.js";

interface WatermarkEntry {
  bytes: number;
  mtimeMs: number;
}

interface SessionMeta {
  sessionId: string;
  projectPath: string;
}

/** Bump when stored rows need a full idempotent rescan to repair them. */
const WATERMARK_VERSION = 2;

export class KimiSource implements UsageSource {
  readonly adapter = "kimi" as const;

  scan(lastWatermark: string | null): UsageScanResult {
    const previous = parseWatermark(lastWatermark);
    const root = kimiSessionsRoot();
    const next: Record<string, WatermarkEntry> = {};
    const records: TokenUsageRecord[] = [];

    const files = listWireFiles(root);
    const metaCache = new Map<string, SessionMeta>();
    for (const absolutePath of files) {
      const key = cursorKeyForPath(absolutePath);
      const stat = safeStat(absolutePath);
      if (!stat) continue;
      const prior = previous[key];
      next[key] = { bytes: stat.size, mtimeMs: stat.mtimeMs };
      if (prior && prior.mtimeMs === stat.mtimeMs && prior.bytes === stat.size) {
        continue; // unchanged
      }
      const meta = sessionMetaFor(absolutePath, metaCache);
      records.push(...parseWireFile(absolutePath, root, meta));
    }

    return { records, nextWatermark: JSON.stringify({ v: WATERMARK_VERSION, files: next }) };
  }
}

/** Collect `sessions/wd_X/session_Y/agents/Z/wire.jsonl` files under the root. */
function listWireFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return; // root=0, wd=1, session=2, agents=3, agent dir=4
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === "wire.jsonl") {
        files.push(full);
      }
    }
  };
  walk(root, 0);
  return files.sort();
}

function safeStat(file: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = statSync(file);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/** Read `<session>/state.json` for session id + cwd; cached per session dir. */
function sessionMetaFor(wirePath: string, cache: Map<string, SessionMeta>): SessionMeta {
  const sessionDir = path.dirname(path.dirname(path.dirname(wirePath)));
  const cached = cache.get(sessionDir);
  if (cached) return cached;

  const fallbackId = path.basename(sessionDir);
  const meta: SessionMeta = { sessionId: fallbackId, projectPath: "" };
  try {
    const raw = readFileSync(path.join(sessionDir, "state.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      if (typeof parsed.id === "string" && parsed.id) meta.sessionId = parsed.id;
      // Older sessions store the working directory as `workDir`.
      const rawDir = typeof parsed.cwd === "string" && parsed.cwd
        ? parsed.cwd
        : typeof parsed.workDir === "string" && parsed.workDir
          ? parsed.workDir
          : null;
      if (rawDir) meta.projectPath = canonicalizeProjectPath(rawDir);
    }
  } catch {
    // Missing/unreadable state.json: fall back to the directory name + unknown cwd.
  }
  cache.set(sessionDir, meta);
  return meta;
}

/**
 * Canonicalize the session working directory into the form the ownership
 * roots use: `realpathSync` output (native separators + real on-disk casing).
 * A directory that no longer exists (project renamed or deleted) falls back
 * to a separator-only normalize — best effort.
 */
function canonicalizeProjectPath(rawDir: string): string {
  try {
    return realpathSync(rawDir);
  } catch {
    return path.normalize(rawDir);
  }
}

function parseWireFile(
  absolutePath: string,
  root: string,
  meta: SessionMeta
): TokenUsageRecord[] {
  let content: string;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    return [];
  }
  const relativeKey = path.relative(root, absolutePath);
  const records: TokenUsageRecord[] = [];
  let offset = 0;
  for (const line of content.split("\n")) {
    const lineStart = offset;
    offset += Buffer.byteLength(line, "utf8") + 1;
    collectLine(line, lineStart, relativeKey, absolutePath, meta, records);
  }
  return records;
}

function collectLine(
  line: string,
  lineStart: number,
  relativeKey: string,
  absolutePath: string,
  meta: SessionMeta,
  records: TokenUsageRecord[]
): void {
  if (!line.trim()) return;
  let entry: unknown;
  try {
    entry = JSON.parse(line) as unknown;
  } catch {
    return; // torn trailing line while CLI is writing — next scan retries it
  }
  if (!isRecord(entry)) return;
  if (entry.type !== "usage.record" || entry.usageScope !== "turn") return;
  if (!isRecord(entry.usage)) return;

  const inputTokens = numeric(entry.usage.inputOther);
  const outputTokens = numeric(entry.usage.output);
  const cacheReadTokens = numeric(entry.usage.inputCacheRead);
  const cacheWriteTokens = numeric(entry.usage.inputCacheCreation);
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0) return;

  records.push({
    adapter: "kimi",
    sessionId: meta.sessionId,
    projectPath: meta.projectPath || "unknown",
    modelId: typeof entry.model === "string" ? entry.model : null,
    requestId: `${relativeKey}@${lineStart}`,
    occurredAt: parseEpochMs(entry.time) ?? new Date(0),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: 0,
    sourceFile: absolutePath
  });
}

function parseEpochMs(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value);
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cursorKeyForPath(absolutePath: string): string {
  return absolutePath.replace(/[/\\:]/g, "_");
}

/** Legacy v1 watermarks (flat file map) are rejected to force a repair rescan. */
function parseWatermark(watermark: string | null): Record<string, WatermarkEntry> {
  if (!watermark) return {};
  try {
    const parsed = JSON.parse(watermark) as unknown;
    if (!isRecord(parsed) || parsed.v !== WATERMARK_VERSION || !isRecord(parsed.files)) return {};
    const result: Record<string, WatermarkEntry> = {};
    for (const [key, value] of Object.entries(parsed.files)) {
      if (isRecord(value)) {
        const bytes = numeric(value.bytes);
        const mtimeMs = numeric(value.mtimeMs);
        if (Number.isFinite(bytes) && Number.isFinite(mtimeMs)) {
          result[key] = { bytes, mtimeMs };
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}
