import { z } from "zod";

import {
  CatalogRepository,
  type CatalogItem,
  type CatalogSource,
  type CatalogType,
  type CreateCatalogItemInput
} from "../db/repositories/catalog-repository.js";
import type { Database } from "../db/types.js";

const manifestSchema = z.object({
  skills: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().optional(),
    content: z.string().optional()
  }).passthrough()).optional(),
  plugins: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().optional(),
    adapter: z.literal("claude").default("claude"),
    category: z.enum(["workflow", "safety", "integration"]).default("workflow"),
    configPath: z.string().min(1),
    skills: z.array(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      content: z.string()
    })).optional()
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

export interface FetchRemoteCatalogOptions {
  fetcher?: CatalogFetcher | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
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
  validateCatalogUrl(url);
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5000, 100), 30000);
  const maxBytes = Math.min(Math.max(options.maxBytes ?? 256 * 1024, 1), 1024 * 1024);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Catalog fetch failed with status ${response.status}`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("Manifest exceeds size limit");
    }
    return manifestSchema.parse(JSON.parse(text));
  } finally {
    clearTimeout(timeout);
  }
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
  const plugins = (manifest.plugins ?? []).map((plugin) => ({
    sourceId,
    itemType: "plugin" as const,
    externalId: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    metadata: {
      adapter: plugin.adapter,
      category: plugin.category,
      config_path: plugin.configPath,
      pluginPackage: {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description ?? "",
        version: plugin.version ?? "1.0.0",
        adapter: plugin.adapter,
        category: plugin.category,
        configPath: plugin.configPath,
        skills: plugin.skills ?? []
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
  return [...skills, ...plugins, ...templates];
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

function validateCatalogUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Catalog URL must use HTTP or HTTPS");
  }
}
