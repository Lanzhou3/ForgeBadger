/**
 * PI usage source.
 *
 * Reads `~/.pi/agent/sessions/.../<timestamp>_<uuid>.jsonl` transcripts
 * (pi 0.86.0, format v3). Two layouts exist (verified in pi source):
 * the default agent dir organizes files by working directory
 * (`<root>/<encoded-cwd>/<file>.jsonl`), while a custom session dir
 * (`--session-dir` / PI_CODING_AGENT_SESSION_DIR) keeps them flat
 * (`<root>/<file>.jsonl`). Both are scanned; session identity always comes
 * from the file header, never from the directory layout. Every line is an envelope:
 *
 *   {"type":"message","id":"<entryUuid>","parentId","timestamp","message":{...}}
 *
 * and the first line is the session header:
 *
 *   {"type":"session","version":3,"id":"<uuid>","timestamp","cwd":"D:\\..."}
 *
 * Assistant lines carry `message.usage` (camelCase: input/output/cacheRead/
 * cacheWrite/reasoning/totalTokens) plus `message.responseId` — the API
 * response id, unique per assistant line, because every tool round-trip is a
 * separate billable request. Aborted lines are all-zero with no responseId
 * and are skipped.
 *
 * The session id and working directory come from the header, never from the
 * encoded-cwd directory name (that encoding is ambiguous: backslashes become
 * dashes and colons are dropped). When the header is missing or unparseable
 * the file's trailing UUID is used as the session id and projectPath is
 * reported as "unknown".
 *
 * Watermark: JSON map `{ [fileKey]: { bytes, mtimeMs } }` — the same
 * append-only / rewritten / torn-tail semantics as ClaudeCodeSource.
 */

import { openSync, readSync, readFileSync, readdirSync, closeSync, statSync } from "node:fs";
import path from "node:path";

import {
  piSessionsRoot,
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

interface TranscriptFile {
  absolutePath: string;
  sessionId: string;
  projectPath: string;
}

export class PiSource implements UsageSource {
  readonly adapter = "pi" as const;

  scan(lastWatermark: string | null): UsageScanResult {
    const previous = parseWatermark(lastWatermark);
    const root = piSessionsRoot();
    const next: Record<string, WatermarkEntry> = {};
    const records: TokenUsageRecord[] = [];

    let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }> = [];
    try {
      entries = readdirSync(root, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile()
      }));
    } catch {
      return { records, nextWatermark: JSON.stringify(next) };
    }

    const processFile = (absolutePath: string) => {
      const key = cursorKeyForPath(absolutePath);
      const stat = safeStat(absolutePath);
      if (!stat) return;
      const prior = previous[key];
      const file: TranscriptFile = { absolutePath, ...sessionMetaFor(absolutePath, path.basename(absolutePath)) };

      if (prior && prior.mtimeMs === stat.mtimeMs && stat.size <= prior.bytes) {
        // Unchanged since last scan.
        next[key] = { bytes: stat.size, mtimeMs: stat.mtimeMs };
        return;
      }

      if (prior && stat.size > prior.bytes && prior.bytes > 0) {
        // Appended (transcripts are append-only): parse from the recorded offset.
        const chunk = readChunk(absolutePath, prior.bytes);
        const { records: newRecords, consumedBytes } = parseTranscriptChunk(chunk, file);
        records.push(...newRecords);
        next[key] = { bytes: prior.bytes + consumedBytes, mtimeMs: stat.mtimeMs };
        return;
      }

      // First sight or rewritten/shrank: full parse. The watermark records
      // only the consumed (parseable) bytes so a torn trailing line is
      // retried from its start on the next scan.
      const { records: fullRecords, consumedBytes } = parseTranscriptFile(file);
      next[key] = { bytes: Math.min(consumedBytes, stat.size), mtimeMs: stat.mtimeMs };
      records.push(...fullRecords);
    };

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".jsonl")) {
        // Flat layout: custom session dir keeps files at the root level.
        processFile(path.join(root, entry.name));
        continue;
      }
      if (!entry.isDirectory) continue;
      const projectRoot = path.join(root, entry.name);
      let files: string[] = [];
      try {
        files = readdirSync(projectRoot).filter((name) => name.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const name of files) {
        processFile(path.join(projectRoot, name));
      }
    }

    return { records, nextWatermark: JSON.stringify(next) };
  }
}

/**
 * Reads the header (first line) for the session id + cwd. Falls back to the
 * file's trailing UUID and an unknown path when the header is absent or
 * malformed (a partially written first line resolves itself on the next scan
 * because the watermark only advances past parseable content).
 */
function sessionMetaFor(absolutePath: string, fileName: string): SessionMeta {
  const fallbackId = fallbackSessionId(fileName);
  try {
    const fd = openSync(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(8192);
      const bytes = readSync(fd, buffer, 0, buffer.length, 0);
      const head = buffer.subarray(0, bytes).toString("utf8");
      const firstLine = head.split("\n", 1)[0]?.trim() ?? "";
      const parsed: unknown = firstLine ? JSON.parse(firstLine) : null;
      if (isRecord(parsed) && parsed.type === "session") {
        return {
          sessionId: typeof parsed.id === "string" && parsed.id ? parsed.id : fallbackId,
          projectPath: typeof parsed.cwd === "string" && parsed.cwd ? parsed.cwd : "unknown"
        };
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    // Unreadable header: fall through.
  }
  return { sessionId: fallbackId, projectPath: "unknown" };
}

function fallbackSessionId(fileName: string): string {
  const base = fileName.replace(/\.jsonl$/u, "");
  const separator = base.lastIndexOf("_");
  return separator > 0 ? base.slice(separator + 1) : base;
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

interface PiAssistantLine {
  requestId: string;
  modelId: string | null;
  timestamp: string | null;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
  };
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
  const byRequestId = new Map<string, PiAssistantLine>();
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
    const ok = tryCollectLine(line, byRequestId);
    fullConsumed += Buffer.byteLength(line, "utf8");
    if (!ok) {
      // Torn line: roll back to its start so the next scan retries it.
      fullConsumed -= Buffer.byteLength(line, "utf8");
      break;
    }
    fullConsumed += 1; // the newline
  }

  const records: TokenUsageRecord[] = [];
  for (const line of byRequestId.values()) {
    const { usage } = line;
    if (usage.input <= 0 && usage.output <= 0 && usage.cacheRead <= 0
      && usage.cacheWrite <= 0 && usage.reasoning <= 0) {
      continue; // aborted / zero-usage line (no responseId either)
    }
    records.push(toRecord(line, file));
  }
  return { records, consumedBytes: fullConsumed };
}

function parseTranscriptFile(file: TranscriptFile): { records: TokenUsageRecord[]; consumedBytes: number } {
  let content: string;
  try {
    content = readFileSync(file.absolutePath, "utf8");
  } catch {
    return { records: [], consumedBytes: 0 };
  }
  return parseTranscriptChunk(content, file);
}

function tryCollectLine(line: string, byRequestId: Map<string, PiAssistantLine>): boolean {
  if (!line.trim()) return true;
  let entry: unknown;
  try {
    entry = JSON.parse(line) as unknown;
  } catch {
    return false; // torn line
  }
  if (!isRecord(entry) || entry.type !== "message") return true;
  const message = entry.message;
  if (!isRecord(message) || message.role !== "assistant") return true;
  const usage = message.usage;
  if (!isRecord(usage)) return true;

  const requestId = typeof message.responseId === "string" && message.responseId
    ? message.responseId
    : typeof entry.id === "string" && entry.id
      ? entry.id
      : null;
  if (!requestId) return true;
  // One record per API request; a repeated responseId (re-scan overlap) keeps
  // the line with the max output, mirroring the Claude source's dedupe.
  const outputTokens = numeric(usage.output);
  const existing = byRequestId.get(requestId);
  if (!existing || outputTokens > existing.usage.output) {
    const model = typeof message.model === "string" && message.model ? message.model : null;
    const provider = typeof message.provider === "string" && message.provider ? message.provider : null;
    byRequestId.set(requestId, {
      requestId,
      modelId: provider && model ? `${provider}/${model}` : model,
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null,
      usage: {
        input: numeric(usage.input),
        output: outputTokens,
        cacheRead: numeric(usage.cacheRead),
        cacheWrite: numeric(usage.cacheWrite),
        reasoning: numeric(usage.reasoning)
      }
    });
  }
  return true;
}

function toRecord(line: PiAssistantLine, file: TranscriptFile): TokenUsageRecord {
  return {
    adapter: "pi",
    sessionId: file.sessionId,
    projectPath: file.projectPath,
    modelId: line.modelId,
    requestId: line.requestId,
    occurredAt: parseTimestamp(line.timestamp) ?? inferOccurredAt(line.requestId),
    inputTokens: line.usage.input,
    outputTokens: line.usage.output,
    cacheReadTokens: line.usage.cacheRead,
    cacheWriteTokens: line.usage.cacheWrite,
    reasoningTokens: line.usage.reasoning,
    sourceFile: file.absolutePath
  };
}

function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Last-resort stable ordering key when no timestamp exists: hash the request id. */
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
