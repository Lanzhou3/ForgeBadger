import { describe, expect, it } from "vitest";

import {
  buildConfiguredProviderMap,
  filterProviderCatalog,
  type ProviderCatalogFilters,
} from "./model-provider-catalog";
import type { ProviderCatalogPreset, ProviderProfile } from "./api";

const catalog: ProviderCatalogPreset[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Route models through OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    region: "global",
    productType: "payg_api",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "models.dev",
    source: "models.dev",
    endpoints: { openai: { baseUrl: "https://openrouter.ai/api/v1" } },
    defaultModels: [],
    opencode: { npm: "@openrouter/ai-sdk-provider", env: ["OPENROUTER_API_KEY"] },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude provider",
    baseUrl: "https://api.anthropic.com",
    region: "global",
    productType: "payg_api",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["claude", "opencode"],
    modelSource: "static",
    source: "verified",
    endpoints: { anthropic: { baseUrl: "https://api.anthropic.com" } },
    defaultModels: [],
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Local models",
    baseUrl: "http://localhost:11434",
    region: "local",
    productType: "local",
    authType: "none",
    apiFormat: "local",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    endpoints: { openai: { baseUrl: "http://localhost:11434/v1" } },
    defaultModels: [],
  },
];

const providers: ProviderProfile[] = [
  {
    id: "provider-1",
    providerKey: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    anthropicBaseUrl: null,
    openaiBaseUrl: "https://openrouter.ai/api/v1",
    region: "global",
    productType: "payg_api",
    opencodeNpm: "@openrouter/ai-sdk-provider",
    status: "active",
  },
];

describe("provider catalog browser", () => {
  it("matches providers by name, endpoint, description, and OpenCode package", () => {
    const configured = buildConfiguredProviderMap(providers);
    const filters: ProviderCatalogFilters = {
      query: "openrouter/ai-sdk",
      adapter: "all",
      apiFormat: "all",
      source: "all",
      configured: "all",
    };

    const result = filterProviderCatalog(catalog, configured, filters);

    expect(result.map((provider) => provider.id)).toEqual(["openrouter"]);
    expect(result[0]?.configuredProvider?.id).toBe("provider-1");
  });

  it("filters by configured state, adapter, API format, and source", () => {
    const configured = buildConfiguredProviderMap(providers);

    expect(
      filterProviderCatalog(catalog, configured, {
        query: "",
        adapter: "all",
        apiFormat: "all",
        source: "all",
        configured: "all",
      }).map((provider) => provider.id)
    ).toEqual(["openrouter", "anthropic", "ollama"]);

    expect(
      filterProviderCatalog(catalog, configured, {
        query: "",
        adapter: "claude",
        apiFormat: "anthropic",
        source: "verified",
        configured: "not-configured",
      }).map((provider) => provider.id)
    ).toEqual(["anthropic"]);

    expect(
      filterProviderCatalog(catalog, configured, {
        query: "",
        adapter: "opencode",
        apiFormat: "openai-compatible",
        source: "models.dev",
        configured: "configured",
      }).map((provider) => provider.id)
    ).toEqual(["openrouter"]);

    expect(
      filterProviderCatalog(catalog, configured, {
        query: "",
        adapter: "openforge-copilot",
        apiFormat: "all",
        source: "all",
        configured: "not-configured",
      }).map((provider) => provider.id)
    ).toEqual(["anthropic"]);
  });

  it("deduplicates the same provider product across verified and models.dev catalog sources", () => {
    const duplicatedCatalog: ProviderCatalogPreset[] = [
      {
        id: "qwen-coding-plan-cn",
        name: "Qwen Coding Plan 中国大陆",
        description: "Verified Qwen Coding Plan",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        region: "cn",
        productType: "coding_plan",
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["claude", "opencode"],
        modelSource: "static",
        source: "verified",
        endpoints: {
          anthropic: { baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic" },
          openai: { baseUrl: "https://coding.dashscope.aliyuncs.com/v1" },
        },
        defaultModels: [],
      },
      {
        id: "qwen-coding-plan-cn",
        name: "Qwen Coding Plan 中国大陆",
        description: "models.dev duplicate",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1/",
        region: "cn",
        productType: "coding_plan",
        authType: "api_key",
        apiFormat: "openai-compatible",
        supportedAdapters: ["opencode"],
        modelSource: "models.dev",
        source: "models.dev",
        endpoints: { openai: { baseUrl: "https://coding.dashscope.aliyuncs.com/v1/" } },
        defaultModels: [],
      },
    ];

    const result = filterProviderCatalog(duplicatedCatalog, new Map(), {
      query: "qwen coding plan 中国大陆",
      adapter: "all",
      apiFormat: "all",
      source: "all",
      configured: "all",
    });

    expect(result.map((provider) => provider.id)).toEqual(["qwen-coding-plan-cn"]);
    expect(result[0]?.source).toBe("verified");
  });
});
