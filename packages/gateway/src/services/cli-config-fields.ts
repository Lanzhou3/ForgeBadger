import type { AdapterId } from "./adapter-discovery.js";

export type CliConfigFieldType = "string" | "enum" | "secret" | "number" | "boolean";

export interface CliConfigFieldSpec {
  key: string;
  path: string;
  label: string;
  type: CliConfigFieldType;
  values?: string[];
  description?: string;
}

const claudeFields: CliConfigFieldSpec[] = [
  {
    key: "anthropicBaseUrl",
    path: "env.ANTHROPIC_BASE_URL",
    label: "Anthropic base URL",
    type: "string"
  },
  {
    key: "anthropicModel",
    path: "env.ANTHROPIC_MODEL",
    label: "Anthropic model",
    type: "string"
  },
  {
    key: "anthropicAuthToken",
    path: "env.ANTHROPIC_AUTH_TOKEN",
    label: "Anthropic auth token",
    type: "secret"
  },
  {
    key: "apiTimeoutMs",
    path: "env.API_TIMEOUT_MS",
    label: "API timeout (ms)",
    type: "number"
  },
  {
    key: "permissionsDefaultMode",
    path: "permissions.defaultMode",
    label: "Permissions default mode",
    type: "enum",
    values: ["default", "acceptEdits", "plan", "bypassPermissions"]
  }
];

// OpenCode's opencode.json is a provider/model registry (provider.<id>.models.*),
// not a flat scalar config; top-level keys like model/theme/autoupdate are rarely
// set by users (the active model lives in the session/model picker). Curated scalar
// fields would render as misleading empties, so the fields card is omitted and the
// provider + model views cover the real content.
const opencodeFields: CliConfigFieldSpec[] = [];

const codexFields: CliConfigFieldSpec[] = [
  { key: "model", path: "model", label: "Active model", type: "string" },
  { key: "modelProvider", path: "model_provider", label: "Model provider", type: "string" },
  {
    key: "approvalPolicy",
    path: "approval_policy",
    label: "Approval policy",
    type: "enum",
    values: ["untrusted", "on-failure", "on-request", "never"]
  },
  {
    key: "sandboxMode",
    path: "sandbox_mode",
    label: "Sandbox mode",
    type: "enum",
    values: ["read-only", "workspace-write", "danger-full-access"]
  }
];

const kimiFields: CliConfigFieldSpec[] = [
  { key: "defaultModel", path: "default_model", label: "Default model", type: "string" }
];

export const cliConfigFieldCatalog: Record<AdapterId, CliConfigFieldSpec[]> = {
  claude: claudeFields,
  opencode: opencodeFields,
  codex: codexFields,
  kimi: kimiFields
};

const maxFieldValueChars = 512;

export function listCliConfigFields(adapter: AdapterId): CliConfigFieldSpec[] {
  return cliConfigFieldCatalog[adapter];
}

export function findCliConfigField(adapter: AdapterId, key: string): CliConfigFieldSpec | undefined {
  return cliConfigFieldCatalog[adapter].find((field) => field.key === key);
}

export function validateCliConfigFieldValue(
  spec: CliConfigFieldSpec,
  value: unknown
): string | undefined {
  if (value === null) return undefined;
  if (spec.type === "boolean") {
    return typeof value === "boolean" ? undefined : `${spec.key} must be a boolean`;
  }
  if (spec.type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? undefined
      : `${spec.key} must be a number`;
  }
  if (typeof value !== "string") return `${spec.key} must be a string`;
  if (value.length > maxFieldValueChars) {
    return `${spec.key} exceeds ${maxFieldValueChars} characters`;
  }
  if (spec.type === "enum") {
    return spec.values?.includes(value)
      ? undefined
      : `${spec.key} must be one of: ${(spec.values ?? []).join(", ")}`;
  }
  return undefined;
}
