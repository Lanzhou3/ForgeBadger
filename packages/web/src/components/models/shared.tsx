import type {
  ModelProviderReadiness,
  ProviderProfile,
  ProviderSupportedAdapter,
} from "@/lib/api";

export interface CustomProviderForm {
  name: string;
  providerKey: string;
  baseUrl: string;
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
  baseUrl: "",
};

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
