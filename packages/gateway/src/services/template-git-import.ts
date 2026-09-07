import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CreateTemplateInput, TemplateRepository } from "../db/repositories/template-repository.js";

export type GitTemplateAdapterId = "claude" | "opencode" | "codex" | "kimi";

export interface GitTemplateImportInput {
  url: string;
  branch?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
}

export interface GitTemplateImportResult {
  templateId: string;
  name: string;
  adapter: GitTemplateAdapterId | null;
  fileCount: number;
  skippedFiles: string[];
}

export class TemplateGitImportError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TemplateGitImportError";
    this.status = status;
  }
}

const CLONE_TIMEOUT_MS = 120_000;
const CLONE_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        timeout: CLONE_TIMEOUT_MS,
        maxBuffer: CLONE_MAX_BUFFER_BYTES,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(typeof stderr === "string" && stderr.trim() ? stderr.trim() : error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

export function deriveTemplateName(url: string): string {
  const trimmed = url.trim().replace(/\.git$/i, "");
  const segments = trimmed.split(/[/:]/).filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last === ".") {
    return "git-template";
  }
  return last;
}

export function inferTemplateAdapter(filePaths: string[]): GitTemplateAdapterId | null {
  for (const filePath of filePaths) {
    const base = filePath.split("/").pop() ?? filePath;
    if (base === "opencode.json" || base === "opencode.jsonc" || filePath.startsWith(".opencode/")) {
      return "opencode";
    }
  }
  for (const filePath of filePaths) {
    const base = filePath.split("/").pop() ?? filePath;
    if (filePath.startsWith(".codex/") || base === "AGENTS.override.md") {
      return "codex";
    }
  }
  for (const filePath of filePaths) {
    const base = filePath.split("/").pop() ?? filePath;
    if (filePath.startsWith(".kimi-code/") || base === "kimi-code.config.json") {
      return "kimi";
    }
  }
  for (const filePath of filePaths) {
    const base = filePath.split("/").pop() ?? filePath;
    if (filePath.startsWith(".claude/") || base === "CLAUDE.md") {
      return "claude";
    }
  }
  return null;
}

function detectFileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".md":
      return "markdown";
    case ".json":
      return "json";
    case ".jsonc":
      return "json";
    case ".toml":
      return "toml";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".mjs":
    case ".cjs":
    case ".js":
      return "javascript";
    case ".ts":
      return "typescript";
    case ".sh":
      return "shell";
    default:
      return "text";
  }
}

function looksBinary(content: string): boolean {
  const sample = content.slice(0, 8192);
  return sample.includes("\u0000");
}

interface CollectedFiles {
  files: Array<{ filePath: string; content: string; fileType: string }>;
  skipped: string[];
}

async function collectRepositoryFiles(root: string): Promise<CollectedFiles> {
  const files: CollectedFiles["files"] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        if (files.length >= MAX_FILES) {
          skipped.push(toRelative(root, absolute));
          continue;
        }
        const info = await stat(absolute);
        if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_TOTAL_BYTES) {
          skipped.push(toRelative(root, absolute));
          continue;
        }
        const raw = await readFile(absolute, "utf8");
        if (looksBinary(raw)) {
          skipped.push(toRelative(root, absolute));
          continue;
        }
        const content = raw.replace(/\r\n/g, "\n");
        totalBytes += content.length;
        files.push({
          filePath: toRelative(root, absolute),
          content,
          fileType: detectFileType(entry.name)
        });
      }
    }
  }

  await walk(root);
  return { files, skipped };
}

function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

export async function importTemplateFromGit(
  repo: TemplateRepository,
  input: GitTemplateImportInput
): Promise<GitTemplateImportResult> {
  const url = input.url.trim();
  if (!url) {
    throw new TemplateGitImportError("Git URL is required");
  }
  const branch = input.branch?.trim();
  const name = input.name?.trim();
  const description = input.description?.trim();

  const workDir = await mkdtemp(path.join(tmpdir(), "fb-template-git-"));
  try {
    try {
      await runGit(["clone", "--depth", "1", "--quiet", ...(branch ? ["--branch", branch] : []), url, workDir]);
    } catch (error) {
      throw new TemplateGitImportError(
        `Failed to clone repository: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }

    const { files, skipped } = await collectRepositoryFiles(workDir);
    if (files.length === 0) {
      throw new TemplateGitImportError("No importable files found in repository", 404);
    }

    const createInput: CreateTemplateInput = {
      name: name || deriveTemplateName(url),
      version: "1.0.0",
      files
    };
    if (description) {
      createInput.description = description;
    }
    const adapter = inferTemplateAdapter(files.map((file) => file.filePath));
    if (adapter) {
      createInput.adapter = adapter;
    }

    const template = repo.create(createInput);
    return {
      templateId: template.id,
      name: template.name,
      adapter,
      fileCount: files.length,
      skippedFiles: skipped
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
