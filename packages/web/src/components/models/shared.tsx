import type {
  AdapterAppliedStatus,
  ProviderApiFormat,
  ProviderAuthType,
  ProviderBalanceEntry,
  ProviderProfile,
  ProviderSupportedAdapter,
} from "@/lib/api";

export interface CustomProviderForm {
  name: string;
  providerKey: string;
  apiFormat: ProviderApiFormat;
  authType: ProviderAuthType;
  anthropicBaseUrl: string;
  openaiBaseUrl: string;
  supportedAdapters: ProviderSupportedAdapter[];
  allowPlaintextHttp: boolean;
}

export interface CredentialForm {
  label: string;
  plaintextSecret: string;
}

export interface ModelForm {
  name: string;
  modelId: string;
  /** Checked common capability tags. */
  capabilities: string[];
  /** Free-form supplement for capabilities outside the common set. */
  customCapabilities: string;
  contextWindow: string;
}

export type DeleteTarget =
  | { kind: "provider"; providerId: string }
  | { kind: "model"; modelId: string }
  | { kind: "credential"; credentialId: string };

export type Translate = (key: any) => string;

export const emptyCustomProvider: CustomProviderForm = {
  name: "",
  providerKey: "",
  apiFormat: "anthropic",
  authType: "api_key",
  anthropicBaseUrl: "",
  openaiBaseUrl: "",
  supportedAdapters: ["claude"],
  allowPlaintextHttp: false,
};

export function slugifyProviderKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function customProviderHasEndpoint(form: CustomProviderForm): boolean {
  return Boolean(form.anthropicBaseUrl.trim() || form.openaiBaseUrl.trim());
}

export function customProviderHasPlaintextHttp(form: CustomProviderForm): boolean {
  const urls = [form.anthropicBaseUrl.trim(), form.openaiBaseUrl.trim()].filter(Boolean);
  return urls.some((url) => url.toLowerCase().startsWith("http://"));
}

export const emptyCredential: CredentialForm = {
  label: "",
  plaintextSecret: "",
};

export const emptyModel: ModelForm = {
  name: "",
  modelId: "",
  capabilities: ["chat", "code"],
  customCapabilities: "",
  contextWindow: "",
};

export function adapterLabel(adapter: ProviderSupportedAdapter): string {
  if (adapter === "claude") return "Claude Code";
  if (adapter === "opencode") return "OpenCode";
  if (adapter === "codex") return "Codex";
  if (adapter === "kimi") return "Kimi Code";
  return adapter;
}

export function productTypeLabel(productType: string | null | undefined, t: Translate): string {
  if (productType === "coding_plan") return t("models.productTypeCodingPlan");
  if (productType === "token_plan") return t("models.productTypeTokenPlan");
  if (productType === "subscription") return t("models.productTypeSubscription");
  if (productType === "local") return t("models.productTypeLocal");
  return t("models.productTypePaygApi");
}

export function formatCheckedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Derive the 0-100 *used* percentage for a balance entry. Percent-denominated
 * entries (e.g. MiniMax quota windows report remaining %) are inverted;
 * bounded quota windows (e.g. Kimi request limits) use 1 - remaining/limit.
 * Plain currency balances have no bound and return undefined (no progress bar).
 */
export function balanceEntryUsedPercent(
  entry: Pick<ProviderBalanceEntry, "remaining" | "unit" | "limit">
): number | undefined {
  if (entry.unit === "%") return clampPercent(100 - entry.remaining);
  if (entry.limit !== undefined && entry.limit > 0) {
    return clampPercent((1 - entry.remaining / entry.limit) * 100);
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function applyTargetsForProvider(provider: ProviderProfile | undefined): ProviderSupportedAdapter[] {
  if (!provider) return [];
  return [...provider.supportedAdapters];
}

/** Human-readable API protocol label; never expose the raw enum to users. */
export function apiFormatLabel(format: ProviderApiFormat, t: Translate): string {
  switch (format) {
    case "anthropic": return t("models.apiFormatAnthropic");
    case "openai": return t("models.apiFormatOpenai");
    case "openai-compatible": return t("models.apiFormatOpenaiCompatible");
    case "google": return t("models.apiFormatGoogle");
    case "bedrock": return t("models.apiFormatBedrock");
    case "local": return t("models.apiFormatLocal");
    default: return format;
  }
}

/** Short hint shown next to the API format option in the provider form. */
export function apiFormatHint(format: ProviderApiFormat, t: Translate): string {
  switch (format) {
    case "anthropic": return t("models.apiFormatHintAnthropic");
    case "openai": return t("models.apiFormatHintOpenai");
    case "openai-compatible": return t("models.apiFormatHintOpenaiCompatible");
    case "google": return t("models.apiFormatHintGoogle");
    case "bedrock": return t("models.apiFormatHintBedrock");
    case "local": return t("models.apiFormatHintLocal");
    default: return "";
  }
}

/** Human-readable credential auth label; never expose the raw enum to users. */
export function authTypeLabel(authType: ProviderAuthType, t: Translate): string {
  switch (authType) {
    case "api_key": return t("models.authTypeApiKey");
    case "bearer_token": return t("models.authTypeBearerToken");
    case "oauth": return t("models.authTypeOauth");
    case "none": return t("models.authTypeNone");
    default: return authType;
  }
}

/** Short hint shown next to the auth type option in the provider form. */
export function authTypeHint(authType: ProviderAuthType, t: Translate): string {
  switch (authType) {
    case "api_key": return t("models.authTypeHintApiKey");
    case "bearer_token": return t("models.authTypeHintBearerToken");
    case "oauth": return t("models.authTypeHintOauth");
    case "none": return t("models.authTypeHintNone");
    default: return "";
  }
}

/** Common capability tags offered as one-tap checkboxes in the model form. */
export const COMMON_MODEL_CAPABILITIES = ["chat", "code", "vision", "tools", "reasoning", "embedding"] as const;

export function parseCapabilities(input: string): string[] {
  const seen = new Set<string>();
  for (const item of input.split(",")) {
    const capability = item.trim();
    if (capability) seen.add(capability);
  }
  return [...seen];
}

/**
 * Merge the checked common capabilities with a free-form supplement input into
 * a de-duplicated, order-stable list (common tags first, extras appended).
 */
export function mergeCapabilities(checked: readonly string[], customInput: string): string[] {
  const merged: string[] = [];
  for (const capability of [...checked, ...parseCapabilities(customInput)]) {
    if (capability && !merged.includes(capability)) merged.push(capability);
  }
  return merged;
}

/** Split stored capabilities into common checkbox values + custom remainder. */
export function splitCapabilities(capabilities: readonly string[]): { checked: string[]; custom: string } {
  const common = new Set<string>(COMMON_MODEL_CAPABILITIES);
  const checked: string[] = [];
  const custom: string[] = [];
  for (const capability of capabilities) {
    if (common.has(capability)) checked.push(capability);
    else custom.push(capability);
  }
  return { checked, custom: custom.join(",") };
}

export function appliedStatusForAdapter(
  statuses: readonly AdapterAppliedStatus[] | undefined,
  adapter: ProviderSupportedAdapter
): AdapterAppliedStatus | null {
  return statuses?.find((status) => status.adapter === adapter) ?? null;
}

/** True when the given provider is the one currently applied to this CLI. */
export function isProviderActiveOnAdapter(
  status: AdapterAppliedStatus | null | undefined,
  providerId: string
): boolean {
  return Boolean(status?.applied && status.applied.providerProfileId === providerId);
}

export function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

export function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
    </div>
  );
}
