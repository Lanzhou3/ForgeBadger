import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  ModelProviderReadiness,
  ProviderApplyAdapter,
  ProviderApplyPreview,
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

export interface NamedReference {
  id: string;
  name: string;
  status: string;
}

export interface ModelReferenceInfo {
  sessions: NamedReference[];
}

export type DeleteTarget =
  | { kind: "provider"; providerId: string }
  | { kind: "model"; modelId: string }
  | { kind: "credential"; credentialId: string };

export type Translate = (key: any) => string;

export const emptyModelReferences: ModelReferenceInfo = { sessions: [] };

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

export function adapterLabel(adapter: ProviderSupportedAdapter | ProviderApplyAdapter): string {
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

export function applyTargetsForProvider(provider: ProviderProfile | undefined): ProviderApplyAdapter[] {
  if (!provider) return [];
  return [...provider.supportedAdapters];
}

export function buildApplyPayload(
  adapter: ProviderApplyAdapter,
  scope: "project" | "user-global",
  projectRoot: string,
  modelProfileId: string,
  credentialId: string
): { adapter: ProviderApplyAdapter; scope?: "project" | "user-global"; projectRoot?: string; modelProfileId?: string; credentialId?: string } {
  const root = projectRoot.trim();
  return {
    adapter,
    scope,
    ...(scope === "project" && root ? { projectRoot: root } : {}),
    ...(modelProfileId ? { modelProfileId } : {}),
    ...(credentialId ? { credentialId } : {}),
  };
}

export function getApplyBlockedReason({
  provider,
  supportedAdapters,
  selectedAdapter,
  selectedModelId,
  projectRoot,
  scope,
  needsPreview,
  preview,
  t,
}: {
  provider: ProviderProfile | undefined;
  supportedAdapters: ProviderApplyAdapter[];
  selectedAdapter: ProviderApplyAdapter;
  selectedModelId: string;
  projectRoot: string;
  scope: "project" | "user-global";
  needsPreview: boolean;
  preview: ProviderApplyPreview | null;
  t: Translate;
}): string | null {
  if (!provider) return t("models.providerRequired");
  if (!supportedAdapters.includes(selectedAdapter)) return t("models.applyTargetUnsupported");
  if (!selectedModelId) return t("models.applyModelRequired");
  if (scope === "project" && !projectRoot.trim()) return t("models.projectPathRequired");
  if (needsPreview && !preview) return t("models.previewRequiredBeforeApply");
  return null;
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

export function ReferenceRow({
  name,
  status,
  kindLabel,
  href,
  linkLabel,
}: {
  name: string;
  status: string;
  kindLabel: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="secondary" className="shrink-0">{kindLabel}</Badge>
        <span className="truncate font-medium">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{status}</span>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex shrink-0 items-center gap-1 text-xs text-brand hover:underline"
      >
        {linkLabel}
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}
