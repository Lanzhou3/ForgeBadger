export interface ModelHealthInput {
  provider: string;
  modelId: string;
  endpoint: string | null;
  status: string;
  isDefault: boolean;
}

export interface ModelHealth {
  healthy: boolean;
  status: "ready" | "needs_attention";
  message: string;
  checkedAt: string;
  checks: {
    modelConfigured: boolean;
    endpointConfigured: boolean;
    defaultModel: boolean;
  };
}

export function buildModelHealth(model: ModelHealthInput): ModelHealth {
  const checks = {
    modelConfigured: model.provider.trim().length > 0 && model.modelId.trim().length > 0,
    endpointConfigured: Boolean(model.endpoint?.trim()),
    defaultModel: model.isDefault
  };
  const healthy = checks.modelConfigured && model.status !== "disabled";
  const message = healthy
    ? checks.endpointConfigured
      ? "Model configuration is ready"
      : "Model configuration is ready; provider default endpoint will be used"
    : "Model requires a provider and model id";

  return {
    healthy,
    status: healthy ? "ready" : "needs_attention",
    message,
    checkedAt: new Date().toISOString(),
    checks
  };
}
