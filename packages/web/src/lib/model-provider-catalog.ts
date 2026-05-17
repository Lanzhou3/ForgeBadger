import type { ProviderCatalogPreset, ProviderProfile } from "./api";

export type ProviderCatalogAdapterFilter = "all" | "claude" | "opencode" | "openforge-copilot";
export type ProviderCatalogConfiguredFilter = "all" | "configured" | "not-configured";
export type ProviderCatalogSourceFilter = "all" | "verified" | "models.dev";

export interface ProviderCatalogFilters {
  query: string;
  adapter: ProviderCatalogAdapterFilter;
  apiFormat: string;
  source: ProviderCatalogSourceFilter;
  configured: ProviderCatalogConfiguredFilter;
}

export interface ProviderCatalogResult extends ProviderCatalogPreset {
  configuredProvider?: ProviderProfile;
}

export function buildConfiguredProviderMap(providers: ProviderProfile[]): Map<string, ProviderProfile> {
  const configured = new Map<string, ProviderProfile>();
  for (const provider of providers) {
    configured.set(normalize(provider.providerKey), provider);
    configured.set(normalize(provider.name), provider);
  }
  return configured;
}

export function filterProviderCatalog(
  catalog: ProviderCatalogPreset[],
  configuredProviders: Map<string, ProviderProfile>,
  filters: ProviderCatalogFilters
): ProviderCatalogResult[] {
  const query = normalize(filters.query);
  return catalog
    .map((preset): ProviderCatalogResult => ({
      ...preset,
      configuredProvider: configuredProviders.get(normalize(preset.id)) ?? configuredProviders.get(normalize(preset.name)),
    }))
    .filter((result) => matchesConfigured(result, filters.configured))
    .filter((result) => matchesAdapter(result, filters.adapter))
    .filter((result) => filters.apiFormat === "all" || result.apiFormat === filters.apiFormat)
    .filter((result) => matchesSource(result, filters.source))
    .filter((result) => !query || searchableProviderText(result).includes(query));
}

export function sourceLabelForProvider(preset: ProviderCatalogPreset): string {
  if (preset.source === "verified") return "verified";
  if (preset.source === "models.dev" || preset.modelSource === "models.dev") return "models.dev";
  return preset.modelSource;
}

export function isCopilotCompatibleProvider(preset: Pick<ProviderCatalogPreset, "apiFormat">): boolean {
  return preset.apiFormat === "anthropic" || preset.apiFormat === "openai" || preset.apiFormat === "openai-compatible";
}

function matchesConfigured(result: ProviderCatalogResult, filter: ProviderCatalogConfiguredFilter): boolean {
  if (filter === "configured") return Boolean(result.configuredProvider);
  if (filter === "not-configured") return !result.configuredProvider;
  return true;
}

function matchesSource(preset: ProviderCatalogPreset, filter: ProviderCatalogSourceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "verified") return preset.source === "verified";
  return preset.source === "models.dev" || preset.modelSource === "models.dev";
}

function matchesAdapter(result: ProviderCatalogResult, filter: ProviderCatalogAdapterFilter): boolean {
  if (filter === "all") return true;
  if (filter === "openforge-copilot") return isCopilotCompatibleProvider(result);
  return result.supportedAdapters.includes(filter);
}

function searchableProviderText(preset: ProviderCatalogPreset): string {
  return normalize([
    preset.id,
    preset.name,
    preset.description,
    preset.baseUrl,
    preset.apiFormat,
    preset.authType,
    preset.source,
    preset.modelSource,
    preset.region,
    preset.productType,
    preset.endpoints?.anthropic?.baseUrl,
    preset.endpoints?.openai?.baseUrl,
    preset.opencode?.npm,
    preset.opencode?.api,
    ...(preset.opencode?.env ?? []),
    ...preset.supportedAdapters,
  ].filter(Boolean).join(" "));
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
