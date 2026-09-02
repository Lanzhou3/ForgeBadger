import type {
  ModelProfile,
  ProviderCredentialSummary,
  ProviderProfile
} from "../db/repositories/model-provider-repository.js";
import type { FetchedProviderModel, FetchProviderModelsInput } from "./provider-model-fetch.js";

export type ProviderReadinessAdapter = "claude" | "opencode" | "codex" | "kimi";

export type ProviderReadinessCode =
  | "ready"
  | "provider_disabled"
  | "unsupported_target"
  | "missing_model"
  | "missing_active_credential"
  | "native_auth_not_ready"
  | "remote_validation_unavailable"
  | "remote_model_missing"
  | "remote_validation_failed";

export type ProviderReadinessStatus = "ready" | "needs_attention";

export type ProviderReadinessCheckStatus =
  | "ready"
  | "disabled"
  | "supported"
  | "unsupported"
  | "selected"
  | "missing"
  | "not_required"
  | "passed"
  | "missing_model"
  | "unavailable"
  | "failed"
  | "skipped";

export interface ModelProviderReadiness {
  status: ProviderReadinessStatus;
  code: ProviderReadinessCode;
  checkedAt: string;
  provider: {
    id: string;
    name: string;
    providerKey: string;
    apiFormat: string;
    authType: string;
  };
  selection: {
    adapter: ProviderReadinessAdapter;
    modelProfileId?: string;
    modelId?: string;
    credentialId?: string;
    authMode?: "managed_credential" | "native_cli_login" | "host_environment" | "none";
  };
  checks: {
    provider: ProviderReadinessCheckStatus;
    adapter: ProviderReadinessCheckStatus;
    model: ProviderReadinessCheckStatus;
    credential: ProviderReadinessCheckStatus;
    remoteModelList: ProviderReadinessCheckStatus;
  };
  remote?: {
    checked: boolean;
    modelCount?: number;
    matchedModelId?: string;
    errorCode?: ProviderRemoteErrorCode;
    error?: string;
  };
  nativeAuth?: {
    state: "ready" | "not_authenticated" | "cli_missing" | "unknown";
    method: "chatgpt" | "api" | "unknown";
  };
  steps: string[];
}

export type ProviderRemoteErrorCode =
  | "invalid_credential"
  | "timeout"
  | "provider_outage"
  | "endpoint_or_network_failure";

export interface ModelProviderReadinessInput {
  provider: ProviderProfile;
  model?: ModelProfile | undefined;
  credential?: ProviderCredentialSummary | undefined;
  adapter: ProviderReadinessAdapter;
  modelProfileId?: string | undefined;
  credentialId?: string | undefined;
  authMode?: "managed_credential" | "native_cli_login" | "host_environment" | "none" | undefined;
  nativeAuth?: ModelProviderReadiness["nativeAuth"] | undefined;
  includeRemoteCheck?: boolean | undefined;
  timeoutMs?: number | undefined;
  modelsUrl?: string | undefined;
  decryptCredential?: (() => string | undefined) | undefined;
  fetchProviderModels?: ((input: FetchProviderModelsInput) => Promise<FetchedProviderModel[]>) | undefined;
}

export async function buildModelProviderReadiness(input: ModelProviderReadinessInput): Promise<ModelProviderReadiness> {
  const base = baseReadiness(input);

  if (input.provider.status !== "active") {
    return withResult(base, "needs_attention", "provider_disabled", {
      providerCheck: "disabled",
      steps: ["Enable or recreate this provider profile before using it for sessions."]
    });
  }

  if (!supportsAdapter(input.provider, input.adapter)) {
    return withResult(base, "needs_attention", "unsupported_target", {
      adapterCheck: "unsupported",
      steps: ["Choose a supported apply target for this provider or add a provider profile that supports the desired AI CLI."]
    });
  }

  if (!input.model || input.model.status === "disabled") {
    return withResult(base, "needs_attention", "missing_model", {
      modelCheck: "missing",
      steps: ["Sync provider models or add a model profile for this provider."]
    });
  }

  if (input.authMode === "native_cli_login") {
    if (input.nativeAuth?.state !== "ready") {
      return withResult(base, "needs_attention", "native_auth_not_ready", {
        credentialCheck: "not_required",
        remoteModelListCheck: "skipped",
        steps: ["Complete Codex native login on this host before launching the binding."]
      });
    }
    return withResult(base, "ready", "ready", {
      credentialCheck: "not_required",
      remoteModelListCheck: "skipped",
      steps: []
    });
  }

  const credentialRequired = credentialRequiredFor(input);
  if (credentialRequired && (!input.credential || input.credential.status !== "active")) {
    return withResult(base, "needs_attention", "missing_active_credential", {
      credentialCheck: "missing",
      steps: ["Save or select an active credential for this provider before validating or applying it."]
    });
  }

  if (!input.includeRemoteCheck) {
    return withResult(base, "ready", "ready", {
      remoteModelListCheck: "skipped",
      steps: []
    });
  }

  if (!input.fetchProviderModels || !remoteModelListBaseUrl(input.provider)) {
    return withResult(base, "needs_attention", "remote_validation_unavailable", {
      remoteModelListCheck: "unavailable",
      remote: { checked: false },
      steps: ["Remote model-list validation is not available for this provider; check the provider endpoint or run without remote validation."]
    });
  }

  try {
    const apiKey = credentialRequired ? input.decryptCredential?.() : undefined;
    const fetchedModels = await input.fetchProviderModels({
      baseUrl: remoteModelListBaseUrl(input.provider) as string,
      apiKey,
      allowPlaintextHttp: input.provider.allowPlaintextHttp,
      ...(input.modelsUrl ? { modelsUrl: input.modelsUrl } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {})
    });
    const matchedModel = fetchedModels.find((fetched) => fetched.id === input.model?.modelId);
    if (!matchedModel) {
      return withResult(base, "needs_attention", "remote_model_missing", {
        remoteModelListCheck: "missing_model",
        remote: { checked: true, modelCount: fetchedModels.length },
        steps: [`The provider model list did not include ${input.model.modelId}. Sync models or choose a model ID returned by the provider.`]
      });
    }

    return withResult(base, "ready", "ready", {
      remoteModelListCheck: "passed",
      remote: { checked: true, modelCount: fetchedModels.length, matchedModelId: matchedModel.id },
      steps: []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote provider validation failed";
    return withResult(base, "needs_attention", "remote_validation_failed", {
      remoteModelListCheck: "failed",
      remote: {
        checked: true,
        errorCode: classifyRemoteError(message),
        error: safeRemoteError(message)
      },
      steps: [stepForRemoteError(message)]
    });
  }
}

function baseReadiness(input: ModelProviderReadinessInput): ModelProviderReadiness {
  return {
    status: "needs_attention",
    code: "missing_model",
    checkedAt: new Date().toISOString(),
    provider: {
      id: input.provider.id,
      name: input.provider.name,
      providerKey: input.provider.providerKey,
      apiFormat: input.provider.apiFormat,
      authType: input.provider.authType
    },
    selection: {
      adapter: input.adapter,
      ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {}),
      ...(input.model?.modelId ? { modelId: input.model.modelId } : {}),
      ...(input.credentialId ? { credentialId: input.credentialId } : {}),
      ...(input.authMode ? { authMode: input.authMode } : {})
    },
    checks: {
      provider: input.provider.status === "active" ? "ready" : "disabled",
      adapter: supportsAdapter(input.provider, input.adapter) ? "supported" : "unsupported",
      model: input.model && input.model.status !== "disabled" ? "selected" : "missing",
      credential: !credentialRequiredFor(input)
        ? "not_required"
        : input.credential?.status === "active"
          ? "ready"
          : "missing",
      remoteModelList: "skipped"
    },
    ...(input.nativeAuth ? { nativeAuth: input.nativeAuth } : {}),
    steps: []
  };
}

function withResult(
  readiness: ModelProviderReadiness,
  status: ProviderReadinessStatus,
  code: ProviderReadinessCode,
  patch: {
    providerCheck?: ProviderReadinessCheckStatus;
    adapterCheck?: ProviderReadinessCheckStatus;
    modelCheck?: ProviderReadinessCheckStatus;
    credentialCheck?: ProviderReadinessCheckStatus;
    remoteModelListCheck?: ProviderReadinessCheckStatus;
    remote?: ModelProviderReadiness["remote"];
    steps?: string[];
  }
): ModelProviderReadiness {
  return {
    ...readiness,
    status,
    code,
    checks: {
      ...readiness.checks,
      ...(patch.providerCheck ? { provider: patch.providerCheck } : {}),
      ...(patch.adapterCheck ? { adapter: patch.adapterCheck } : {}),
      ...(patch.modelCheck ? { model: patch.modelCheck } : {}),
      ...(patch.credentialCheck ? { credential: patch.credentialCheck } : {}),
      ...(patch.remoteModelListCheck ? { remoteModelList: patch.remoteModelListCheck } : {})
    },
    ...(patch.remote ? { remote: patch.remote } : {}),
    ...(readiness.nativeAuth ? { nativeAuth: readiness.nativeAuth } : {}),
    steps: patch.steps ?? readiness.steps
  };
}

function credentialRequiredFor(input: ModelProviderReadinessInput): boolean {
  if (input.authMode === "native_cli_login" || input.authMode === "host_environment" || input.authMode === "none") return false;
  if (input.authMode === "managed_credential") return true;
  return input.provider.authType !== "none";
}

function supportsAdapter(provider: ProviderProfile, adapter: ProviderReadinessAdapter): boolean {
  return provider.supportedAdapters.includes(adapter);
}

function remoteModelListBaseUrl(provider: ProviderProfile): string | undefined {
  return provider.openaiBaseUrl ?? provider.baseUrl ?? undefined;
}

function classifyRemoteError(message: string): ProviderRemoteErrorCode {
  if (/timed out|timeout/iu.test(message)) return "timeout";
  if (/HTTP\s+(401|403)\b/iu.test(message)) return "invalid_credential";
  if (/HTTP\s+5\d\d\b/iu.test(message)) return "provider_outage";
  return "endpoint_or_network_failure";
}

function stepForRemoteError(message: string): string {
  const code = classifyRemoteError(message);
  if (code === "invalid_credential") return "Check that the selected credential is active and belongs to this provider.";
  if (code === "timeout") return "Retry with a longer timeout or check network connectivity to the provider endpoint.";
  if (code === "provider_outage") return "Retry later or check the provider status page.";
  return "Check the provider endpoint, network access, and model-list support.";
}

function safeRemoteError(message: string): string {
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gu, "[REDACTED]");
}
