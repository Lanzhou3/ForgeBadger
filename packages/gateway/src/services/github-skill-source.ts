import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { z } from "zod";
import { publicFetch } from "./extensions/public-fetch.js";
import {
  readSkillMetadata,
  parseSkillPackage,
  MAX_SKILL_FILES,
  type SkillPackage,
} from "./skill-package.js";

import {
  validateOutboundHost,
  type OutboundHostResolver,
} from "./network-policy.js";

/**
 * GitHub-backed remote Skill source. Talks to the GitHub REST API and
 * raw.githubusercontent.com only — no git client — and pins every install to
 * a resolved commit SHA. All network helpers take an injectable fetcher and
 * DNS resolver so tests never touch the real network.
 */

export type GitHubFetchResponse = Pick<
  Response,
  "ok" | "status" | "headers" | "arrayBuffer"
> &
  Partial<Pick<Response, "body">>;
export type GitHubFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<GitHubFetchResponse>;

export interface GitHubRequestOptions {
  fetcher?: GitHubFetcher | undefined;
  resolveHost?: OutboundHostResolver | undefined;
  timeoutMs?: number | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  signal?: AbortSignal | undefined;
}

export interface GitHubSkillLocator {
  owner: string;
  repo: string;
  ref?: string | undefined;
  subpath?: string | undefined;
}

export interface ResolveGitHubRefResult {
  sha: string;
  ref: string;
}

export interface GitHubSkillFileEntry {
  path: string;
  name: string;
  description?: string | undefined;
  version?: string | undefined;
}

export interface ListSkillFilesInput extends GitHubRequestOptions {
  owner: string;
  repo: string;
  sha: string;
  subpath?: string | undefined;
}

export interface FetchSkillFileInput extends GitHubRequestOptions {
  owner: string;
  repo: string;
  sha: string;
  path: string;
}

export interface GitHubSkillFileContent {
  content: string;
  sizeBytes: number;
}

export interface SkillRemoteProvenanceLastCheck {
  checkedAt: string;
  latestCommitSha: string;
  updateAvailable: boolean;
}

export interface SkillRemoteProvenance {
  kind: "github" | "marketplace" | "clawhub" | "raw";
  repo: string;
  path: string;
  resolvedCommitSha: string;
  contentHash: string;
  installedAt: string;
  ref?: string | undefined;
  marketplaceSourceId?: string | undefined;
  pluginName?: string | undefined;
  lastCheck?: SkillRemoteProvenanceLastCheck | undefined;
  packageHash?: string | undefined;
  canonicalId?: string | undefined;
  legacyGlobalMirror?: boolean | undefined;
  storage?: "database" | undefined;
  locator?: import("./skill-registry-package.js").SkillLocator | undefined;
  sourceUrl?: string | undefined;
}

const apiHost = "api.github.com";
const rawHost = "raw.githubusercontent.com";
const allowedHosts = new Set([apiHost, rawHost]);
const maxSkillBytes = 128 * 1024;
const maxApiBytes = 1024 * 1024;
const maxTreeBytes = 4 * 1024 * 1024;
const maxMarketplaceBytes = 256 * 1024;
const maxTreeEntries = 10000;
const maxRedirectHops = 5;
const skillFileName = "SKILL.md";
const ownerRepoPattern = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubSkillLocator(input: string): GitHubSkillLocator {
  const value = input.trim().replace(/\/+$/u, "");
  if (!value) {
    throw new Error("GitHub repository is required");
  }

  let owner: string;
  let repo: string;
  let ref: string | undefined;
  let subpath: string | undefined;

  if (/^https?:\/\//iu.test(value) || value.startsWith("git@")) {
    if (value.startsWith("git@")) {
      throw new Error("GitHub repository URL must use HTTPS");
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Invalid GitHub repository URL");
    }
    if (url.protocol !== "https:") {
      throw new Error("GitHub repository URL must use HTTPS");
    }
    if (url.hostname !== "github.com") {
      throw new Error("GitHub repository URL must use github.com");
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error("GitHub repository URL must include owner and repo");
    }
    owner = segments[0] as string;
    repo = segments[1] as string;
    if (segments[2] === "tree" && segments.length >= 4) {
      ref = normalizeRefName(decodeURIComponent(segments[3] as string));
      subpath =
        segments.slice(4).map(decodeURIComponent).join("/") || undefined;
    } else if (segments.length > 2) {
      throw new Error(
        "GitHub repository subdirectories must use the /tree/<ref>/<path> URL form",
      );
    }
  } else {
    const segments = value.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error("GitHub repository must use the owner/repo format");
    }
    owner = segments[0] as string;
    repo = segments[1] as string;
    subpath = segments.slice(2).join("/") || undefined;
  }

  repo = repo.replace(/\.git$/u, "");
  if (!ownerRepoPattern.test(owner) || !ownerRepoPattern.test(repo)) {
    throw new Error("GitHub repository contains invalid characters");
  }
  if (subpath) {
    validateRepoRelativePath(subpath, "GitHub repository path");
  }

  const locator: GitHubSkillLocator = { owner, repo };
  if (ref) locator.ref = ref;
  if (subpath) locator.subpath = subpath;
  return locator;
}

export async function resolveGitHubRef(
  input: {
    owner: string;
    repo: string;
    ref?: string | undefined;
  } & GitHubRequestOptions,
): Promise<ResolveGitHubRefResult> {
  const explicitRef = input.ref?.trim();
  let branch = explicitRef;
  if (!branch) {
    const repoInfo = await githubJsonRequest(
      `https://${apiHost}/repos/${input.owner}/${input.repo}`,
      input,
      maxApiBytes,
    );
    const parsed = z
      .object({ default_branch: z.string().min(1).optional() })
      .passthrough()
      .parse(repoInfo);
    branch = parsed.default_branch ?? "main";
  }
  const commit = await githubBufferRequest(
    `https://${apiHost}/repos/${input.owner}/${input.repo}/commits/${encodeURIComponent(branch)}`,
    input,
    4096,
    "GitHub ref lookup failed: ",
    "application/vnd.github.sha",
  );
  const text = new TextDecoder().decode(commit).trim();
  const value: unknown = text.startsWith("{")
    ? JSON.parse(text)
    : { sha: text };
  const parsedCommit = z
    .object({
      sha: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9_-]+$/u),
    })
    .passthrough()
    .parse(value);
  return { sha: parsedCommit.sha, ref: branch };
}

export async function listSkillFiles(
  input: ListSkillFilesInput,
): Promise<{ files: GitHubSkillFileEntry[]; truncated: boolean }> {
  const selected = normalizeSubpath(input.subpath);
  const directory = selected?.endsWith("/SKILL.md")
    ? selected.slice(0, -"/SKILL.md".length)
    : selected === "SKILL.md"
      ? undefined
      : selected;
  const parsed = await readGitHubTree(input, directory);

  const skillPaths = parsed.tree
    .filter(
      (entry) =>
        (entry.type === "blob" || entry.type === undefined) &&
        isSkillFilePath(entry.path),
    )
    .map((entry) => entry.path)
    .sort();

  const subpath = selected;
  const discoveryPrefixes = subpath
    ? undefined
    : await resolveDiscoveryPrefixes(input, parsed.tree);
  const files = skillPaths
    .filter((path) => matchesDiscoveryScope(path, subpath, discoveryPrefixes))
    .map((path) => {
      const entry: GitHubSkillFileEntry = {
        path,
        name: skillNameFromPath(path, input.repo),
      };
      return entry;
    });
  return { files, truncated: parsed.truncated ?? false };
}

export async function fetchSkillFile(
  input: FetchSkillFileInput,
): Promise<GitHubSkillFileContent> {
  const relPath = validateRepoRelativePath(input.path, "Skill file path");
  const encodedPath = relPath.split("/").map(encodeURIComponent).join("/");
  const buffer = await githubBufferRequest(
    `https://${rawHost}/${input.owner}/${input.repo}/${input.sha}/${encodedPath}`,
    input,
    input.path === ".claude-plugin/marketplace.json"
      ? maxMarketplaceBytes
      : maxSkillBytes,
    `Skill file fetch failed with status `,
  );
  const bytes = new Uint8Array(buffer);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("SKILL.md is not valid UTF-8 text");
  }
  if (content.includes("\0")) {
    throw new Error("SKILL.md contains binary data");
  }
  return { content, sizeBytes: bytes.byteLength };
}

export function computeContentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function parseSkillMarkdownFrontmatter(content: string): {
  name?: string | undefined;
  description?: string | undefined;
  version?: string | undefined;
} {
  const metadata = readSkillMetadata(content);
  const extra = z.record(z.unknown()).safeParse(metadata.metadata);
  const version =
    metadata.version ?? (extra.success ? extra.data.version : undefined);
  return {
    ...(typeof metadata.name === "string" ? { name: metadata.name } : {}),
    ...(typeof metadata.description === "string"
      ? { description: metadata.description }
      : {}),
    ...(typeof version === "string" || typeof version === "number"
      ? { version: String(version) }
      : {}),
  };
}

export function serializeSkillRemoteProvenance(
  provenance: SkillRemoteProvenance,
): string {
  return JSON.stringify(provenance);
}

export function parseSkillRemoteProvenance(
  raw: string | null | undefined,
): SkillRemoteProvenance | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  if (
    !["github", "marketplace", "clawhub", "raw"].includes(
      String(record.kind),
    ) ||
    typeof record.repo !== "string" ||
    typeof record.path !== "string" ||
    typeof record.resolvedCommitSha !== "string" ||
    typeof record.contentHash !== "string" ||
    typeof record.installedAt !== "string"
  ) {
    return undefined;
  }
  return parsed as SkillRemoteProvenance;
}

async function resolveDiscoveryPrefixes(
  input: ListSkillFilesInput,
  tree: Array<{ path: string; type?: string | undefined }>,
): Promise<string[]> {
  const prefixes = new Set(["", "skills", ".claude/skills", ".agents/skills"]);
  if (
    tree.some(
      (entry) =>
        entry.path === ".claude-plugin/marketplace.json" &&
        entry.type === "blob",
    )
  ) {
    try {
      const marketplaceFile = await fetchSkillFile({
        owner: input.owner,
        repo: input.repo,
        sha: input.sha,
        path: ".claude-plugin/marketplace.json",
        ...(input.fetcher !== undefined ? { fetcher: input.fetcher } : {}),
        ...(input.resolveHost !== undefined
          ? { resolveHost: input.resolveHost }
          : {}),
        ...(input.timeoutMs !== undefined
          ? { timeoutMs: input.timeoutMs }
          : {}),
        ...(input.env !== undefined ? { env: input.env } : {}),
      });
      if (
        Buffer.byteLength(marketplaceFile.content, "utf8") <=
        maxMarketplaceBytes
      ) {
        for (const dir of marketplaceReferencedSkillDirs(
          marketplaceFile.content,
        )) {
          prefixes.add(dir);
        }
      }
    } catch {
      // Marketplace metadata is best-effort for discovery; plain repos work without it.
    }
  }
  return [...prefixes];
}

function marketplaceReferencedSkillDirs(content: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const plugins = (parsed as Record<string, unknown>).plugins;
  if (!Array.isArray(plugins)) return [];

  const dirs: string[] = [];
  for (const plugin of plugins) {
    if (!plugin || typeof plugin !== "object") continue;
    const source = (plugin as Record<string, unknown>).source;
    if (typeof source === "string" && source.startsWith("./")) {
      dirs.push(source.slice(2));
      continue;
    }
    if (!source || typeof source !== "object") continue;
    const sourceRecord = source as Record<string, unknown>;
    if (
      sourceRecord.source === "git-subdir" &&
      typeof sourceRecord.url === "string" &&
      typeof sourceRecord.path === "string"
    ) {
      const locator = tryParseGitSubdirUrl(sourceRecord.url);
      if (locator) dirs.push(sourceRecord.path);
    }
  }
  return dirs;
}

function tryParseGitSubdirUrl(
  url: string,
): { owner: string; repo: string } | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com")
      return undefined;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return undefined;
    const owner = segments[0] as string;
    const repo = (segments[1] as string).replace(/\.git$/u, "");
    if (!ownerRepoPattern.test(owner) || !ownerRepoPattern.test(repo))
      return undefined;
    return { owner, repo };
  } catch {
    return undefined;
  }
}

function matchesDiscoveryScope(
  path: string,
  subpath: string | undefined,
  discoveryPrefixes: string[] | undefined,
): boolean {
  if (subpath) {
    if (subpath.endsWith(`/${skillFileName}`) || subpath === skillFileName) {
      return path === subpath;
    }
    return path.startsWith(`${subpath}/`);
  }
  if (!discoveryPrefixes) return true;
  return discoveryPrefixes.some((prefix) =>
    prefix === "" ? path === skillFileName : path.startsWith(`${prefix}/`),
  );
}

function isSkillFilePath(path: string): boolean {
  return path === skillFileName || path.endsWith(`/${skillFileName}`);
}

function skillNameFromPath(path: string, repo: string): string {
  if (path === skillFileName) return repo;
  const dir = path.slice(0, path.length - skillFileName.length - 1);
  return dir.split("/").pop() ?? repo;
}

function normalizeSubpath(subpath: string | undefined): string | undefined {
  if (!subpath) return undefined;
  const normalized = subpath.trim().replace(/^\.\//u, "").replace(/\/+$/u, "");
  return normalized || undefined;
}

function normalizeRefName(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function validateRepoRelativePath(path: string, label: string): string {
  const normalized = path.trim().replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

async function githubJsonRequest(
  url: string,
  options: GitHubRequestOptions,
  maxBytes: number,
): Promise<unknown> {
  const buffer = await githubBufferRequest(
    url,
    options,
    maxBytes,
    "GitHub API request failed with status ",
  );
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(buffer));
  } catch {
    throw new Error("GitHub API returned invalid JSON");
  }
}

async function githubBufferRequest(
  initialUrl: string,
  options: GitHubRequestOptions,
  maxBytes: number,
  statusPrefix: string,
  accept = "application/vnd.github+json",
): Promise<ArrayBuffer> {
  const resolveHost = options.resolveHost ?? lookup;
  const fetcher =
    options.fetcher ??
    ((url: string, init?: RequestInit) =>
      publicFetch(url, init, undefined, {
        allowQuery: true,
        maxResponseBytes: maxBytes,
      }));
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 10000, 100), 30000);
  const headers = buildGitHubHeaders(options.env ?? process.env);
  headers.Accept = accept;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = initialUrl;
    for (let hop = 0; hop <= maxRedirectHops; hop += 1) {
      await assertAllowedGitHubUrl(current, resolveHost);
      const response = await fetcher(current, {
        signal: options.signal
          ? AbortSignal.any([controller.signal, options.signal])
          : controller.signal,
        redirect: "manual",
        headers:
          new URL(current).hostname === apiHost
            ? headers
            : { Accept: "application/octet-stream" },
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location") ?? "";
        if (!location) {
          throw new Error(
            `GitHub redirect ${response.status} without Location`,
          );
        }
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) {
          throw new Error(
            "GitHub repository, ref, or file was not found (404)",
          );
        }
        if (response.status === 403) {
          throw new Error(
            "GitHub API rate limit or access denied (403); configure GITHUB_TOKEN to raise the limit",
          );
        }
        throw new Error(`${statusPrefix}${response.status}`);
      }
      const buffer = await boundedBuffer(response, maxBytes);
      if (buffer.byteLength > maxBytes) {
        throw new Error("GitHub response exceeds size limit");
      }
      return buffer;
    }
    throw new Error("GitHub redirect chain exceeded maximum hops");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GitHub request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function assertAllowedGitHubUrl(
  url: string,
  resolveHost: OutboundHostResolver,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid GitHub URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new Error(
      "GitHub requests must use public HTTPS without credentials or custom ports",
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) {
    throw new Error(`Unexpected GitHub host: ${hostname}`);
  }
  const rejection = await validateOutboundHost(hostname, resolveHost);
  if (rejection) {
    throw new Error(`GitHub endpoint rejected: ${rejection}`);
  }
}

function buildGitHubHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ForgeBadger",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

const treeSchema = z.object({
  tree: z
    .array(
      z
        .object({
          path: z.string(),
          type: z.string().optional(),
          mode: z.string().optional(),
          size: z.number().optional(),
        })
        .passthrough(),
    )
    .default([]),
  truncated: z.boolean().optional(),
});

export async function readGitHubTree(
  input: ListSkillFilesInput,
  directory?: string,
) {
  if (directory) validateRepoRelativePath(directory, "Skill directory");
  const selector = directory ? `${input.sha}:${directory}` : input.sha;
  const raw = await githubJsonRequest(
    `https://${apiHost}/repos/${input.owner}/${input.repo}/git/trees/${encodeURIComponent(selector)}?recursive=1`,
    input,
    maxTreeBytes,
  );
  const parsed = treeSchema.parse(raw);
  if (parsed.truncated || parsed.tree.length > maxTreeEntries)
    throw new Error(
      `Repository tree exceeds the ${maxTreeEntries}-entry limit; choose a smaller subdirectory`,
    );
  return {
    ...parsed,
    tree: parsed.tree.map((entry) => ({
      ...entry,
      path: directory ? `${directory}/${entry.path}` : entry.path,
    })),
  };
}

export async function fetchGitHubSkillPackage(
  input: FetchSkillFileInput,
): Promise<SkillPackage> {
  const filePath = validateRepoRelativePath(input.path, "Skill path");
  const main =
    filePath === "SKILL.md" || filePath.endsWith("/SKILL.md")
      ? filePath
      : `${filePath}/SKILL.md`;
  const directory =
    main === "SKILL.md" ? undefined : main.slice(0, -"/SKILL.md".length);
  const tree = await readGitHubTree(input, directory);
  const entries = tree.tree.filter((entry) => entry.type !== "tree");
  if (!entries.length || entries.length > MAX_SKILL_FILES)
    throw new Error(
      `Skill package exceeds ${MAX_SKILL_FILES} files or is empty`,
    );
  for (const entry of entries) {
    if (
      (entry.type !== "blob" && entry.type !== undefined) ||
      entry.mode === "120000" ||
      entry.mode === "160000"
    )
      throw new Error("Skill symlinks and submodules are unsupported");
    if ((entry.size ?? 0) > maxSkillBytes)
      throw new Error("Skill resource exceeds size limit");
    validateRepoRelativePath(entry.path, "Skill resource");
  }
  const files = [];
  for (let start = 0; start < entries.length; start += 4) {
    const batch = await Promise.all(
      entries.slice(start, start + 4).map(async (entry) => {
        const file = await fetchSkillFile({ ...input, path: entry.path });
        return {
          path: directory ? entry.path.slice(directory.length + 1) : entry.path,
          content: file.content,
        };
      }),
    );
    files.push(...batch);
    if (
      files.reduce(
        (total, file) => total + Buffer.byteLength(file.content),
        0,
      ) >
      1024 * 1024
    )
      throw new Error("Skill package exceeds total size limit");
  }
  return parseSkillPackage(files);
}

export async function boundedBuffer(
  response: GitHubFetchResponse,
  maxBytes: number,
): Promise<ArrayBuffer> {
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes)
        throw new Error("GitHub response exceeds size limit");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new Uint8Array(Buffer.concat(chunks)).buffer;
}
