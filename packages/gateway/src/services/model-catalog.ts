export interface ModelPreset {
  id: string;
  label: string;
  provider: string;
  modelId: string;
  endpoint: string;
  tier: "performance" | "balanced" | "budget" | "local";
}

export type ProviderAuthType = "api_key" | "bearer_token" | "oauth" | "none";
export type ProviderApiFormat = "anthropic" | "openai" | "openai-compatible" | "google" | "bedrock" | "local";
export type ProviderSupportedAdapter = "claude" | "opencode";
export type ProviderModelSource = "static" | "dynamic";

export interface ProviderModelPreset {
  id: string;
  name: string;
  modelId: string;
  capabilities: string[];
  contextWindow?: number;
}

export interface ProviderCatalogPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: ProviderAuthType;
  apiFormat: ProviderApiFormat;
  supportedAdapters: ProviderSupportedAdapter[];
  modelSource: ProviderModelSource;
  modelFetch?: {
    strategy: "openai-compatible";
    modelsUrl?: string;
  };
  defaultModels: ProviderModelPreset[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ModelGroup<TModel> {
  provider: string;
  count: number;
  models: TModel[];
}

const modelPresets: ModelPreset[] = [
  {
    id: "anthropic-sonnet",
    label: "Claude Sonnet",
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    endpoint: "https://api.anthropic.com",
    tier: "balanced"
  },
  {
    id: "anthropic-opus",
    label: "Claude Opus",
    provider: "anthropic",
    modelId: "claude-opus-4-1",
    endpoint: "https://api.anthropic.com",
    tier: "performance"
  },
  {
    id: "openai-gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    modelId: "gpt-4o",
    endpoint: "https://api.openai.com/v1",
    tier: "balanced"
  },
  {
    id: "google-gemini-pro",
    label: "Gemini Pro",
    provider: "google",
    modelId: "gemini-pro",
    endpoint: "https://generativelanguage.googleapis.com",
    tier: "budget"
  },
  {
    id: "local-openai-compatible",
    label: "Local OpenAI-Compatible",
    provider: "local",
    modelId: "local-model",
    endpoint: "http://127.0.0.1:11434/v1",
    tier: "local"
  }
];

const providerCatalog: ProviderCatalogPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Anthropic Claude API provider.",
    baseUrl: "https://api.anthropic.com",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["claude"],
    modelSource: "static",
    defaultModels: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", modelId: "claude-sonnet-4-5-20250929", capabilities: ["chat", "code"] },
      { id: "claude-opus-4-5", name: "Claude Opus 4.5", modelId: "claude-opus-4-5-20251101", capabilities: ["chat", "code", "reasoning"] },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", modelId: "claude-haiku-4-5-20251001", capabilities: ["chat", "code", "fast"] }
    ]
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI API provider.",
    baseUrl: "https://api.openai.com/v1",
    authType: "api_key",
    apiFormat: "openai",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "gpt-5-1", name: "GPT-5.1", modelId: "gpt-5.1", capabilities: ["chat", "code", "reasoning"] },
      { id: "gpt-4o", name: "GPT-4o", modelId: "gpt-4o", capabilities: ["chat", "vision"] }
    ]
  },
  {
    id: "openai-compatible",
    name: "OpenAI-Compatible",
    description: "Custom gateway that exposes an OpenAI-compatible API.",
    baseUrl: "https://gateway.example.com/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "custom-chat", name: "Custom Chat", modelId: "custom-chat", capabilities: ["chat"] }
    ]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek OpenAI-compatible API.",
    baseUrl: "https://api.deepseek.com",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible", modelsUrl: "https://api.deepseek.com/models" },
    defaultModels: [
      { id: "deepseek-chat", name: "DeepSeek Chat", modelId: "deepseek-chat", capabilities: ["chat", "code"] },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner", modelId: "deepseek-reasoner", capabilities: ["chat", "code", "reasoning"] }
    ]
  },
  {
    id: "moonshot",
    name: "Moonshot/Kimi",
    description: "Moonshot Kimi OpenAI-compatible API.",
    baseUrl: "https://api.moonshot.cn/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "kimi-k2-6", name: "Kimi K2.6", modelId: "kimi-k2.6", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "kimi-for-coding",
    name: "Kimi For Coding",
    description: "Kimi coding-plan endpoint for OpenCode via the Anthropic AI SDK provider.",
    baseUrl: "https://api.kimi.com/coding/v1",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "kimi-for-coding", name: "Kimi For Coding", modelId: "kimi-for-coding", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "kimi-for-coding-claude",
    name: "Kimi For Coding (Claude Code)",
    description: "Kimi coding-plan Anthropic-compatible endpoint for Claude Code config.",
    baseUrl: "https://api.kimi.com/coding/",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["claude"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "kimi-for-coding-claude", name: "Kimi For Coding", modelId: "kimi-for-coding", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "dashscope",
    name: "Bailian/DashScope",
    description: "Alibaba Cloud Bailian DashScope OpenAI-compatible API.",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus", modelId: "qwen3-coder-plus", capabilities: ["chat", "code"] },
      { id: "qwen3-max", name: "Qwen3 Max", modelId: "qwen3-max", capabilities: ["chat", "code", "reasoning"] }
    ]
  },
  {
    id: "bailian-for-coding",
    name: "Bailian For Coding",
    description: "Alibaba Cloud Bailian coding-plan Anthropic-compatible endpoint for Claude Code.",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["claude"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "bailian-coding-qwen3-coder-plus", name: "Qwen3 Coder Plus", modelId: "qwen3-coder-plus", capabilities: ["chat", "code"] },
      { id: "bailian-coding-qwen3-max", name: "Qwen3 Max", modelId: "qwen3-max", capabilities: ["chat", "code", "reasoning"] }
    ]
  },
  {
    id: "zhipu",
    name: "Zhipu GLM",
    description: "Zhipu GLM OpenAI-compatible API.",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "glm-5", name: "GLM-5", modelId: "glm-5", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax coding-plan OpenAI-compatible API.",
    baseUrl: "https://api.minimaxi.com/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "minimax-m2-7", name: "MiniMax M2.7", modelId: "MiniMax-M2.7", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "minimax-claude",
    name: "MiniMax (Claude Code)",
    description: "MiniMax coding-plan Anthropic-compatible endpoint for Claude Code.",
    baseUrl: "https://api.minimaxi.com/anthropic",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["claude"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "minimax-claude-m2-7", name: "MiniMax M2.7", modelId: "MiniMax-M2.7", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    description: "SiliconFlow OpenAI-compatible gateway.",
    baseUrl: "https://api.siliconflow.cn/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "siliconflow-qwen", name: "Qwen Coder", modelId: "Qwen/Qwen2.5-Coder-32B-Instruct", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter multi-provider gateway.",
    baseUrl: "https://openrouter.ai/api/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    modelSource: "dynamic",
    modelFetch: { strategy: "openai-compatible" },
    defaultModels: [
      { id: "openrouter-auto", name: "OpenRouter Auto", modelId: "openrouter/auto", capabilities: ["chat"] }
    ]
  },
  {
    id: "google-gemini",
    name: "Google Gemini",
    description: "Google Gemini API provider.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    authType: "api_key",
    apiFormat: "google",
    supportedAdapters: ["opencode"],
    modelSource: "static",
    defaultModels: [
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview", modelId: "gemini-3-flash-preview", capabilities: ["chat", "code"] },
      { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview", modelId: "gemini-3-pro-preview", capabilities: ["chat", "code", "reasoning"] }
    ]
  },
  {
    id: "aws-bedrock",
    name: "AWS Bedrock",
    description: "AWS Bedrock provider profile.",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    authType: "none",
    apiFormat: "bedrock",
    supportedAdapters: ["opencode"],
    modelSource: "static",
    defaultModels: [
      { id: "bedrock-claude-opus-4-7", name: "Claude Opus 4.7", modelId: "global.anthropic.claude-opus-4-7", capabilities: ["chat", "code", "reasoning"] },
      { id: "bedrock-claude-sonnet-4-6", name: "Claude Sonnet 4.6", modelId: "global.anthropic.claude-sonnet-4-6", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "ollama",
    name: "Ollama/local",
    description: "Local OpenAI-compatible Ollama endpoint.",
    baseUrl: "http://127.0.0.1:11434/v1",
    authType: "none",
    apiFormat: "local",
    supportedAdapters: ["opencode"],
    modelSource: "static",
    defaultModels: [
      { id: "llama-local", name: "Local Llama", modelId: "llama3.1", capabilities: ["chat", "local"] }
    ]
  }
];

export function getModelPresets(): ModelPreset[] {
  return modelPresets;
}

export function getProviderCatalog(): ProviderCatalogPreset[] {
  return providerCatalog;
}

export function getProviderCatalogPreset(id: string): ProviderCatalogPreset | undefined {
  return providerCatalog.find((provider) => provider.id === id);
}

export function groupModelsByProvider<TModel extends { provider: string }>(
  models: TModel[]
): Array<ModelGroup<TModel>> {
  const groups = new Map<string, TModel[]>();
  for (const model of models) {
    const provider = model.provider.trim().toLowerCase() || "unknown";
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, groupedModels]) => ({
      provider,
      count: groupedModels.length,
      models: groupedModels
    }));
}
