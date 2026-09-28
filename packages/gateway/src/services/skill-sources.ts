export interface SkillSourceDefinition {
  id: string;
  label: string;
  description: string;
  installMode: "manual" | "catalog" | "remote";
  starterContent: string;
  defaultVersion: string;
}

export interface SkillInstallSeed {
  name: string;
  description?: string | undefined;
  version?: string | undefined;
  content?: string | undefined;
}

export type SkillSourceFetcher = (
  url: string,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "text">>;

export interface PreviewRemoteSkillSourceInput {
  sourceId: string;
  url: string;
  skillId?: string | undefined;
  fetcher?: SkillSourceFetcher | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
}

export interface RemoteSkillSourcePreview {
  name: string;
  description?: string | undefined;
  version: string;
  content: string;
  sizeBytes: number;
  provenance: {
    sourceId: string;
    url: string;
    kind: "manifest" | "raw-skill";
    skillId?: string | undefined;
    fetchedAt: string;
  };
}

interface ManifestSkill {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  content?: string;
}

const skillSources: SkillSourceDefinition[] = [
  {
    id: "local",
    label: "Local",
    description: "Create a Skill from the current workspace or paste a custom definition.",
    installMode: "manual",
    starterContent: skillStarterContent("local", "Create or adapt a local Skill here."),
    defaultVersion: "1.0.0"
  },
  {
    id: "clawhub",
    label: "ClawHub",
    description: "Install a curated Skill package from the community catalog.",
    installMode: "catalog",
    starterContent: skillStarterContent("clawhub", "Imported from ClawHub and ready to customize."),
    defaultVersion: "1.0.0"
  },
  {
    id: "github",
    label: "GitHub",
    description: "Install from a GitHub repository or raw Skill definition.",
    installMode: "remote",
    starterContent: skillStarterContent("github", "Imported from GitHub and ready to customize."),
    defaultVersion: "1.0.0"
  }
];

export function listSkillSources(): SkillSourceDefinition[] {
  return skillSources.map((source) => ({ ...source }));
}

export function getSkillSource(sourceId: string): SkillSourceDefinition | undefined {
  return skillSources.find((source) => source.id === sourceId);
}

export function buildSkillInstallContent(source: SkillSourceDefinition, seed: SkillInstallSeed): string {
  const name = seed.name.trim();
  const description = seed.description?.trim() || source.description;
  const version = seed.version?.trim() || source.defaultVersion;
  const customContent = seed.content?.trim();

  if (customContent) {
    return customContent;
  }

  return source.starterContent
    .replaceAll("{{name}}", name)
    .replaceAll("{{description}}", description)
    .replaceAll("{{version}}", version)
    .replaceAll("{{source}}", source.label);
}

export async function previewRemoteSkillSource(
  input: PreviewRemoteSkillSourceInput
): Promise<RemoteSkillSourcePreview> {
  const source = getSkillSource(input.sourceId);
  if (!source || !["github", "clawhub"].includes(source.id)) {
    throw new Error("Unsupported remote Skill source");
  }

  const url = normalizeRemoteSkillUrl(source.id, input.url);
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 5000, 100), 30000);
  const maxBytes = Math.min(Math.max(input.maxBytes ?? 128 * 1024, 1), 512 * 1024);
  const content = await fetchRemoteSkillText(url, {
    fetcher: input.fetcher,
    timeoutMs,
    maxBytes
  });

  const manifestPreview = parseManifestPreview(content, {
    sourceId: source.id,
    url,
    skillId: input.skillId
  });
  if (manifestPreview) {
    return manifestPreview;
  }

  validateRawSkillPath(url);
  const metadata = parseSkillMarkdownMetadata(content, url);
  validateSkillName(metadata.name);
  return {
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    provenance: {
      sourceId: source.id,
      url,
      kind: "raw-skill",
      fetchedAt: new Date().toISOString()
    }
  };
}

function skillStarterContent(sourceId: string, summary: string): string {
  return `---
name: {{name}}
description: {{description}}
version: {{version}}
source: ${sourceId}
---

# {{name}}

{{description}}

## Source

Installed from {{source}}.

## Usage

{{name}} is available as a Skill in ForgeBadger.

## Notes

${summary}
`;
}

async function fetchRemoteSkillText(
  url: string,
  options: {
    fetcher?: SkillSourceFetcher | undefined;
    timeoutMs: number;
    maxBytes: number;
  }
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Skill source fetch failed with status ${response.status}`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > options.maxBytes) {
      throw new Error("Remote Skill content exceeds size limit");
    }
    return text;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Remote Skill fetch timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseManifestPreview(
  text: string,
  input: { sourceId: string; url: string; skillId?: string | undefined }
): RemoteSkillSourcePreview | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const skill = selectManifestSkill(parsed, input.skillId);
  if (!skill) {
    throw new Error("Remote Skill manifest does not contain a matching Skill");
  }
  const name = skill.name?.trim() || skill.id?.trim();
  if (!name) {
    throw new Error("Remote Skill manifest is missing a Skill name");
  }
  validateSkillName(name);
  const description = skill.description?.trim() || undefined;
  const version = skill.version?.trim() || "1.0.0";
  const content = skill.content?.trimEnd()
    || starterManifestSkillContent(name, description, version);
  return {
    name,
    description,
    version,
    content: `${content}\n`,
    sizeBytes: Buffer.byteLength(text, "utf8"),
    provenance: {
      sourceId: input.sourceId,
      url: input.url,
      kind: "manifest",
      skillId: skill.id ?? input.skillId,
      fetchedAt: new Date().toISOString()
    }
  };
}

function selectManifestSkill(parsed: unknown, skillId: string | undefined): ManifestSkill | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const skills = Array.isArray(record.skills) ? record.skills : undefined;
  if (skills) {
    const skillRecords = skills.filter(isManifestSkill);
    if (skillId) {
      return skillRecords.find((skill) => skill.id === skillId || skill.name === skillId);
    }
    return skillRecords[0];
  }
  if (isManifestSkill(record.skill)) {
    return record.skill;
  }
  return isManifestSkill(record) ? record : undefined;
}

function isManifestSkill(value: unknown): value is ManifestSkill {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    optionalString(record.id) &&
    optionalString(record.name) &&
    optionalString(record.description) &&
    optionalString(record.version) &&
    optionalString(record.content) &&
    (typeof record.id === "string" || typeof record.name === "string")
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function parseSkillMarkdownMetadata(content: string, url: string): {
  name: string;
  description?: string | undefined;
  version: string;
} {
  const frontmatter = parseFrontmatter(content);
  const name = frontmatter.name || skillNameFromUrl(url);
  return {
    name,
    description: frontmatter.description,
    version: frontmatter.version || "1.0.0"
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---\n")) {
    return {};
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return {};
  }
  const metadata: Record<string, string> = {};
  for (const line of content.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = stripQuotes(line.slice(separator + 1).trim());
    if (key) {
      metadata[key] = value;
    }
  }
  return metadata;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function starterManifestSkillContent(name: string, description: string | undefined, version: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description ?? name}`,
    `version: ${version}`,
    "---",
    "",
    `# ${name}`,
    "",
    description ?? "Remote Skill starter content."
  ].join("\n");
}

function normalizeRemoteSkillUrl(sourceId: string, url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Remote Skill URL must use HTTPS");
  }
  if (sourceId === "github") {
    return normalizeGitHubUrl(parsed);
  }
  if (sourceId === "clawhub") {
    if (!["clawhub.ai", "www.clawhub.ai"].includes(parsed.hostname)) {
      throw new Error("ClawHub Skill URL must use clawhub.ai");
    }
    return parsed.toString();
  }
  throw new Error("Unsupported remote Skill source");
}

function normalizeGitHubUrl(parsed: URL): string {
  if (parsed.hostname === "raw.githubusercontent.com" || parsed.hostname === "gist.githubusercontent.com") {
    return parsed.toString();
  }
  if (parsed.hostname !== "github.com") {
    throw new Error("GitHub Skill URL must use github.com or raw.githubusercontent.com");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const blobIndex = parts.indexOf("blob");
  if (parts.length >= 5 && blobIndex === 2) {
    const [owner, repo, , ref, ...fileParts] = parts;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${fileParts.join("/")}`;
  }
  return parsed.toString();
}

function validateRawSkillPath(url: string): void {
  const pathname = new URL(url).pathname;
  if (pathname.split("/").pop() !== "SKILL.md") {
    throw new Error("Raw Skill URL must point to SKILL.md");
  }
}

function skillNameFromUrl(url: string): string {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const skillFileIndex = parts.lastIndexOf("SKILL.md");
  if (skillFileIndex > 0) {
    return parts[skillFileIndex - 1] ?? "remote-skill";
  }
  return "remote-skill";
}

export function validateSkillName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
    throw new Error("Invalid Skill name");
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}
