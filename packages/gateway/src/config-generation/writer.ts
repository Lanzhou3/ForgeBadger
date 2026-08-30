import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { safeResolve } from "../lib/safe-resolve.js";
import { detectConfigConflicts } from "./conflicts.js";
import type { ConflictReport, GeneratedFile, RenderPlan, RollbackResult, WriteResult } from "./types.js";

export type ConfigWriteAction = "skip" | "overwrite";

export interface WriteConfigPlanOptions {
  decisions?: Record<string, ConfigWriteAction>;
  backupRoot?: string;
  failBeforeWrite?: string;
  failRollbackFor?: string[];
}

interface AppliedWrite {
  relativePath: string;
  absolutePath: string;
  backupFile?: string;
  created: boolean;
}

export class ConfigWriteError extends Error {
  readonly conflicts: ConflictReport[];

  constructor(message: string, conflicts: ConflictReport[]) {
    super(message);
    this.name = "ConfigWriteError";
    this.conflicts = conflicts;
  }
}

export async function writeConfigPlan(
  plan: RenderPlan,
  options: WriteConfigPlanOptions = {}
): Promise<WriteResult> {
  const conflicts = await detectConfigConflicts(plan);
  const blockingConflicts = conflicts.filter((conflict) => {
    if (conflict.conflictType === "unsafe_path") {
      return true;
    }
    const decision = options.decisions?.[conflict.relativePath];
    if (decision === undefined && conflict.conflictType === "exists") {
      return false;
    }
    return decision === undefined || !conflict.allowedActions.includes(decision);
  });

  if (blockingConflicts.length > 0) {
    throw new ConfigWriteError("Explicit config write decisions required", blockingConflicts);
  }

  const backupPath = buildBackupPath(plan, options.backupRoot);
  const appliedWrites: AppliedWrite[] = [];
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];

  try {
    for (const file of plan.files) {
      const conflict = conflicts.find((current) => current.relativePath === file.relativePath);
      const decision =
        conflict?.conflictType === "exists"
          ? (options.decisions?.[file.relativePath] ?? "skip")
          : conflict
            ? options.decisions?.[file.relativePath]
            : "overwrite";
      if (decision === "skip") {
        skippedFiles.push(file.relativePath);
        continue;
      }

      if (options.failBeforeWrite === file.relativePath) {
        throw new Error(`Injected write failure for ${file.relativePath}`);
      }

      const absolutePath = safeResolve(plan.targetRoot, file.relativePath);
      const existingContent = await readExistingFile(absolutePath);
      const backupFile =
        existingContent === undefined
          ? undefined
          : await writeBackupFile(backupPath, file.relativePath, existingContent);

      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.content, "utf8");
      const appliedWrite: AppliedWrite = {
        relativePath: file.relativePath,
        absolutePath,
        created: existingContent === undefined
      };
      if (backupFile !== undefined) {
        appliedWrite.backupFile = backupFile;
      }
      appliedWrites.push(appliedWrite);
      writtenFiles.push(file.relativePath);
    }

    return {
      writtenFiles,
      skippedFiles,
      backupPath,
      conflicts,
      outcome: "applied",
      failedFiles: [],
      rollbackAvailable: appliedWrites.length > 0
    };
  } catch (error) {
    const rollbackResult = await rollbackAppliedWrites(appliedWrites, options);
    const outcome = rollbackResult.success ? "rolled_back" : "rollback_failed";
    return {
      writtenFiles,
      skippedFiles,
      backupPath,
      conflicts,
      outcome,
      failedFiles: appliedWrites.map((applied) => applied.relativePath),
      rollbackAvailable: false,
      rollbackResult
    };
  }
}

function buildBackupPath(plan: RenderPlan, backupRoot?: string): string {
  const root = backupRoot ?? join(plan.targetRoot, ".forgebadger", "backups", "config-writes");
  // Use crypto.randomUUID so two writes triggered in the same millisecond do
  // not collide on the backup directory name.
  return join(root, `${plan.projectId}-${plan.templateId}-${Date.now()}-${randomUUID()}`);
}

async function writeBackupFile(
  backupPath: string,
  relativePath: string,
  content: string
): Promise<string> {
  const backupFile = join(backupPath, relativePath);
  await mkdir(dirname(backupFile), { recursive: true });
  await writeFile(backupFile, content, "utf8");
  return backupFile;
}

async function readExistingFile(absolutePath: string): Promise<string | undefined> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function rollbackAppliedWrites(
  appliedWrites: AppliedWrite[],
  options: WriteConfigPlanOptions
): Promise<RollbackResult> {
  const restoredFiles: string[] = [];
  const removedFiles: string[] = [];
  const failedFiles: string[] = [];

  for (const write of [...appliedWrites].reverse()) {
    try {
      if (options.failRollbackFor?.includes(write.relativePath)) {
        throw new Error(`Injected rollback failure for ${write.relativePath}`);
      }

      if (write.created) {
        await rm(write.absolutePath, { force: true });
        removedFiles.push(write.relativePath);
        continue;
      }

      if (write.backupFile) {
        const backupContent = await readFile(write.backupFile, "utf8");
        await writeFile(write.absolutePath, backupContent, "utf8");
        restoredFiles.push(write.relativePath);
      }
    } catch {
      failedFiles.push(write.relativePath);
    }
  }

  return {
    restoredFiles,
    removedFiles,
    failedFiles,
    success: failedFiles.length === 0
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
