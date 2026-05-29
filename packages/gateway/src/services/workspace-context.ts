import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";

import { safeResolve, validateProjectRoot } from "../lib/safe-resolve.js";

export interface WorkspaceTreeInput {
  path?: string | undefined;
  depth?: number | undefined;
  limit?: number | undefined;
}

export interface WorkspaceTreeSnapshot {
  rootPath: string;
  path: string;
  entries: WorkspaceTreeEntry[];
  truncated: boolean;
}

export interface WorkspaceTreeEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  sizeBytes?: number | undefined;
  updatedAt?: string | undefined;
  children?: WorkspaceTreeEntry[] | undefined;
}

export interface WorkspaceFileSnapshot {
  rootPath: string;
  path: string;
  name: string;
  sizeBytes: number;
  updatedAt: string;
  encoding: "utf8";
  content: string;
  truncated: boolean;
  binary: false;
}

const defaultTreeDepth = 1;
const maxTreeDepth = 3;
const defaultTreeLimit = 200;
const maxTreeLimit = 500;
const maxFilePreviewBytes = 64 * 1024;

export async function listWorkspaceTree(
  projectRoot: string,
  input: WorkspaceTreeInput = {}
): Promise<WorkspaceTreeSnapshot> {
  const rootPath = validateProjectRoot(projectRoot);
  const requestedPath = normalizeUserPath(input.path);
  const absolutePath = safeResolve(rootPath, requestedPath || ".");
  const directoryStats = await lstat(absolutePath);
  if (directoryStats.isSymbolicLink()) {
    throw new Error("Workspace tree path cannot be a symbolic link");
  }
  if (!directoryStats.isDirectory()) {
    throw new Error("Workspace tree path must be a directory");
  }

  const state = {
    limit: clampInteger(input.limit, defaultTreeLimit, 1, maxTreeLimit),
    count: 0,
    truncated: false
  };
  const depth = clampInteger(input.depth, defaultTreeDepth, 1, maxTreeDepth);
  const entries = await listDirectory(rootPath, absolutePath, depth, state);

  return {
    rootPath,
    path: relativePathFor(rootPath, absolutePath),
    entries,
    truncated: state.truncated
  };
}

export async function readWorkspaceFile(
  projectRoot: string,
  userPath: string
): Promise<WorkspaceFileSnapshot> {
  const rootPath = validateProjectRoot(projectRoot);
  const requestedPath = normalizeUserPath(userPath);
  if (!requestedPath) {
    throw new Error("Workspace file path is required");
  }

  const absolutePath = safeResolve(rootPath, requestedPath);
  const fileStats = await lstat(absolutePath);
  if (fileStats.isSymbolicLink()) {
    throw new Error("Workspace file path cannot be a symbolic link");
  }
  if (!fileStats.isFile()) {
    throw new Error("Workspace file path must be a file");
  }

  const bytesToRead = Math.min(fileStats.size, maxFilePreviewBytes);
  const buffer = Buffer.alloc(bytesToRead);
  const file = await open(absolutePath, "r");
  try {
    const result = bytesToRead === 0
      ? { bytesRead: 0 }
      : await file.read(buffer, 0, bytesToRead, 0);
    const chunk = buffer.subarray(0, result.bytesRead);
    if (isBinaryBuffer(chunk)) {
      throw new Error("Workspace file is binary; text preview is unavailable");
    }

    return {
      rootPath,
      path: relativePathFor(rootPath, absolutePath),
      name: path.basename(absolutePath),
      sizeBytes: fileStats.size,
      updatedAt: fileStats.mtime.toISOString(),
      encoding: "utf8",
      content: chunk.toString("utf8"),
      truncated: fileStats.size > result.bytesRead,
      binary: false
    };
  } finally {
    await file.close();
  }
}

async function listDirectory(
  rootPath: string,
  directoryPath: string,
  depth: number,
  state: { limit: number; count: number; truncated: boolean }
): Promise<WorkspaceTreeEntry[]> {
  const dirents = await readdir(directoryPath, { withFileTypes: true });
  const entries = dirents.sort(compareDirents);
  const result: WorkspaceTreeEntry[] = [];

  for (const dirent of entries) {
    if (state.count >= state.limit) {
      state.truncated = true;
      break;
    }

    const absolutePath = path.join(directoryPath, dirent.name);
    const stats = await lstat(absolutePath);
    const entry: WorkspaceTreeEntry = {
      name: dirent.name,
      path: relativePathFor(rootPath, absolutePath),
      kind: kindFor(stats),
      updatedAt: stats.mtime.toISOString()
    };
    if (stats.isFile()) {
      entry.sizeBytes = stats.size;
    }

    state.count += 1;
    if (stats.isDirectory() && depth > 1) {
      entry.children = await listDirectory(rootPath, absolutePath, depth - 1, state);
    }
    result.push(entry);
  }

  return result;
}

function normalizeUserPath(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === ".") {
    return "";
  }
  return trimmed;
}

function relativePathFor(rootPath: string, absolutePath: string): string {
  const relativePath = path.relative(rootPath, absolutePath);
  if (!relativePath || relativePath === ".") {
    return "";
  }
  return relativePath.split(path.sep).join(path.posix.sep);
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function compareDirents(a: { name: string; isDirectory(): boolean }, b: { name: string; isDirectory(): boolean }): number {
  if (a.isDirectory() !== b.isDirectory()) {
    return a.isDirectory() ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

function kindFor(stats: Awaited<ReturnType<typeof lstat>>): WorkspaceTreeEntry["kind"] {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  if (stats.isSymbolicLink()) return "symlink";
  return "other";
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}
