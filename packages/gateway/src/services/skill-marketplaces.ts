import { z } from "zod";
import { UserRepository } from "../db/repositories/user-repository.js";

import {
  CatalogRepository,
  type CatalogItem,
  type CatalogSource,
  type CreateCatalogItemInput,
} from "../db/repositories/catalog-repository.js";
import type { Database } from "../db/types.js";
import {
  fetchSkillFile,
  listSkillFiles,
  parseGitHubSkillLocator,
  resolveGitHubRef,
  parseSkillMarkdownFrontmatter,
  type GitHubRequestOptions,
} from "./github-skill-source.js";

/**
 * Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) support.
 * A GitHub repo either publishes a marketplace manifest (plugins array) or is
 * treated as a plain Skill repository whose SKILL.md files become catalog
 * items. Items carry `marketplace` metadata instead of inline content; install
 * re-fetches the SKILL.md from the pinned commit SHA on demand.
 *
 * Plugins with a relative string `source` may declare a `skills` array of
 * skill directories (the format used by anthropics/skills, where every
 * plugin points at the repo root with `source: "./"`); each entry expands
 * into its own catalog item.
 */

export const MARKETPLACE_SEEDS = [
  "anthropics/skills",
  "vercel-labs/agent-skills",
  "openai/skills",
] as const;

const marketplaceJsonPath = ".claude-plugin/marketplace.json";

const marketplaceSchema = z
  .object({
    name: z.string().min(1),
    owner: z.object({ name: z.string().min(1) }).passthrough(),
    plugins: z
      .array(
        z
          .object({
            name: z.string().min(1),
            source: z.unknown(),
            description: z.string().optional(),
            version: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export interface MarketplacePluginOrigin {
  /** GitHub repo that hosts the plugin content. */
  repo: string;
  ref?: string | undefined;
  sha?: string | undefined;
  /** Directory inside the repo that holds the plugin (and its SKILL.md). */
  path?: string | undefined;
}

export interface NormalizedMarketplacePlugin {
  /** Display name of the catalog item (skill basename for expanded entries). */
  name: string;
  description?: string | undefined;
  version?: string | undefined;
  /** Original plugin name in the manifest (differs from `name` when expanded). */
  pluginName?: string | undefined;
  /** Stable dedupe key; defaults to the item name. */
  externalId?: string | undefined;
  origin: MarketplacePluginOrigin;
}

export interface SkippedMarketplacePlugin {
  name: string;
  reason: string;
}

export interface ParseMarketplaceResult {
  marketplaceName: string;
  plugins: NormalizedMarketplacePlugin[];
  skipped: SkippedMarketplacePlugin[];
}

export interface RefreshGitHubMarketplaceInput extends GitHubRequestOptions {
  db: Database;
  userId: string;
  repo: string;
  label?: string | undefined;
}

export interface RefreshGitHubMarketplaceResult {
  source: CatalogSource;
  items: CatalogItem[];
  skipped: SkippedMarketplacePlugin[];
  sha: string;
  marketplaceName?: string | undefined;
}

export function parseMarketplaceManifest(
  json: unknown,
  hostRepo: string,
): ParseMarketplaceResult {
  const manifest = marketplaceSchema.parse(json);
  const plugins: NormalizedMarketplacePlugin[] = [];
  const skipped: SkippedMarketplacePlugin[] = [];

  for (const plugin of manifest.plugins) {
    const expanded = expandPluginEntries(plugin);
    if ("reason" in expanded) {
      skipped.push({ name: plugin.name, reason: expanded.reason });
      continue;
    }
    for (const entry of expanded.entries) {
      const normalized = normalizePluginSource(entry.source, hostRepo);
      if ("reason" in normalized) {
        skipped.push({
          name: entry.pluginName ?? entry.name,
          reason: normalized.reason,
        });
        continue;
      }
      const item: NormalizedMarketplacePlugin = {
        name: entry.name,
        origin: normalized.origin,
      };
      if (entry.description) item.description = entry.description;
      if (plugin.version) item.version = plugin.version;
      if (entry.pluginName) item.pluginName = entry.pluginName;
      if (entry.externalId) item.externalId = entry.externalId;
      plugins.push(item);
    }
  }

  return { marketplaceName: manifest.name, plugins, skipped };
}

interface PluginEntrySpec {
  name: string;
  source: unknown;
  description?: string | undefined;
  pluginName?: string | undefined;
  externalId?: string | undefined;
}

type ExpandedPluginResult = { entries: PluginEntrySpec[] } | { reason: string };

/**
 * A plugin with a relative string `source` and a `skills` array expands into
 * one entry per skill directory (anthropics/skills style: `source: "./"` plus
 * `skills: ["./skills/pdf", ...]`). Anything else stays a single entry.
 */
function expandPluginEntries(
  plugin: {
    name: string;
    source?: unknown;
    description?: string | undefined;
    version?: string | undefined;
  } & Record<string, unknown>,
): ExpandedPluginResult {
  const { name, source, description } = plugin;
  if (
    typeof source !== "string" ||
    (source.trim() !== "" && source.trim() !== "." && !source.startsWith("./"))
  ) {
    return { entries: [{ name, source, description }] };
  }
  const skillsRaw = plugin.skills;
  if (!Array.isArray(skillsRaw)) {
    return { entries: [{ name, source, description }] };
  }
  const baseDir = normalizeRelativeDir(source);
  const entries: PluginEntrySpec[] = [];
  for (const raw of skillsRaw) {
    if (typeof raw !== "string") {
      return { reason: "plugin skills entries must be relative path strings" };
    }
    const entryDir = normalizeRelativeDir(raw);
    if (entryDir === "" || !isSafeRelativePath(entryDir)) {
      return { reason: `invalid skills entry "${raw}"` };
    }
    const fullPath = baseDir === "" ? entryDir : `${baseDir}/${entryDir}`;
    entries.push({
      name: basenameOf(fullPath) ?? entryDir,
      source: `./${fullPath}`,
      description,
      pluginName: name,
      externalId: fullPath,
    });
  }
  if (entries.length === 0) {
    return { reason: "plugin declares no skills entries" };
  }
  return { entries };
}

type NormalizeSourceResult =
  | { origin: MarketplacePluginOrigin }
  | { reason: string };

function normalizePluginSource(
  source: unknown,
  hostRepo: string,
): NormalizeSourceResult {
  if (typeof source === "string") {
    const dir = normalizeRelativeDir(source);
    if (dir === "") {
      // Repo root: the Skill's SKILL.md lives at the root of the repository.
      return { origin: { repo: hostRepo } };
    }
    if (!source.startsWith("./")) {
      return { reason: `unsupported source "${source}"` };
    }
    if (!isSafeRelativePath(dir)) {
      return { reason: "invalid relative path source" };
    }
    return { origin: { repo: hostRepo, path: dir } };
  }

  if (!source || typeof source !== "object") {
    return { reason: "missing plugin source" };
  }
  const record = source as Record<string, unknown>;
  const kind = record.source;
  const ref =
    typeof record.ref === "string" && record.ref ? record.ref : undefined;
  const sha =
    typeof record.sha === "string" && record.sha ? record.sha : undefined;

  if (kind === "github") {
    if (typeof record.repo !== "string" || !isSafeRepo(record.repo)) {
      return { reason: "invalid github repo source" };
    }
    const origin: MarketplacePluginOrigin = { repo: record.repo.toLowerCase() };
    if (ref) origin.ref = ref;
    if (sha) origin.sha = sha;
    if (typeof record.path === "string" && isSafeRelativePath(record.path))
      origin.path = record.path;
    return { origin };
  }

  if (kind === "git-subdir") {
    if (
      typeof record.url !== "string" ||
      typeof record.path !== "string" ||
      !isSafeRelativePath(record.path)
    ) {
      return { reason: "invalid git-subdir source" };
    }
    const locator = parseGitHubUrlOnly(record.url);
    if (!locator) {
      return { reason: "git-subdir source is not a github.com URL" };
    }
    const origin: MarketplacePluginOrigin = {
      repo: `${locator.owner}/${locator.repo}`,
      path: record.path,
    };
    if (ref) origin.ref = ref;
    if (sha) origin.sha = sha;
    return { origin };
  }

  if (kind === "npm" || kind === "archive" || kind === "command") {
    return { reason: `${kind} sources are not supported for Skill install` };
  }
  return {
    reason:
      `unsupported source kind ${typeof kind === "string" ? `"${kind}"` : ""}`.trim(),
  };
}

export async function refreshGitHubMarketplace(
  input: RefreshGitHubMarketplaceInput,
): Promise<RefreshGitHubMarketplaceResult> {
  const locator = parseGitHubSkillLocator(input.repo);
  if (locator.subpath || locator.ref) {
    throw new Error("Marketplace repo must use the plain owner/repo format");
  }
  const { db, userId, repo: _repo, label, ...requestOptions } = input;
  const hostRepo = `${locator.owner}/${locator.repo}`;
  const resolved = await resolveGitHubRef({
    owner: locator.owner,
    repo: locator.repo,
    ...requestOptions,
  });
  const sha = resolved.sha;

  const sourceId = `github:${hostRepo.toLowerCase()}`;
  const catalogRepo = new CatalogRepository(db, userId);
  let manifest: ParseMarketplaceResult | undefined;
  try {
    const file = await fetchSkillFile({
      owner: locator.owner,
      repo: locator.repo,
      sha,
      path: marketplaceJsonPath,
      ...requestOptions,
    });
    manifest = parseMarketplaceManifest(JSON.parse(file.content), hostRepo);
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("(404)")))
      throw error;
  }
  const skipped = manifest?.skipped ?? [];
  const locations = new Map<
    string,
    {
      repo: string;
      sha: string;
      ref: string;
      path: string;
      pluginName?: string;
    }
  >();
  const hostFiles = await listSkillFiles({
    owner: locator.owner,
    repo: locator.repo,
    sha,
    ...requestOptions,
  });
  for (const file of hostFiles.files)
    locations.set(`${hostRepo}/${file.path}`, {
      repo: hostRepo,
      sha,
      ref: resolved.ref,
      path: file.path,
    });
  const external = new Map<string, NormalizedMarketplacePlugin>();
  for (const plugin of manifest?.plugins ?? []) {
    if (plugin.origin.repo === hostRepo) continue;
    external.set(
      `${plugin.origin.repo}@${plugin.origin.sha ?? plugin.origin.ref ?? ""}:${plugin.origin.path ?? ""}`,
      plugin,
    );
  }
  const failedOrigins: Array<{
    origin: MarketplacePluginOrigin;
    reason: string;
  }> = [];
  let processed = 0;
  for (const plugin of external.values()) {
    if (++processed > 8) {
      const reason =
        "External repository budget reached; add its repository directly";
      skipped.push({ name: plugin.name, reason });
      failedOrigins.push({ origin: plugin.origin, reason });
      continue;
    }
    try {
      const remote = parseGitHubSkillLocator(plugin.origin.repo);
      const version = plugin.origin.sha
        ? {
            sha: plugin.origin.sha,
            ref: plugin.origin.ref ?? plugin.origin.sha,
          }
        : await resolveGitHubRef({
            ...remote,
            ...(plugin.origin.ref ? { ref: plugin.origin.ref } : {}),
            ...requestOptions,
          });
      const found = await listSkillFiles({
        ...remote,
        sha: version.sha,
        ...(plugin.origin.path ? { subpath: plugin.origin.path } : {}),
        ...requestOptions,
      });
      if (!found.files.length)
        skipped.push({
          name: plugin.name,
          reason: "Plugin contains no discoverable Skill",
        });
      for (const file of found.files)
        locations.set(`${plugin.origin.repo}/${file.path}`, {
          repo: plugin.origin.repo,
          sha: version.sha,
          ref: version.ref,
          path: file.path,
          pluginName: plugin.name,
        });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Discovery failed";
      skipped.push({ name: plugin.name, reason });
      failedOrigins.push({ origin: plugin.origin, reason });
    }
  }
  const entries = [...locations.values()];
  if (entries.length > 256)
    throw new Error("Source exceeds 256 Skills; add a smaller repository");
  const previousItems = new Map(
    catalogRepo
      .listItems()
      .filter((item) => item.sourceId === sourceId && item.itemType === "skill")
      .map((item) => [item.externalId, item]),
  );
  const items: CreateCatalogItemInput[] = [];
  for (let start = 0; start < entries.length; start += 4) {
    await Promise.all(
      entries.slice(start, start + 4).map(async (location) => {
        try {
          const [owner, repo] = location.repo.split("/");
          const file = await fetchSkillFile({
            owner: owner!,
            repo: repo!,
            sha: location.sha,
            path: location.path,
            ...requestOptions,
          });
          const metadata = parseSkillMarkdownFrontmatter(file.content);
          if (!metadata.name || !metadata.description)
            throw new Error("SKILL.md requires name and description");
          items.push({
            sourceId,
            itemType: "skill",
            externalId: `${location.repo}/${location.path}`,
            name: metadata.name,
            description: metadata.description,
            version: metadata.version,
            metadata: {
              marketplace: {
                repo: location.repo,
                sha: location.sha,
                ref: location.ref,
                skillPath: location.path,
                pluginName: location.pluginName,
              },
              canonicalId: `github:${location.repo}/${location.path}`,
            },
          });
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "Metadata unavailable";
          skipped.push({ name: location.path, reason });
          const previous = previousItems.get(
            `${location.repo}/${location.path}`,
          );
          if (previous)
            items.push({
              sourceId,
              itemType: "skill",
              externalId: previous.externalId,
              name: previous.name,
              description: previous.description ?? undefined,
              version: previous.version ?? undefined,
              metadata: {
                ...JSON.parse(previous.metadata ?? "{}"),
                stale: true,
                lastError: reason,
              },
            });
        }
      }),
    );
  }
  if (!items.length && skipped.length)
    throw new Error(
      "No valid Skills could be read; existing catalog is preserved",
    );
  for (const previous of previousItems.values()) {
    const metadata = JSON.parse(previous.metadata ?? "{}") as Record<
      string,
      unknown
    >;
    const origin = metadata.marketplace as
      | { repo?: string; skillPath?: string }
      | undefined;
    const failure = failedOrigins.find(
      (failed) =>
        origin?.repo === failed.origin.repo &&
        (!failed.origin.path ||
          origin.skillPath?.startsWith(`${failed.origin.path}/`)),
    );
    if (
      failure &&
      !items.some((item) => item.externalId === previous.externalId)
    )
      items.push({
        sourceId,
        itemType: "skill",
        externalId: previous.externalId,
        name: previous.name,
        description: previous.description ?? undefined,
        version: previous.version ?? undefined,
        metadata: { ...metadata, stale: true, lastError: failure.reason },
      });
  }
  // Publish source metadata and items together; a failed refresh preserves the old snapshot.
  return db.transaction(() => {
    if (new UserRepository(db).findById(userId)?.status !== "active")
      throw new Error("Source owner is inactive");
    const source = catalogRepo.upsertSource({
      sourceId,
      type: "skill",
      label: label?.trim() || hostRepo,
      url: `https://github.com/${hostRepo}`,
      lastRefreshedAt: new Date(),
    });
    const saved = catalogRepo.replaceItems(
      sourceId,
      items.sort((a, b) => a.externalId.localeCompare(b.externalId)),
      "skill",
    );
    return {
      source,
      items: saved,
      skipped,
      sha,
      ...(manifest ? { marketplaceName: manifest.marketplaceName } : {}),
    };
  })();
}

function isSafeRepo(repo: string): boolean {
  const segments = repo.split("/");
  return (
    segments.length === 2 &&
    segments.every((segment) => /^[A-Za-z0-9_.-]+$/u.test(segment))
  );
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

/** Normalizes a relative marketplace path; repo-root forms ("", ".", "./") map to "". */
function normalizeRelativeDir(source: string): string {
  const trimmed = source.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "./") return "";
  const withoutPrefix = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  return withoutPrefix.replace(/\/+$/u, "");
}

function basenameOf(path: string): string | undefined {
  const segments = path.split("/");
  return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

function parseGitHubUrlOnly(
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
    if (!/^[A-Za-z0-9_.-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repo))
      return undefined;
    return { owner, repo };
  } catch {
    return undefined;
  }
}
