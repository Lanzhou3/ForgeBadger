import { readFile } from "node:fs/promises";

import { safeResolve } from "../lib/safe-resolve.js";
import { sha256 } from "./hash.js";
import type { ConflictReport, GeneratedFile, RenderPlan } from "./types.js";

export async function detectConfigConflicts(plan: RenderPlan): Promise<ConflictReport[]> {
  const conflicts: ConflictReport[] = [];

  for (const file of plan.files) {
    const unsafeConflict = resolveUnsafeConflict(plan.targetRoot, file);
    if (unsafeConflict) {
      conflicts.push(unsafeConflict);
      continue;
    }

    const existingContent = await readExistingFile(plan.targetRoot, file.relativePath);
    if (existingContent === undefined) {
      continue;
    }

    const existingSha256 = sha256(existingContent);
    const conflictType = existingSha256 === file.sha256 ? "exists" : "modified";
    conflicts.push({
      relativePath: file.relativePath,
      existingSha256,
      incomingSha256: file.sha256,
      conflictType,
      allowedActions: conflictType === "exists" ? ["skip"] : ["skip", "overwrite"],
      ...(conflictType === "modified" ? { diffPreview: buildDiffPreview(existingContent, file.content) } : {})
    });
  }

  return conflicts;
}

function resolveUnsafeConflict(
  targetRoot: string,
  file: GeneratedFile
): ConflictReport | undefined {
  try {
    safeResolve(targetRoot, file.relativePath);
    return undefined;
  } catch {
    return {
      relativePath: file.relativePath,
      incomingSha256: file.sha256,
      conflictType: "unsafe_path",
      allowedActions: []
    };
  }
}

async function readExistingFile(
  targetRoot: string,
  relativePath: string
): Promise<string | undefined> {
  const absolutePath = safeResolve(targetRoot, relativePath);
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function buildDiffPreview(existingContent: string, incomingContent: string): Array<{ line: number; existing: string; incoming: string }> {
  const existingLines = existingContent.split(/\r?\n/);
  const incomingLines = incomingContent.split(/\r?\n/);
  const maxLines = Math.max(existingLines.length, incomingLines.length);
  const preview: Array<{ line: number; existing: string; incoming: string }> = [];

  for (let index = 0; index < maxLines && preview.length < 8; index += 1) {
    const existing = existingLines[index] ?? "";
    const incoming = incomingLines[index] ?? "";
    if (existing === incoming) {
      continue;
    }
    preview.push({
      line: index + 1,
      existing: redactSensitiveLine(existing),
      incoming: redactSensitiveLine(incoming)
    });
  }

  return preview;
}

function redactSensitiveLine(value: string): string {
  const trimmed = value.length > 160 ? `${value.slice(0, 157)}...` : value;
  if (/api[_-]?key|token|secret|password|authorization/i.test(trimmed)) {
    return "[redacted sensitive line]";
  }
  return trimmed;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
