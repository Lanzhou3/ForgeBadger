import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { safeResolve, validateProjectRoot } from "../lib/safe-resolve.js";

export interface ExtractedProjectTemplateFile {
  filePath: string;
  content: string;
  fileType: string;
  sizeBytes: number;
}

export interface ExtractProjectTemplateOptions {
  filePaths?: string[] | undefined;
  maxFileBytes?: number | undefined;
  maxTotalBytes?: number | undefined;
  maxFiles?: number | undefined;
}

const configRoots = [".claude", ".opencode", ".codex"];
const defaultMaxFileBytes = 128 * 1024;
const defaultMaxTotalBytes = 1024 * 1024;
const defaultMaxFiles = 100;
const maxDepth = 8;

export async function extractProjectTemplateFiles(
  projectRoot: string,
  options: ExtractProjectTemplateOptions = {}
): Promise<ExtractedProjectTemplateFile[]> {
  const approvedRoot = validateProjectRoot(projectRoot);
  const found: ExtractedProjectTemplateFile[] = [];
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  const maxFiles = options.maxFiles ?? defaultMaxFiles;

  for (const root of configRoots) {
    const rootPath = safeResolve(approvedRoot, root);
    if (!(await isDirectory(rootPath))) {
      continue;
    }
    await walkConfigTree(approvedRoot, root, 0, found, maxFiles, maxFileBytes);
  }

  const selected = selectFiles(found, options.filePaths);
  const maxTotalBytes = options.maxTotalBytes ?? defaultMaxTotalBytes;
  const totalBytes = selected.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > maxTotalBytes) {
    throw new Error(`Project config extraction exceeds maximum total size: ${maxTotalBytes} bytes`);
  }

  return selected.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function walkConfigTree(
  projectRoot: string,
  relativeDir: string,
  depth: number,
  files: ExtractedProjectTemplateFile[],
  maxFiles: number,
  maxFileBytes: number
): Promise<void> {
  if (depth > maxDepth || files.length >= maxFiles) {
    return;
  }

  const directory = safeResolve(projectRoot, relativeDir);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= maxFiles) {
      throw new Error(`Project config extraction exceeds maximum file count: ${maxFiles}`);
    }

    const relativePath = path.posix.join(relativeDir, entry.name);
    const absolutePath = safeResolve(projectRoot, relativePath);
    const fileStat = await stat(absolutePath);
    if (fileStat.isDirectory()) {
      await walkConfigTree(projectRoot, relativePath, depth + 1, files, maxFiles, maxFileBytes);
      continue;
    }
    if (!fileStat.isFile()) {
      continue;
    }

    if (fileStat.size > maxFileBytes) {
      throw new Error(`${relativePath} exceeds maximum size of ${maxFileBytes} bytes`);
    }
    const content = await readFile(absolutePath, "utf8");
    files.push({
      filePath: relativePath,
      content,
      fileType: fileTypeFor(relativePath),
      sizeBytes: fileStat.size
    });
  }
}

function selectFiles(
  files: ExtractedProjectTemplateFile[],
  selectedPaths: string[] | undefined
): ExtractedProjectTemplateFile[] {
  if (!selectedPaths || selectedPaths.length === 0) {
    return files;
  }

  const byPath = new Map(files.map((file) => [file.filePath, file]));
  return selectedPaths.map((filePath) => {
    const file = byPath.get(filePath);
    if (!file) {
      throw new Error(`Selected config file not found: ${filePath}`);
    }
    return file;
  });
}

function fileTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md") return "markdown";
  if (extension === ".json" || extension === ".jsonc") return "json";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  if (extension === ".toml") return "toml";
  if ([".js", ".mjs", ".cjs", ".ts"].includes(extension)) return "javascript";
  return "text";
}

async function isDirectory(pathname: string): Promise<boolean> {
  try {
    return (await stat(pathname)).isDirectory();
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
