import { createHash } from "node:crypto";
import { z } from "zod";
import {
  fetchGitHubSkillPackage,
  fetchSkillFile,
  listSkillFiles,
  parseGitHubSkillLocator,
  parseSkillMarkdownFrontmatter,
  resolveGitHubRef,
  type GitHubRequestOptions,
} from "./github-skill-source.js";
import {
  MAX_SKILL_FILES,
  MAX_SKILL_FILE_BYTES,
  parseSkillPackage,
  type SkillPackage,
} from "./skill-package.js";
import { resourcePath } from "./skill-resources.js";
import { registryJson, registryText } from "./skill-registry-http.js";

const name = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_.-]+$/u);
export const skillLocatorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("github"),
      repo: z.string().min(3).max(200),
      path: z.string().max(512).optional(),
      ref: z.string().min(1).max(200).optional(),
      skillName: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clawhub"),
      owner: name,
      slug: name,
      version: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("raw"), url: z.string().url().max(2048) })
    .strict(),
]);
export type SkillLocator = z.infer<typeof skillLocatorSchema>;
export interface RegistryPackage {
  package: SkillPackage;
  locator: SkillLocator;
  revision: string;
  canonicalId: string;
  sourceUrl: string;
}

export async function resolveRegistryPackage(
  input: SkillLocator,
  options: GitHubRequestOptions = {},
): Promise<RegistryPackage> {
  const locator = skillLocatorSchema.parse(input);
  const bounded = {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(60000),
  };
  if (locator.kind === "github") return resolveGitHubPackage(locator, bounded);
  if (locator.kind === "clawhub")
    return resolveClawHubPackage(locator, bounded);
  const url = new URL(locator.url);
  if (!url.pathname.endsWith("/SKILL.md"))
    throw new Error(
      "Raw imports require a standalone SKILL.md URL; use a repository to include resources",
    );
  const content = await registryText(url.href, bounded, MAX_SKILL_FILE_BYTES);
  const pkg = parseSkillPackage([{ path: "SKILL.md", content }]);
  pkg.warnings.push("standalone-markdown");
  return {
    package: pkg,
    locator,
    revision: pkg.packageHash,
    canonicalId: `raw:${url.href}`,
    sourceUrl: url.href,
  };
}

async function resolveGitHubPackage(
  locator: Extract<SkillLocator, { kind: "github" }>,
  options: GitHubRequestOptions,
): Promise<RegistryPackage> {
  const parsed = parseGitHubSkillLocator(locator.repo);
  const repo = `${parsed.owner}/${parsed.repo}`.toLowerCase();
  const ref = locator.ref ?? parsed.ref;
  const resolved = await resolveGitHubRef({
    owner: parsed.owner,
    repo: parsed.repo,
    ...(ref ? { ref } : {}),
    ...options,
  });
  let path = locator.path ?? parsed.subpath;
  if (!path) {
    if (!locator.skillName)
      throw new Error("Choose a Skill path from the repository preview");
    const found = await listSkillFiles({
      ...parsed,
      sha: resolved.sha,
      ...options,
    });
    const matches = found.files.filter(
      (file) => file.name === locator.skillName,
    );
    if (matches.length === 1) path = matches[0]!.path;
    else {
      const candidates: string[] = [];
      if (found.files.length > 256)
        throw new Error(
          "Repository has too many Skills; choose an explicit path",
        );
      for (let i = 0; i < found.files.length; i += 4)
        await Promise.all(
          found.files.slice(i, i + 4).map(async (file) => {
            const content = await fetchSkillFile({
              ...parsed,
              sha: resolved.sha,
              path: file.path,
              ...options,
            });
            if (
              parseSkillMarkdownFrontmatter(content.content).name ===
              locator.skillName
            )
              candidates.push(file.path);
          }),
        );
      if (candidates.length !== 1)
        throw new Error(
          "Skill name is missing or ambiguous; choose an explicit repository path",
        );
      path = candidates[0];
    }
  }
  if (!path) throw new Error("Skill path is required");
  const skillPath =
    path === "SKILL.md" || path.endsWith("/SKILL.md")
      ? path
      : `${path}/SKILL.md`;
  const pkg = await fetchGitHubSkillPackage({
    ...parsed,
    sha: resolved.sha,
    path: skillPath,
    ...options,
  });
  return {
    package: pkg,
    locator: {
      kind: "github",
      repo,
      path: skillPath,
      ref: resolved.ref,
      ...(locator.skillName ? { skillName: locator.skillName } : {}),
    },
    revision: resolved.sha,
    canonicalId: `github:${repo}/${skillPath}`,
    sourceUrl: `https://github.com/${repo}/tree/${resolved.sha}/${skillPath}`,
  };
}

const detailSchema = z.object({
  owner: z.object({ handle: z.string() }),
  latestVersion: z.object({ version: z.string() }).nullable(),
  moderation: z
    .object({
      isMalwareBlocked: z.boolean().optional(),
      isSuspicious: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});
const versionSchema = z.object({
  version: z.object({
    version: z.string(),
    files: z
      .array(
        z.object({
          path: z.string(),
          size: z.number().nonnegative(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        }),
      )
      .min(1)
      .max(MAX_SKILL_FILES),
    security: z
      .object({ status: z.string(), hasWarnings: z.boolean().optional() })
      .nullable()
      .optional(),
  }),
});

async function resolveClawHubPackage(
  locator: Extract<SkillLocator, { kind: "clawhub" }>,
  options: GitHubRequestOptions,
): Promise<RegistryPackage> {
  const base = `https://clawhub.ai/api/v1/skills/${encodeURIComponent(locator.slug)}`;
  const ownerQuery = new URLSearchParams({ ownerHandle: locator.owner });
  const detail = detailSchema.parse(
    await registryJson(`${base}?${ownerQuery}`, options),
  );
  if (detail.owner.handle.toLowerCase() !== locator.owner.toLowerCase())
    throw new Error("ClawHub publisher identity changed");
  if (detail.moderation?.isMalwareBlocked || detail.moderation?.isSuspicious)
    throw new Error("ClawHub has flagged or blocked this Skill");
  const version = locator.version ?? detail.latestVersion?.version;
  if (!version)
    throw new Error(
      "This Skill has no hosted version; install its original GitHub source",
    );
  const response = versionSchema.parse(
    await registryJson(
      `${base}/versions/${encodeURIComponent(version)}?${ownerQuery}`,
      options,
    ),
  );
  if (response.version.version !== version)
    throw new Error("ClawHub returned a different version");
  if (
    response.version.security &&
    ["malicious", "blocked", "suspicious"].includes(
      response.version.security.status,
    )
  )
    throw new Error("ClawHub version is flagged or blocked");
  const files = [];
  let bytes = 0;
  for (const file of response.version.files) {
    resourcePath(file.path);
    bytes += file.size;
    if (file.size > MAX_SKILL_FILE_BYTES || bytes > 1024 * 1024)
      throw new Error("Skill package exceeds file or total size limit");
  }
  for (let i = 0; i < response.version.files.length; i += 4) {
    const batch = await Promise.all(
      response.version.files.slice(i, i + 4).map(async (file) => {
        const query = new URLSearchParams({
          ownerHandle: locator.owner,
          version,
          path: file.path,
        });
        const content = await registryText(
          `${base}/file?${query}`,
          options,
          MAX_SKILL_FILE_BYTES,
        );
        if (createHash("sha256").update(content).digest("hex") !== file.sha256)
          throw new Error("ClawHub file integrity mismatch");
        return { path: file.path, content };
      }),
    );
    files.push(...batch);
  }
  const pkg = parseSkillPackage(files);
  if (response.version.security?.hasWarnings)
    pkg.warnings.push("upstream-review-notes");
  return {
    package: pkg,
    locator: {
      kind: "clawhub",
      owner: locator.owner.toLowerCase(),
      slug: locator.slug,
    },
    revision: version,
    canonicalId: `clawhub:${locator.owner.toLowerCase()}/${locator.slug}`,
    sourceUrl: `https://clawhub.ai/${encodeURIComponent(locator.owner)}/skills/${encodeURIComponent(locator.slug)}`,
  };
}
