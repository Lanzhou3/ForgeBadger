import { ModelProviderRepository, type ModelProfile, type ProviderProfile } from "../../db/repositories/model-provider-repository.js";
import type { Database } from "../../db/types.js";
import type { CopilotProviderFormat, CopilotServiceError } from "./types.js";

export type CopilotClientKind = "openai-responses" | "anthropic-messages";

export interface CopilotProviderSelection {
  provider: ProviderProfile;
  model: ModelProfile;
  format: CopilotProviderFormat;
  clientKind: CopilotClientKind;
  apiKey: string | null;
}

export interface SelectCopilotProviderInput {
  db: Database;
  userId: string;
  masterKey: string;
  providerProfileId?: string;
  modelProfileId?: string;
  credentialId?: string;
  allowOpenAiCompatible?: boolean;
}

export type SelectCopilotProviderResult =
  | { ok: true; selection: CopilotProviderSelection }
  | { ok: false; error: CopilotServiceError };

export function selectCopilotProvider(input: SelectCopilotProviderInput): SelectCopilotProviderResult {
  const repo = new ModelProviderRepository(input.db, input.userId, input.masterKey);
  const selected = selectProviderAndModel(repo, input);
  if (!selected.ok) return selected;
  const clientKind = clientKindFor(selected.provider, input.allowOpenAiCompatible === true);
  if (!clientKind.ok) return clientKind;
  const credential = selectCredential(repo, selected.provider, input.credentialId);
  if (!credential.ok) return credential;
  return {
    ok: true,
    selection: {
      provider: selected.provider,
      model: selected.model,
      format: selected.provider.apiFormat as CopilotProviderFormat,
      clientKind: clientKind.kind,
      apiKey: credential.apiKey
    }
  };
}

type ProviderAndModelResult =
  | { ok: true; provider: ProviderProfile; model: ModelProfile }
  | { ok: false; error: CopilotServiceError };

function selectProviderAndModel(
  repo: ModelProviderRepository,
  input: SelectCopilotProviderInput
): ProviderAndModelResult {
  if (input.modelProfileId) return selectExplicitModel(repo, input);
  if (input.providerProfileId) return selectFirstProviderModel(repo, input.providerProfileId);
  return selectDefaultCompatibleModel(repo);
}

function selectExplicitModel(
  repo: ModelProviderRepository,
  input: SelectCopilotProviderInput
): ProviderAndModelResult {
  const model = repo.getModelProfile(input.modelProfileId as string);
  if (!model) return notConfigured("Copilot model profile is not configured");
  const provider = repo.getProviderProfile(model.providerProfileId);
  if (!provider) return notConfigured("Copilot provider profile is not configured");
  if (input.providerProfileId && provider.id !== input.providerProfileId) {
    return unsupported("Selected model does not belong to the selected provider");
  }
  return { ok: true, provider, model };
}

function selectFirstProviderModel(
  repo: ModelProviderRepository,
  providerProfileId: string
): ProviderAndModelResult {
  const provider = repo.getProviderProfile(providerProfileId);
  if (!provider) return notConfigured("Copilot provider profile is not configured");
  const model = repo.listModelProfiles(provider.id).find((item) => item.status === "active");
  if (!model) return notConfigured("Copilot model profile is not configured");
  return { ok: true, provider, model };
}

function selectDefaultCompatibleModel(repo: ModelProviderRepository): ProviderAndModelResult {
  for (const model of repo.listModelProfiles()) {
    const provider = repo.getProviderProfile(model.providerProfileId);
    if (provider && model.status === "active" && isCopilotProviderFormat(provider.apiFormat)) {
      return { ok: true, provider, model };
    }
  }
  return notConfigured("No compatible Copilot provider is configured");
}

type ClientKindResult =
  | { ok: true; kind: CopilotClientKind }
  | { ok: false; error: CopilotServiceError };

function clientKindFor(provider: ProviderProfile, allowOpenAiCompatible: boolean): ClientKindResult {
  if (provider.apiFormat === "openai") return { ok: true, kind: "openai-responses" };
  if (provider.apiFormat === "anthropic") return { ok: true, kind: "anthropic-messages" };
  if (provider.apiFormat === "openai-compatible" && allowOpenAiCompatible) {
    return { ok: true, kind: "openai-responses" };
  }
  return unsupported("Provider format is not supported for Copilot");
}

type CredentialResult =
  | { ok: true; apiKey: string | null }
  | { ok: false; error: CopilotServiceError };

function selectCredential(
  repo: ModelProviderRepository,
  provider: ProviderProfile,
  credentialId: string | undefined
): CredentialResult {
  if (provider.authType === "none") return { ok: true, apiKey: null };
  const credential = credentialId
    ? repo.getCredential(credentialId)
    : repo.listCredentials(provider.id).find((item) => item.status === "active");
  if (!credential || credential.providerProfileId !== provider.id) {
    return notConfigured("Copilot provider credential is not configured");
  }
  return { ok: true, apiKey: repo.decryptCredential(credential.id) };
}

function isCopilotProviderFormat(value: string): value is CopilotProviderFormat {
  return value === "openai" || value === "openai-compatible" || value === "anthropic";
}

function notConfigured(message: string): { ok: false; error: CopilotServiceError } {
  return { ok: false, error: { code: "copilot_provider_not_configured", message } };
}

function unsupported(message: string): { ok: false; error: CopilotServiceError } {
  return { ok: false, error: { code: "copilot_provider_unsupported", message } };
}
