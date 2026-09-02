import type {
  ModelProviderReadiness,
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
  capabilities: string;
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
  capabilities: "chat,code",
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

export function readinessCheckEntries(readiness: ModelProviderReadiness, t: Translate): Array<[string, string]> {
  return [
    [t("models.providerHealthCheckProvider"), readiness.checks.provider],
    [t("models.providerHealthCheckTarget"), readiness.checks.adapter],
    [t("models.providerHealthCheckModel"), readiness.checks.model],
    [t("models.providerHealthCheckCredential"), readiness.checks.credential],
    [t("models.providerHealthCheckRemoteModelList"), readiness.checks.remoteModelList],
  ];
}

export function isReadyCheckValue(value: string): boolean {
  return value === "ready" || value === "supported" || value === "selected" || value === "passed" || value === "not_required";
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
