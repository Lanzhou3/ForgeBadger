import { RefreshCw, ServerCog, ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ModelProviderReadiness, ProviderProfile } from "@/lib/api";

import { ApplyTab } from "./apply-tab";
import { CredentialTab } from "./credential-tab";
import { ModelsTab } from "./models-tab";
import {
  EmptyLine,
  applyTargetsForProvider,
  formatCheckedAt,
  isReadyCheckValue,
  productTypeLabel,
  readinessCheckEntries,
  type Translate,
} from "./shared";

type ModelsTabProps = Parameters<typeof ModelsTab>[0];
type CredentialTabProps = Parameters<typeof CredentialTab>[0];
type ApplyTabProps = Parameters<typeof ApplyTab>[0];

interface ProviderWorkspaceProps {
  provider: ProviderProfile;
  readiness: ModelProviderReadiness | null;
  isCheckingReadiness: boolean;
  isSyncing: boolean;
  syncDisabled: boolean;
  isDeletingProvider: boolean;
  onCheckReadiness: () => void;
  onSync: () => void;
  onDeleteProvider: () => void;
  modelsTab: Omit<ModelsTabProps, "t">;
  credentialTab: Omit<CredentialTabProps, "t">;
  applyTab: Omit<ApplyTabProps, "t">;
  t: Translate;
}

export function ProviderWorkspace({
  provider,
  readiness,
  isCheckingReadiness,
  isSyncing,
  syncDisabled,
  isDeletingProvider,
  onCheckReadiness,
  onSync,
  onDeleteProvider,
  modelsTab,
  credentialTab,
  applyTab,
  t,
}: ProviderWorkspaceProps) {
  return (
    <div className="min-w-0 space-y-6">
      <Card className="of-animate-in">
        <CardContent className="space-y-4 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <ServerCog className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{provider.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {provider.baseUrl ?? provider.providerKey}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isCheckingReadiness}
                onClick={onCheckReadiness}
              >
                <RefreshCw className={`size-4 ${isCheckingReadiness ? "animate-spin" : ""}`} />
                {t("models.checkReadiness")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={syncDisabled || isSyncing}
                title={t("models.syncProviderModelsDescription")}
                onClick={onSync}
              >
                <RefreshCw className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
                {t("models.syncProviderModels")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={isDeletingProvider}
                onClick={onDeleteProvider}
              >
                <Trash2 className="size-4" />
                {t("common.delete")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{provider.apiFormat}</Badge>
            <Badge variant="outline">{provider.region ?? "-"}</Badge>
            <Badge variant="secondary">{productTypeLabel(provider.productType, t)}</Badge>
            <Badge variant="outline">{provider.authType}</Badge>
            {applyTargetsForProvider(provider).map((adapter) =>
              adapter === "openforge-copilot" ? (
                <Badge key={adapter} variant="secondary">OpenForge Copilot</Badge>
              ) : (
                <CliBrandChip key={adapter} aiTool={adapter} />
              )
            )}
          </div>
        </CardContent>
      </Card>

      {(readiness != null || isCheckingReadiness) && (
        <ProviderHealthPanel readiness={readiness} t={t} />
      )}

      <Tabs defaultValue="models" className="of-animate-in" style={{ animationDelay: "40ms" }}>
        <TabsList>
          <TabsTrigger value="models">{t("models.modelsWorkspace")}</TabsTrigger>
          <TabsTrigger value="credentials">{t("models.credentials")}</TabsTrigger>
          <TabsTrigger value="apply">{t("models.applyWorkspace")}</TabsTrigger>
        </TabsList>
        <TabsContent value="models" className="pt-4">
          <ModelsTab {...modelsTab} t={t} />
        </TabsContent>
        <TabsContent value="credentials" className="pt-4">
          <CredentialTab {...credentialTab} t={t} />
        </TabsContent>
        <TabsContent value="apply" className="pt-4">
          <ApplyTab {...applyTab} t={t} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProviderHealthPanel({
  readiness,
  t,
}: {
  readiness: ModelProviderReadiness | null;
  t: Translate;
}) {
  return (
    <Card data-testid="provider-health-card" className="of-animate-in">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{t("models.providerHealth")}</CardTitle>
            <CardDescription className="mt-1">{t("models.providerHealthDescription")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!readiness ? (
          <EmptyLine text={t("models.providerHealthEmpty")} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={readiness.status === "ready" ? "default" : readiness.status === "managed_elsewhere" ? "secondary" : "outline"}>
                {readiness.status}
              </Badge>
              <Badge variant="outline">{readiness.code}</Badge>
              <span className="text-xs text-muted-foreground">{formatCheckedAt(readiness.checkedAt)}</span>
            </div>
            <div className="grid gap-2 text-sm">
              {readinessCheckEntries(readiness, t).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                  <span className="text-muted-foreground">{label}</span>
                  <Badge variant={isReadyCheckValue(value) ? "default" : "outline"}>{value}</Badge>
                </div>
              ))}
            </div>
            {readiness.remote && (
              <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <div>{t("models.providerHealthRemoteChecked")}: {String(readiness.remote.checked)}</div>
                {readiness.remote.modelCount !== undefined && <div>{t("models.providerHealthRemoteModelCount")}: {readiness.remote.modelCount}</div>}
                {readiness.remote.matchedModelId && <div>{t("models.providerHealthMatchedModel")}: {readiness.remote.matchedModelId}</div>}
                {readiness.remote.errorCode && <div>{t("models.providerHealthErrorCode")}: {readiness.remote.errorCode}</div>}
                {readiness.remote.error && <div>{t("models.providerHealthError")}: {readiness.remote.error}</div>}
              </div>
            )}
            {readiness.steps.length > 0 && (
              <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
                <div className="font-medium">{t("models.providerHealthNextSteps")}</div>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {readiness.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
