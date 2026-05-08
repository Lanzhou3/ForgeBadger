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
    description: "Claude API provider for Claude Code.",
    baseUrl: "https://api.anthropic.com",
    authType: "api_key",
    apiFormat: "anthropic",
    supportedAdapters: ["claude"],
    defaultModels: [
      { id: "claude-sonnet", name: "Claude Sonnet", modelId: "claude-sonnet-4-5", capabilities: ["chat", "code"] },
      { id: "claude-opus", name: "Claude Opus", modelId: "claude-opus-4-1", capabilities: ["chat", "code", "reasoning"] },
      { id: "claude-haiku", name: "Claude Haiku", modelId: "claude-haiku-4-5", capabilities: ["chat", "code", "fast"] }
    ]
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI API provider for OpenCode-compatible workflows.",
    baseUrl: "https://api.openai.com/v1",
    authType: "api_key",
    apiFormat: "openai",
    supportedAdapters: ["opencode"],
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
    defaultModels: [
      { id: "kimi-k2", name: "Kimi K2", modelId: "kimi-k2", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "dashscope",
    name: "Qwen/DashScope",
    description: "Alibaba Cloud DashScope OpenAI-compatible API.",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    defaultModels: [
      { id: "qwen-plus", name: "Qwen Plus", modelId: "qwen-plus", capabilities: ["chat", "code"] },
      { id: "qwen-max", name: "Qwen Max", modelId: "qwen-max", capabilities: ["chat", "code", "reasoning"] }
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
    defaultModels: [
      { id: "glm-4-5", name: "GLM-4.5", modelId: "glm-4.5", capabilities: ["chat", "code"] }
    ]
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax OpenAI-compatible API.",
    baseUrl: "https://api.minimax.io/v1",
    authType: "api_key",
    apiFormat: "openai-compatible",
    supportedAdapters: ["opencode"],
    defaultModels: [
      { id: "minimax-text", name: "MiniMax Text", modelId: "MiniMax-Text-01", capabilities: ["chat"] }
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
    defaultModels: [
      { id: "gemini-pro", name: "Gemini Pro", modelId: "gemini-pro", capabilities: ["chat", "code"] }
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
    defaultModels: [
      { id: "bedrock-claude", name: "Bedrock Claude", modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0", capabilities: ["chat", "code"] }
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
