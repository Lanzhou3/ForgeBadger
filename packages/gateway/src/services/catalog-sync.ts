import { lookup } from "node:dns/promises";
import { z } from "zod";

import {
  CatalogRepository,
  type CatalogItem,
  type CatalogSource,
  type CatalogType,
  type CreateCatalogItemInput
} from "../db/repositories/catalog-repository.js";
import type { Database } from "../db/types.js";
import { validateOutboundHost } from "./network-policy.js";

const manifestSchema = z.object({
  skills: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().optional(),
    content: z.string().optional()
  }).passthrough()).optional(),
  templates: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().optional(),
    exportedAt: z.string().optional(),
    files: z.array(z.object({
      filePath: z.string().min(1),
      content: z.string(),
      fileType: z.string().optional()
    })).min(1)
  }).passthrough()).optional()
});

export type CatalogFetcher = (
  url: string,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status" | "text">>;

export type CatalogHostResolver = (
  hostname: string,
  options: { all: true }
) => Promise<Array<{ address: string; family: number }>>;

export interface FetchRemoteCatalogOptions {
  fetcher?: CatalogFetcher | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
  resolveHost?: CatalogHostResolver | undefined;
}

export interface RefreshRemoteCatalogInput extends FetchRemoteCatalogOptions {
  db: Database;
  userId: string;
  type: CatalogType;
  sourceId: string;
  label: string;
  url: string;
}

export interface RefreshRemoteCatalogResult {
  source: CatalogSource;
  items: CatalogItem[];
}

export async function fetchRemoteCatalogManifest(
  url: string,
  options: FetchRemoteCatalogOptions = {}
): Promise<z.infer<typeof manifestSchema>> {
  const resolveHost = options.resolveHost ?? lookup;
  const validationError = await validateCatalogUrl(url, resolveHost);
  if (validationError) {
    throw new Error(validationError);
  }
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5000, 100), 30000);
  const maxBytes = Math.min(Math.max(options.maxBytes ?? 256 * 1024, 1), 1024 * 1024);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetcher = options.fetcher ?? fetch;
    // Manually follow redirects so each Location can be re-validated against
    // the outbound host blocklist. Native `redirect: "follow"` would skip the
    // check and let an open redirect pivot to an internal address.
    const finalText = await fetchWithManualRedirects(fetcher, url, controller.signal, 5, resolveHost);
    if (Buffer.byteLength(finalText, "utf8") > maxBytes) {
      throw new Error("Manifest exceeds size limit");
    }
    return manifestSchema.parse(JSON.parse(finalText));
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithManualRedirects(
  fetcher: CatalogFetcher,
  initialUrl: string,
  signal: AbortSignal,
  maxHops: number,
  resolveHost: CatalogHostResolver
): Promise<string> {
  let current = initialUrl;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const validationError = await validateCatalogUrl(current, resolveHost);
    if (validationError) {
      throw new Error(validationError);
    }
    const response = await fetcher(current, {
      signal,
      redirect: "manual"
    });
    if (response.status >= 300 && response.status < 400) {
      const headers = (response as Response & { headers: { get(name: string): string | null } }).headers;
      const location = headers.get("location") ?? "";
      if (!location) {
        throw new Error(`Catalog redirect ${response.status} without Location`);
      }
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      throw new Error(`Catalog fetch failed with status ${response.status}`);
    }
    return response.text();
  }
  throw new Error("Catalog redirect chain exceeded maximum hops");
}

export async function refreshRemoteCatalog(
  input: RefreshRemoteCatalogInput
): Promise<RefreshRemoteCatalogResult> {
  const manifest = await fetchRemoteCatalogManifest(input.url, input);
  const repo = new CatalogRepository(input.db, input.userId);
  const source = repo.upsertSource({
    sourceId: input.sourceId,
    type: input.type,
    label: input.label,
    url: input.url,
    lastRefreshedAt: new Date()
  });
  const items = repo.replaceItems(input.sourceId, manifestToItems(input.sourceId, manifest));
  return { source, items };
}

function manifestToItems(
  sourceId: string,
  manifest: z.infer<typeof manifestSchema>
): CreateCatalogItemInput[] {
  const skills = (manifest.skills ?? []).map((skill) => ({
    sourceId,
    itemType: "skill" as const,
    externalId: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    metadata: {
      source_id: sourceId,
      skillPackage: {
        name: skill.name,
        description: skill.description,
        version: skill.version ?? "1.0.0",
        content: skill.content ?? starterSkillContent(skill.name, skill.description)
      }
    }
  }));
  const templates = (manifest.templates ?? []).map((template) => ({
    sourceId,
    itemType: "template" as const,
    externalId: template.id,
    name: template.name,
    description: template.description,
    version: template.version,
    metadata: {
      templatePackage: {
        name: template.name,
        description: template.description,
        version: template.version ?? "1.0.0",
        files: template.files.map((file) => ({
          filePath: file.filePath,
          content: file.content,
          fileType: file.fileType ?? "markdown"
        })),
        ...(template.exportedAt ? { exportedAt: template.exportedAt } : {})
      }
    }
  }));
  return [...skills, ...templates];
}

function starterSkillContent(name: string, description?: string): string {
  return [
    "---",
    `description: ${description ?? name}`,
    "---",
    "",
    `# ${name}`,
    "",
    description ?? "Catalog Skill starter content."
  ].join("\n");
}

function validateCatalogUrl(
  url: string,
  resolveHost: CatalogHostResolver
): Promise<string | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve("Invalid catalog URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return Promise.resolve("Catalog URL must use HTTP or HTTPS");
  }
  return validateOutboundHost(parsed.hostname, resolveHost);
}
