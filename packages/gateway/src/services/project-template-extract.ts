import { readFile, readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Dirent, Stats } from "node:fs";

import { validateProjectRoot } from "../lib/safe-resolve.js";
import type { AdapterId } from "./adapter-discovery.js";
import { candidateFilesForAdapter, fileTypeFor } from "./project-ai-config.js";
import { adapterConfigRoot } from "./project-config-files.js";

export interface ExtractedTemplateFile {
  filePath: string;
  content: string;
  fileType: string;
}

export type SkippedTemplateFileReason =
  | "excluded_directory"
  | "excluded_file"
  | "file_too_large"
  | "total_size_exceeded"
  | "max_files_exceeded"
  | "not_utf8"
  | "depth_exceeded"
  | "maps_to_existing_root_file";

export interface SkippedTemplateFile {
  path: string;
  reason: SkippedTemplateFileReason;
}

export interface ExtractProjectTemplateResult {
  adapter: AdapterId;
  files: ExtractedTemplateFile[];
  skipped: SkippedTemplateFile[];
}

const maxFileBytes = 128 * 1024;
const maxTotalBytes = 2 * 1024 * 1024;
const maxFileCount = 200;
const maxPathSegments = 4;

const excludedDirectories = new Set(["node_modules", ".git"]);

function isExcludedFileName(name: string): boolean {
  return name === "settings.local.json" || name.startsWith(".env");
}

function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}

function decodeUtf8(buffer: Buffer): string | undefined {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (decoded.includes("\u0000")) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Extracts a project's AI CLI configuration (root instruction/config files
 * plus the adapter's config directory) into a portable template file set.
 * The file layout matches what buildProjectConfigFiles renders per adapter,
 * so an extracted template round-trips back onto projects of the same adapter.
 */
export async function extractProjectTemplate(
  projectRoot: string,
  adapter: AdapterId
): Promise<ExtractProjectTemplateResult> {
  let approvedRoot: string;
  try {
    approvedRoot = validateProjectRoot(projectRoot);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error("Project path does not exist or is not a directory");
    }
    throw error;
  }

  const files: ExtractedTemplateFile[] = [];
  const skipped: SkippedTemplateFile[] = [];
  const addedRootFiles = new Set<string>();
  let totalBytes = 0;

  const addFile = async (relativePath: string, absolutePath: string): Promise<boolean> => {
    if (relativePath.split("/").length > maxPathSegments) {
      skipped.push({ path: relativePath, reason: "depth_exceeded" });
      return false;
    }

    let fileStat: Stats;
    try {
      fileStat = await stat(absolutePath);
    } catch {
      return false;
    }
    if (!fileStat.isFile()) {
      return false;
    }
    if (fileStat.size > maxFileBytes) {
      skipped.push({ path: relativePath, reason: "file_too_large" });
      return false;
    }

    const buffer = await readFile(absolutePath);
    const content = decodeUtf8(buffer);
    if (content === undefined) {
      skipped.push({ path: relativePath, reason: "not_utf8" });
      return false;
    }
    if (files.length >= maxFileCount) {
      skipped.push({ path: relativePath, reason: "max_files_exceeded" });
      return false;
    }
    if (totalBytes + buffer.length > maxTotalBytes) {
      skipped.push({ path: relativePath, reason: "total_size_exceeded" });
      return false;
    }

    totalBytes += buffer.length;
    files.push({ filePath: relativePath, content, fileType: fileTypeFor(relativePath) });
    return true;
  };

  for (const rootFile of candidateFilesForAdapter(adapter)) {
    const added = await addFile(rootFile, join(approvedRoot, rootFile));
    if (added) {
      addedRootFiles.add(rootFile);
    }
  }

  // The renderer rewrites .claude/CLAUDE.md (claude) and <root>/AGENTS.md
  // (other adapters) onto the same root instruction file, so a scanned copy
  // of that file would collide with the already collected root file.
  const collidingScanPaths = new Set<string>();
  if (adapter === "claude" && addedRootFiles.has("CLAUDE.md")) {
    collidingScanPaths.add(".claude/CLAUDE.md");
  }
  if (adapter !== "claude" && addedRootFiles.has("AGENTS.md")) {
    collidingScanPaths.add(`${adapterConfigRoot(adapter)}/AGENTS.md`);
  }

  const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relativePath = toPosixPath(join(relativeDir, entry.name));
      if (entry.isDirectory()) {
        if (excludedDirectories.has(entry.name)) {
          skipped.push({ path: relativePath, reason: "excluded_directory" });
        } else {
          await walk(join(absoluteDir, entry.name), relativePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (isExcludedFileName(entry.name)) {
        skipped.push({ path: relativePath, reason: "excluded_file" });
        continue;
      }
      if (collidingScanPaths.has(relativePath)) {
        skipped.push({ path: relativePath, reason: "maps_to_existing_root_file" });
        continue;
      }
      await addFile(relativePath, join(absoluteDir, entry.name));
    }
  };

  const scanRoots = adapter === "codex"
    ? [adapterConfigRoot(adapter), ".agents/skills"]
    : [adapterConfigRoot(adapter)];
  for (const scanRoot of scanRoots) {
    await walk(join(approvedRoot, scanRoot), scanRoot);
  }

  files.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0));
  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { adapter, files, skipped };
}
