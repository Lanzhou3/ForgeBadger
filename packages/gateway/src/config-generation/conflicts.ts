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
      allowedActions: conflictType === "exists" ? ["skip"] : ["skip", "overwrite"]
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
