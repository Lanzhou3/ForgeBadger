import { z } from "zod";
import {
  CatalogRepository,
  type CatalogItem,
} from "../db/repositories/catalog-repository.js";
import { SkillRepository } from "../db/repositories/skill-repository.js";
import { UserRepository } from "../db/repositories/user-repository.js";
import type { Database } from "../db/types.js";
import {
  parseGitHubSkillLocator,
  parseSkillRemoteProvenance,
  type GitHubRequestOptions,
} from "./github-skill-source.js";
import {
  MARKETPLACE_SEEDS,
  refreshGitHubMarketplace,
} from "./skill-marketplaces.js";
import { registryJson, SkillRegistryHttpError } from "./skill-registry-http.js";
import {
  skillLocatorSchema,
  type SkillLocator,
} from "./skill-registry-package.js";
import { SkillLifecycleError } from "./skill-install-service.js";

export type DiscoveryProvider = "github" | "clawhub" | "skills-sh";
export interface SkillCandidate {
  id: string;
  name: string;
  description: string;
  provider: DiscoveryProvider;
  sourceLabel: string;
  sourceUrl: string;
  locator: SkillLocator;
  installedSkillId?: string | undefined;
}
export interface DiscoveryStatus {
  provider: string;
  status: "ready" | "cached" | "error" | "syncing";
  message?: string | undefined;
}
const object = z.record(z.unknown());
const string = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> =>
  object.safeParse(value).success ? object.parse(value) : {};

export class SkillDiscoveryService {
  private readonly refreshing = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<
    string,
    { until: number; items: SkillCandidate[] }
  >();
  private readonly searching = new Map<string, Promise<SkillCandidate[]>>();
  private readonly backoff = new Map<string, number>();
  constructor(
    private readonly db: Database,
    private readonly options: GitHubRequestOptions = {},
  ) {}

  sources(userId: string) {
    return new CatalogRepository(this.db, userId)
      .listSources()
      .filter((source) => source.type === "skill");
  }
  bootstrap(userId: string) {
    const repo = new CatalogRepository(this.db, userId);
    for (const seed of MARKETPLACE_SEEDS) {
      const existing = repo.getSource(`github:${seed}`);
      if (existing?.status === "disabled") continue;
      const last = existing?.updatedAt?.getTime() ?? 0;
      if (!existing || Date.now() - last > 15 * 60_000)
        void this.refresh(userId, seed).catch(() => undefined);
    }
  }
  async refresh(userId: string, input: string) {
    this.assertActive(userId);
    const locator = parseGitHubSkillLocator(input);
    if (locator.subpath || locator.ref)
      throw new SkillLifecycleError("Use owner/repo for a catalog source", 400);
    const repoName = `${locator.owner}/${locator.repo}`.toLowerCase();
    const sourceId = `github:${repoName}`;
    const key = `${userId}:${sourceId}`;
    if (this.refreshing.has(key)) return this.refreshing.get(key);
    if (this.refreshing.size >= 8)
      throw new SkillLifecycleError(
        "Source synchronization is busy; retry shortly",
        429,
      );
    const repository = new CatalogRepository(this.db, userId);
    if (!repository.getSource(sourceId) && this.sources(userId).length >= 20)
      throw new SkillLifecycleError(
        "At most 20 Skill sources can be configured",
      );
    const existing = repository.getSource(sourceId);
    if (!existing)
      repository.upsertSource({
        sourceId,
        type: "skill",
        label: repoName,
        url: `https://github.com/${repoName}`,
      });
    repository.setSourceStatus(sourceId, "syncing");
    const promise = (async () => {
      try {
        const result = await refreshGitHubMarketplace({
          db: this.db,
          userId,
          repo: repoName,
          ...this.options,
          signal: AbortSignal.timeout(60000),
        });
        this.assertActive(userId);
        repository.setSourceStatus(
          sourceId,
          result.skipped.length ? `partial:${result.skipped.length}` : "active",
        );
        return result;
      } catch (error) {
        repository.setSourceStatus(sourceId, "error");
        throw error;
      } finally {
        this.refreshing.delete(key);
      }
    })();
    this.refreshing.set(key, promise);
    return promise;
  }
  remove(userId: string, sourceId: string) {
    this.assertActive(userId);
    const repository = new CatalogRepository(this.db, userId);
    if (this.refreshing.has(`${userId}:${sourceId}`))
      throw new SkillLifecycleError(
        "Wait for source synchronization before removing it",
      );
    const source = repository.getSource(sourceId);
    if (!source) return;
    repository.replaceItems(sourceId, [], "skill");
    repository.setSourceStatus(sourceId, "disabled");
  }

  async search(
    userId: string,
    input: {
      q: string;
      provider: "all" | DiscoveryProvider;
      page: number;
      includeSkillsSh: boolean;
    },
  ) {
    this.assertActive(userId);
    const catalogCandidates = new CatalogRepository(this.db, userId)
      .listItems()
      .filter((item) => item.itemType === "skill")
      .flatMap((item) => {
        const candidate = catalogCandidate(item);
        return candidate ? [candidate] : [];
      });
    const items: SkillCandidate[] = [];
    const statuses: DiscoveryStatus[] = [];
    if (input.provider === "all" || input.provider === "github") {
      const query = input.q.toLowerCase().split(/\s+/u).filter(Boolean);
      for (const candidate of catalogCandidates) {
        if (
          candidate &&
          query.every((term) =>
            `${candidate.name} ${candidate.description} ${candidate.sourceLabel}`
              .toLowerCase()
              .includes(term),
          )
        )
          items.push(candidate);
      }
      const sources = this.sources(userId);
      const errors = sources.filter(
        (source) =>
          source.status === "error" || source.status.startsWith("partial:"),
      ).length;
      statuses.push({
        provider: "github",
        status: sources.some((source) => source.status === "syncing")
          ? "syncing"
          : errors
            ? "error"
            : "cached",
        ...(errors
          ? {
              message: `${errors} source(s) could not be fully refreshed; cached results retained`,
            }
          : {}),
      });
    }
    const providers: DiscoveryProvider[] = [];
    if (
      input.q.length >= 2 &&
      (input.provider === "all" || input.provider === "clawhub")
    )
      providers.push("clawhub");
    if (
      input.q.length >= 2 &&
      input.includeSkillsSh &&
      (input.provider === "all" || input.provider === "skills-sh")
    )
      providers.push("skills-sh");
    await Promise.all(
      providers.map(async (provider) => {
        const key = `${provider}:${input.q.toLowerCase()}`;
        const cached = this.cache.get(key);
        try {
          if (cached && cached.until > Date.now()) {
            items.push(...cached.items);
            statuses.push({ provider, status: "cached" });
            return;
          }
          if ((this.backoff.get(provider) ?? 0) > Date.now())
            throw new Error("Source is rate-limited; retry later");
          let running = this.searching.get(key);
          if (!running) {
            if (this.searching.size >= 8)
              throw new Error("Skill search is busy; retry shortly");
            running = this.remoteSearch(provider, input.q).finally(() =>
              this.searching.delete(key),
            );
            this.searching.set(key, running);
          }
          const found = await running;
          while (this.cache.size >= 100)
            this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { until: Date.now() + 60_000, items: found });
          items.push(...found);
          statuses.push({ provider, status: "ready" });
        } catch (error) {
          if (error instanceof SkillRegistryHttpError && error.status === 429)
            this.backoff.set(
              provider,
              Date.now() + (error.retryAfter ?? 60) * 1000,
            );
          if (cached) items.push(...cached.items);
          statuses.push({
            provider,
            status: "error",
            message:
              error instanceof Error ? error.message : "Source unavailable",
          });
        }
      }),
    );
    this.assertActive(userId);
    const owned = new SkillRepository(this.db, userId).listOwned();
    const installed = new Map<string, string>();
    const aliases = new Map<string, Set<string>>();
    const remember = (repo: string, name: string, id: string) => {
      const key = `${repo.toLowerCase()}/name:${name.toLowerCase()}`;
      const matches = aliases.get(key) ?? new Set<string>();
      matches.add(id);
      aliases.set(key, matches);
    };
    // Resolve aliases only from a known path in this user's catalog or installed provenance.
    for (const candidate of catalogCandidates)
      if (candidate.locator.kind === "github" && candidate.locator.path) {
        remember(candidate.locator.repo, candidate.name, candidate.id);
        const parts = candidate.locator.path.split("/");
        remember(
          candidate.locator.repo,
          parts.at(-2) ?? candidate.locator.repo.split("/")[1]!,
          candidate.id,
        );
      }
    for (const skill of owned) {
      const origin = parseSkillRemoteProvenance(skill.remoteProvenance);
      if (!origin) continue;
      const path = origin.path.endsWith("SKILL.md")
        ? origin.path
        : `${origin.path}/SKILL.md`;
      const id =
        origin.canonicalId ?? `github:${origin.repo.toLowerCase()}/${path}`;
      installed.set(id, skill.id);
      if (origin.kind === "github" || origin.kind === "marketplace") {
        remember(origin.repo, skill.name, id);
        remember(
          origin.repo,
          path.split("/").at(-2) ?? origin.repo.split("/")[1]!,
          id,
        );
        if (origin.locator?.kind === "github" && origin.locator.skillName)
          remember(origin.repo, origin.locator.skillName, id);
      }
    }
    const seen = new Set<string>();
    const candidates: SkillCandidate[] = [];
    for (const candidate of items) {
      const locator = candidate.locator;
      const matches =
        locator.kind === "github" && locator.skillName
          ? aliases.get(
              `${locator.repo.toLowerCase()}/name:${locator.skillName.toLowerCase()}`,
            )
          : undefined;
      const id = matches?.size === 1 ? [...matches][0]! : candidate.id;
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push({
        ...candidate,
        id,
        installedSkillId: installed.get(id),
      });
    }
    const offset = input.page * 20;
    return {
      items: candidates.slice(offset, offset + 20),
      total: candidates.length,
      page: input.page,
      hasMore: offset + 20 < candidates.length,
      statuses,
    };
  }

  private async remoteSearch(
    provider: DiscoveryProvider,
    q: string,
  ): Promise<SkillCandidate[]> {
    if (provider === "skills-sh") {
      const data = record(
        await registryJson(
          `https://skills.sh/api/search?${new URLSearchParams({ q, limit: "50" })}`,
          this.options,
        ),
      );
      return z
        .array(z.unknown())
        .max(200)
        .parse(data.skills)
        .flatMap((value) => {
          const item = record(value);
          const repo = string(item.source);
          const skillName = string(item.skillId) || string(item.name);
          try {
            parseGitHubSkillLocator(repo);
            if (repo.split("/").length !== 2 || !skillName) return [];
          } catch {
            return [];
          }
          return [
            {
              id: `github:${repo}/name:${skillName}`,
              name: skillName,
              description: "",
              provider: "skills-sh" as const,
              sourceLabel: repo,
              sourceUrl: `https://skills.sh/${repo}/${encodeURIComponent(skillName)}`,
              locator: { kind: "github" as const, repo, skillName },
            },
          ];
        });
    }
    const data = record(
      await registryJson(
        `https://clawhub.ai/api/v1/search?${new URLSearchParams({ q, limit: "50", nonSuspiciousOnly: "true" })}`,
        this.options,
      ),
    );
    return z
      .array(z.unknown())
      .max(200)
      .parse(data.results)
      .flatMap((value) => {
        const item = record(value);
        const install = record(item.install);
        const identity = record(item.sourceIdentity);
        const owner =
          string(item.ownerHandle) || string(record(item.owner).handle);
        const slug = string(item.slug);
        if (!owner || !slug) return [];
        const trust = record(item.trust);
        if (trust.installability && trust.installability !== "installable")
          return [];
        if (item.source === "skills-sh" || install.kind === "skills-sh") {
          const repoName = string(identity.repo);
          if (!repoName) return [];
          const repo = `${owner}/${repoName}`;
          try {
            parseGitHubSkillLocator(repo);
          } catch {
            return [];
          }
          return [
            {
              id: `github:${repo}/name:${slug}`,
              name: string(item.displayName) || slug,
              description: string(item.summary).slice(0, 4096),
              provider: "clawhub" as const,
              sourceLabel: repo,
              sourceUrl: `https://skills.sh/${repo}/${encodeURIComponent(slug)}`,
              locator: { kind: "github" as const, repo, skillName: slug },
            },
          ];
        }
        const parsed = skillLocatorSchema.safeParse({
          kind: "clawhub",
          owner,
          slug,
        });
        if (!parsed.success) return [];
        return [
          {
            id: `clawhub:${owner.toLowerCase()}/${slug}`,
            name: string(item.displayName) || slug,
            description: string(item.summary).slice(0, 4096),
            provider: "clawhub" as const,
            sourceLabel: `${owner}/${slug}`,
            sourceUrl: `https://clawhub.ai/${encodeURIComponent(owner)}/skills/${encodeURIComponent(slug)}`,
            locator: parsed.data,
          },
        ];
      });
  }
  private assertActive(userId: string) {
    if (new UserRepository(this.db).findById(userId)?.status !== "active")
      throw new SkillLifecycleError("User is inactive", 403);
  }
}

function catalogCandidate(item: CatalogItem): SkillCandidate | undefined {
  try {
    const data = record(JSON.parse(item.metadata ?? "{}"));
    const origin = record(data.marketplace);
    if (typeof origin.repo !== "string" || typeof origin.skillPath !== "string")
      return;
    const path = origin.skillPath.endsWith("SKILL.md")
      ? origin.skillPath
      : `${origin.skillPath}/SKILL.md`;
    return {
      id: `github:${origin.repo}/${path}`,
      name: item.name,
      description: item.description ?? "",
      provider: "github",
      sourceLabel: origin.repo,
      sourceUrl: `https://github.com/${origin.repo}`,
      locator: {
        kind: "github",
        repo: origin.repo,
        path,
        ...(typeof origin.ref === "string" ? { ref: origin.ref } : {}),
      },
    };
  } catch {
    return;
  }
}
