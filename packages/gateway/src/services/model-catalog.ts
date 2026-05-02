export interface ModelPreset {
  id: string;
  label: string;
  provider: string;
  modelId: string;
  endpoint: string;
  tier: "performance" | "balanced" | "budget" | "local";
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

export function getModelPresets(): ModelPreset[] {
  return modelPresets;
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
