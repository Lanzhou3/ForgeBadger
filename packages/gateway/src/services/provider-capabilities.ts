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
    adapter: "claude", apiFormats: ["anthropic", "openai-responses", "openai-compatible"],
    authModes: ["managed_credential", "host_environment", "none"], scopes: ["global", "project"],
    projectionScope: "project-or-user-global", modelSelection: "environment", remoteModelList: true
  },
  {
    adapter: "opencode", apiFormats: ["anthropic", "openai-responses", "openai-compatible", "google"],
    authModes: ["managed_credential", "host_environment", "none"], scopes: ["global", "project"],
    projectionScope: "project-or-user-global", modelSelection: "argument", remoteModelList: true
  },
  {
    adapter: "codex", apiFormats: ["openai-responses", "openai-compatible"],
    authModes: ["native_cli_login", "managed_credential"], scopes: ["global"],
    projectionScope: "user-global", modelSelection: "argument", remoteModelList: true
  },
  {
    adapter: "kimi", apiFormats: ["openai-responses", "openai-compatible"],
    authModes: ["managed_credential", "host_environment", "none"], scopes: ["global", "project"],
    projectionScope: "project-or-user-global", modelSelection: "native-config", remoteModelList: false
  },
  {
    adapter: "pi", apiFormats: ["anthropic", "openai-responses", "openai-compatible", "google"],
    authModes: ["managed_credential", "host_environment", "none"], scopes: ["global"],
    projectionScope: "user-global", modelSelection: "native-config", remoteModelList: false
  },
  {
    // MiniMax Code's `api` field accepts only three shapes (verified
    // against @minimax-ai/code 0.4.12): anthropic-messages, openai-responses,
    // openai-completions. Google has no counterpart. The CLI also
    // needs an explicit baseURL for a custom provider, which is enforced at
    // apply time. No project-level config.yaml exists — .mcode/ holds commands
    // and agents only.
    adapter: "mcode", apiFormats: ["anthropic", "openai-responses", "openai-compatible"],
    authModes: ["managed_credential", "host_environment", "none"], scopes: ["global"],
    projectionScope: "user-global", modelSelection: "native-config", remoteModelList: false
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
