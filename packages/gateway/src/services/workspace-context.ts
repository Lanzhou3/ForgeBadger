import { lstat, mkdir, open, readdir, rename, writeFile } from "node:fs/promises";
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

export const maxFileWriteBytes = 1024 * 1024;

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

export async function writeWorkspaceFile(
  projectRoot: string,
  userPath: string,
  content: string
): Promise<WorkspaceFileSnapshot> {
  const rootPath = validateProjectRoot(projectRoot);
  const requestedPath = normalizeUserPath(userPath);
  if (!requestedPath) {
    throw new Error("Workspace file path is required");
  }
  if (Buffer.byteLength(content, "utf8") > maxFileWriteBytes) {
    throw new Error(`Workspace file content exceeds maximum size: ${maxFileWriteBytes} bytes`);
  }
  if (content.includes("\u0000")) {
    throw new Error("Workspace file content must be UTF-8 text");
  }

  const absolutePath = safeResolve(rootPath, requestedPath);
  const fileStats = await lstat(absolutePath);
  if (fileStats.isSymbolicLink()) {
    throw new Error("Workspace file path cannot be a symbolic link");
  }
  if (!fileStats.isFile()) {
    throw new Error("Workspace file path must be a file");
  }
  if (fileStats.size > maxFilePreviewBytes) {
    throw new Error(`Workspace file is too large to edit; only the first ${maxFilePreviewBytes / 1024} KB can be loaded`);
  }

  await writeFile(absolutePath, content, "utf8");
  return readWorkspaceFile(rootPath, requestedPath);
}

/** Creates a new UTF-8 workspace file (including safe ancestor dirs) without overwriting existing files. */
export async function createWorkspaceFile(
  projectRoot: string,
  userPath: string,
  content = ""
): Promise<WorkspaceFileSnapshot> {
  const rootPath = validateProjectRoot(projectRoot);
  const requestedPath = assertSafeWorkspaceMutationPath(userPath);
  if (Buffer.byteLength(content, "utf8") > maxFileWriteBytes) {
    throw new Error(`Workspace file content exceeds maximum size: ${maxFileWriteBytes} bytes`);
  }
  if (content.includes("\u0000")) {
    throw new Error("Workspace file content must be UTF-8 text");
  }

  const absolutePath = safeResolve(rootPath, requestedPath);
  await assertExistingAncestorsRealDirs(rootPath, path.dirname(absolutePath));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  safeResolve(rootPath, requestedPath);

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(absolutePath, "wx");
    await handle.writeFile(content, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new Error("Workspace file already exists");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return readWorkspaceFile(rootPath, requestedPath);
}

/** Safely renames or moves a workspace file/directory inside the approved project root. */
export async function renameWorkspaceEntry(
  projectRoot: string,
  fromPath: string,
  toPath: string
): Promise<{ fromPath: string; toPath: string }> {
  const rootPath = validateProjectRoot(projectRoot);
  const safeFrom = assertSafeWorkspaceMutationPath(fromPath);
  const safeTo = assertSafeWorkspaceMutationPath(toPath);
  if (safeFrom === safeTo) {
    throw new Error("Source and destination paths must differ");
  }

  const fromAbs = safeResolve(rootPath, safeFrom);
  const toAbs = safeResolve(rootPath, safeTo);
  if (toAbs.startsWith(`${fromAbs}${path.sep}`)) {
    throw new Error("Cannot move a directory inside itself");
  }
  await assertExistingAncestorsRealDirs(rootPath, path.dirname(fromAbs));
  const fromStats = await lstat(fromAbs);
  if (fromStats.isSymbolicLink()) {
    throw new Error("Workspace path cannot be a symbolic link");
  }
  await assertExistingAncestorsRealDirs(rootPath, path.dirname(toAbs));
  try {
    await lstat(toAbs);
    throw new Error("Destination path already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(path.dirname(toAbs), { recursive: true });
  safeResolve(rootPath, safeTo);
  await rename(fromAbs, toAbs);
  return {
    fromPath: relativePathFor(rootPath, fromAbs),
    toPath: relativePathFor(rootPath, toAbs)
  };
}

function assertSafeWorkspaceMutationPath(userPath: string): string {
  const requestedPath = normalizeUserPath(userPath);
  if (!requestedPath) {
    throw new Error("Workspace file path is required");
  }
  const segments = requestedPath.split(/[\\/]+/u);
  if (
    segments.some(
      (segment) =>
        segment.toLowerCase() === ".git" || segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw new Error("Invalid workspace file path");
  }
  return requestedPath;
}

async function assertExistingAncestorsRealDirs(rootPath: string, targetDir: string): Promise<void> {
  const rel = path.relative(rootPath, targetDir);
  if (!rel || rel === ".") return;
  let current = rootPath;
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error("Workspace ancestor path escapes or is not a directory");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        break;
      }
      throw error;
    }
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
