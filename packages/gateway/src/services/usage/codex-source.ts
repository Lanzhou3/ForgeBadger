/**
 * Codex usage source.
 *
 * Reads `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl` transcripts
 * (CODEX_HOME-aware). Relevant line shapes:
 *
 * - `{"type":"session_meta","payload":{"id","cwd",...}}` — session id + project cwd
 * - `{"type":"turn_context","payload":{"model",...}}` — model for following turns
 * - `{"type":"event_msg","payload":{"type":"token_count","info":{
 *     "last_token_usage":{input_tokens,cached_input_tokens,output_tokens,
 *                          reasoning_output_tokens,total_tokens}}}}`
 *
 * Each `token_count` event's `last_token_usage` is the delta of one API call,
 * so every event becomes one record. Dedupe key: `basename@byteOffset` —
 * rollout files are append-only, so a line's byte offset is stable and the
 * repository's `(user, adapter, requestId)` unique constraint makes re-parses
 * idempotent.
 *
 * Watermark: JSON map `{ [fileKey]: { bytes, mtimeMs } }`. Files whose size
 * and mtime are unchanged are skipped; any change triggers a full re-parse
 * (cheap for rollout sizes, and dedupe-safe via the unique constraint).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  codexSessionsRoot,
  type TokenUsageRecord,
  type UsageScanResult,
  type UsageSource
} from "./usage-source.js";

interface WatermarkEntry {
  bytes: number;
  mtimeMs: number;
}

interface RolloutContext {
  sessionId: string | null;
  projectPath: string;
  modelId: string | null;
}

export class CodexSource implements UsageSource {
  readonly adapter = "codex" as const;

  scan(lastWatermark: string | null): UsageScanResult {
    const previous = parseWatermark(lastWatermark);
    const root = codexSessionsRoot();
    const next: Record<string, WatermarkEntry> = {};
    const records: TokenUsageRecord[] = [];

    const files = listRolloutFiles(root);
    for (const absolutePath of files) {
      const key = cursorKeyForPath(absolutePath);
      const stat = safeStat(absolutePath);
      if (!stat) continue;
      const prior = previous[key];
      next[key] = { bytes: stat.size, mtimeMs: stat.mtimeMs };
      if (prior && prior.mtimeMs === stat.mtimeMs && prior.bytes === stat.size) {
        continue; // unchanged
      }
      records.push(...parseRolloutFile(absolutePath));
    }

    return { records, nextWatermark: JSON.stringify(next) };
  }
}

/** Recursively collect rollout-*.jsonl under the sessions root. */
function listRolloutFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return; // sessions/<y>/<m>/<d>/file.jsonl
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
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
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

function parseRolloutFile(absolutePath: string): TokenUsageRecord[] {
  let content: string;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    return [];
  }
  const context: RolloutContext = {
    sessionId: null,
    projectPath: "",
    modelId: null
  };
  const records: TokenUsageRecord[] = [];
  let offset = 0;
  for (const line of content.split("\n")) {
    const lineStart = offset;
    offset += Buffer.byteLength(line, "utf8") + 1;
    collectLine(line, lineStart, absolutePath, context, records);
  }
  return records;
}

function collectLine(
  line: string,
  lineStart: number,
  absolutePath: string,
  context: RolloutContext,
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

  if (entry.type === "session_meta" && isRecord(entry.payload)) {
    if (typeof entry.payload.id === "string") context.sessionId = entry.payload.id;
    if (typeof entry.payload.cwd === "string") context.projectPath = entry.payload.cwd;
    return;
  }
  if (entry.type === "turn_context" && isRecord(entry.payload)) {
    if (typeof entry.payload.model === "string") context.modelId = entry.payload.model;
    return;
  }
  if (entry.type !== "event_msg" || !isRecord(entry.payload)) return;
  if (entry.payload.type !== "token_count" || !isRecord(entry.payload.info)) return;
  const last = entry.payload.info.last_token_usage;
  if (!isRecord(last)) return;

  const inputTokens = numeric(last.input_tokens);
  const outputTokens = numeric(last.output_tokens);
  const cacheReadTokens = numeric(last.cached_input_tokens);
  const reasoningTokens = numeric(last.reasoning_output_tokens);
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0) return;

  records.push({
    adapter: "codex",
    sessionId: context.sessionId,
    projectPath: context.projectPath || "unknown",
    modelId: context.modelId,
    requestId: `${path.basename(absolutePath)}@${lineStart}`,
    occurredAt: parseTimestamp(entry.timestamp) ?? new Date(0),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    reasoningTokens,
    sourceFile: absolutePath
  });
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
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

function parseWatermark(watermark: string | null): Record<string, WatermarkEntry> {
  if (!watermark) return {};
  try {
    const parsed = JSON.parse(watermark) as unknown;
    if (!isRecord(parsed)) return {};
    const result: Record<string, WatermarkEntry> = {};
    for (const [key, value] of Object.entries(parsed)) {
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
