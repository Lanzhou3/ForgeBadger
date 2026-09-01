import type { ProviderAdapter, ProviderApiFormat } from "../db/repositories/model-provider-repository.js";

export type ProviderConfigAuthMode = "managed_credential" | "native_cli_login" | "host_environment" | "none";
export type ProviderConfigScope = "global" | "project";

export interface ProviderAdapterCapability {
  adapter: ProviderAdapter;
  apiFormats: ProviderApiFormat[];
  authModes: ProviderConfigAuthMode[];
  scopes: ProviderConfigScope[];
  projectionScope: "project-or-user-global" | "user-global";
  modelSelection: "environment" | "argument" | "native-config";
  remoteModelList: boolean;
}

const capabilities: readonly ProviderAdapterCapability[] = Object.freeze([
  {
    adapter: "claude", apiFormats: ["anthropic", "openai-compatible"],
    authModes: ["managed_credential", "host_environment", "none"], scopes: ["global", "project"],
    projectionScope: "project-or-user-global", modelSelection: "environment", remoteModelList: true
  },
  {
    adapter: "opencode", apiFormats: ["anthropic", "openai", "openai-compatible", "google", "bedrock", "local"],
    authModes: ["managed_credential", "host_environment", "none"], scopes: ["global", "project"],
    projectionScope: "project-or-user-global", modelSelection: "argument", remoteModelList: true
  },
  {
    adapter: "codex", apiFormats: ["openai", "openai-compatible"],
    authModes: ["native_cli_login", "managed_credential"], scopes: ["global"],
    projectionScope: "user-global", modelSelection: "argument", remoteModelList: true
  },
  {
    adapter: "kimi", apiFormats: ["openai", "openai-compatible"],
    authModes: ["managed_credential", "host_environment", "none"], scopes: ["global", "project"],
    projectionScope: "project-or-user-global", modelSelection: "native-config", remoteModelList: false
  }
]);

export function getProviderCapabilities(): ProviderAdapterCapability[] {
  return capabilities.map((entry) => ({
    ...entry,
    apiFormats: [...entry.apiFormats],
    authModes: [...entry.authModes],
    scopes: [...entry.scopes]
  }));
}
