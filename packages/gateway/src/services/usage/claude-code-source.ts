/**
 * Claude Code usage source.
 *
 * Reads `~/.claude/projects/<encoded-cwd>/<session>.jsonl` transcripts.
 * Assistant messages carry `message.usage` with input/output/cache token
 * counts. Known CLI quirk: the same `message.id` is repeated across multiple
 * content-block lines, and streamed `input_tokens` may be placeholder 0/1 on
 * early lines — so we dedupe by `message.id` and keep the line with the max
 * `output_tokens` (the final one), per provider risk research.
 *
 * Watermark: JSON map `{ [fileKey]: { bytes, mtimeMs } }`. Transcripts are
 * append-only, so a file whose size grew is re-read from the recorded byte
 * offset; a file whose mtime changed but size shrank (rewritten) is re-read
 * fully. A torn trailing line (CLI still writing) is excluded and the
 * watermark is rolled back to its start so the next scan retries it.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  claudeProjectsRoot,
  decodeClaudeProjectDir,
  type TokenUsageRecord,
  type UsageScanResult,
  type UsageSource
} from "./usage-source.js";

interface WatermarkEntry {
  bytes: number;
  mtimeMs: number;
}

interface TranscriptFile {
  absolutePath: string;
  projectPath: string;
  sessionId: string;
}

export class ClaudeCodeSource implements UsageSource {
  readonly adapter = "claude" as const;

  scan(lastWatermark: string | null): UsageScanResult {
    const previous = parseWatermark(lastWatermark);
    const root = claudeProjectsRoot();
    const next: Record<string, WatermarkEntry> = {};
    const records: TokenUsageRecord[] = [];

    let projectDirs: string[] = [];
    try {
      projectDirs = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return { records, nextWatermark: JSON.stringify(next) };
    }

    for (const projectDir of projectDirs) {
      const projectRoot = path.join(root, projectDir);
      const projectPath = decodeClaudeProjectDir(projectDir);
      for (const file of readFiles(projectRoot, projectPath)) {
        const key = cursorKeyForPath(file.absolutePath);
        const stat = safeStat(file.absolutePath);
        if (!stat) continue;
        const prior = previous[key];

        if (prior && prior.mtimeMs === stat.mtimeMs && stat.size <= prior.bytes) {
          // Unchanged since last scan.
          next[key] = { bytes: stat.size, mtimeMs: stat.mtimeMs };
          continue;
        }

        if (prior && stat.size > prior.bytes && prior.bytes > 0) {
          // Appended (transcripts are append-only): parse from the recorded offset.
          const chunk = readChunk(file.absolutePath, prior.bytes);
          const { records: newRecords, consumedBytes } = parseTranscriptChunk(chunk, file);
          records.push(...newRecords);
          next[key] = { bytes: prior.bytes + consumedBytes, mtimeMs: stat.mtimeMs };
          continue;
        }

        // First sight or rewritten/shrank: full parse.
        next[key] = { bytes: stat.size, mtimeMs: stat.mtimeMs };
        records.push(...parseTranscriptFile(file));
      }
    }

    return { records, nextWatermark: JSON.stringify(next) };
  }
}

function readFiles(projectRoot: string, projectPath: string): TranscriptFile[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(projectRoot);
  } catch {
    return [];
  }
  const files: TranscriptFile[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".jsonl")) continue;
    files.push({
      absolutePath: path.join(projectRoot, entry),
      projectPath,
      sessionId: entry.replace(/\.jsonl$/u, "")
    });
  }
  return files;
}

function safeStat(file: string): { size: number; mtimeMs: number } | null {
  try {
    const stat = statSync(file);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function readChunk(file: string, fromBytes: number): string {
  try {
    const full = readFileSync(file, "utf8");
    return full.slice(fromBytes);
  } catch {
    return "";
  }
}

interface ClaudeUsageLine {
  id: string;
  model: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  timestamp: string | null;
}

/**
 * Parse a transcript chunk. Last line is assumed torn unless it parses.
 * `consumedBytes` counts content minus the torn tail so the next scan
 * retries exactly that tail.
 */
function parseTranscriptChunk(
  content: string,
  file: TranscriptFile
): { records: TokenUsageRecord[]; consumedBytes: number } {
  const byMessageId = new Map<string, ClaudeUsageLine>();
  const lines = content.split("\n");

  let fullConsumed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const isLast = i === lines.length - 1;
    if (isLast && !line.trim()) {
      // trailing newline — consumed
      fullConsumed += Buffer.byteLength(line, "utf8");
      break;
    }
    const ok = tryCollectLine(line, byMessageId);
    fullConsumed += Buffer.byteLength(line, "utf8");
    if (!ok) {
      // Torn line: roll back to its start so the next scan retries it.
      fullConsumed -= Buffer.byteLength(line, "utf8");
      break;
    }
    fullConsumed += 1; // the newline
  }

  const records: TokenUsageRecord[] = [];
  for (const line of byMessageId.values()) {
    if (line.usage.input_tokens <= 0 && line.usage.output_tokens <= 0) continue;
    records.push(toRecord(line, file));
  }
  return { records, consumedBytes: fullConsumed };
}

function parseTranscriptFile(file: TranscriptFile): TokenUsageRecord[] {
  let content: string;
  try {
    content = readFileSync(file.absolutePath, "utf8");
  } catch {
    return [];
  }
  return parseTranscriptChunk(content, file).records;
}

function tryCollectLine(line: string, byMessageId: Map<string, ClaudeUsageLine>): boolean {
  if (!line.trim()) return true;
  let entry: unknown;
  try {
    entry = JSON.parse(line) as unknown;
  } catch {
    return false; // torn line
  }
  if (!isRecord(entry)) return false;
  if (entry.type !== "assistant") return true;
  const message = entry.message;
  if (!isRecord(message)) return true;
  if (!isRecord(message.usage) || typeof message.id !== "string") return true;
  const usage = message.usage;
  const outputTokens = numeric(usage.output_tokens);
  const existing = byMessageId.get(message.id);
  if (!existing || outputTokens > existing.usage.output_tokens) {
    byMessageId.set(message.id, {
      id: message.id,
      model: typeof message.model === "string" ? message.model : null,
      usage: {
        input_tokens: numeric(usage.input_tokens),
        output_tokens: outputTokens,
        cache_read_input_tokens: numeric(usage.cache_read_input_tokens),
        cache_creation_input_tokens: numeric(usage.cache_creation_input_tokens)
      },
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null
    });
  }
  return true;
}

function toRecord(line: ClaudeUsageLine, file: TranscriptFile): TokenUsageRecord {
  return {
    adapter: "claude",
    sessionId: file.sessionId,
    projectPath: file.projectPath,
    modelId: line.model,
    requestId: line.id,
    occurredAt: parseTimestamp(line.timestamp) ?? inferOccurredAt(line.id),
    inputTokens: line.usage.input_tokens,
    outputTokens: line.usage.output_tokens,
    cacheReadTokens: line.usage.cache_read_input_tokens,
    cacheWriteTokens: line.usage.cache_creation_input_tokens,
    reasoningTokens: 0,
    sourceFile: file.absolutePath
  };
}

function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Last-resort stable ordering key when no timestamp exists: hash the message id. */
function inferOccurredAt(requestId: string): Date {
  let hash = 0;
  for (let i = 0; i < requestId.length; i += 1) {
    hash = (hash * 31 + requestId.charCodeAt(i)) | 0;
  }
  return new Date(1_700_000_000_000 + Math.abs(hash) % 40_000_000);
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