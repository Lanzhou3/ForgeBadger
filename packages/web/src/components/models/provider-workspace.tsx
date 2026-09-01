import { RefreshCw, ServerCog, ShieldCheck, Trash2, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ModelProviderReadiness,
  ProviderBalanceEntry,
  ProviderBalanceResult,
  ProviderProfile,
} from "@/lib/api";

import { CredentialTab } from "./credential-tab";
import { ModelsTab } from "./models-tab";
import {
  EmptyLine,
  applyTargetsForProvider,
  balanceEntryUsedPercent,
  formatCheckedAt,
  isReadyCheckValue,
  productTypeLabel,
  readinessCheckEntries,
  type Translate,
} from "./shared";

type ModelsTabProps = Parameters<typeof ModelsTab>[0];
type CredentialTabProps = Parameters<typeof CredentialTab>[0];

interface ProviderWorkspaceProps {
  provider: ProviderProfile;
  readiness: ModelProviderReadiness | null;
  isCheckingReadiness: boolean;
  isSyncing: boolean;
  syncDisabled: boolean;
  balance: ProviderBalanceResult | null;
  balanceError: string | null;
  isCheckingBalance: boolean;
  isDeletingProvider: boolean;
  onCheckReadiness: () => void;
  onSync: () => void;
  onCheckBalance: () => void;
  onDeleteProvider: () => void;
  onApplyToCli: () => void;
  modelsTab: Omit<ModelsTabProps, "t">;
  credentialTab: Omit<CredentialTabProps, "t">;
  t: Translate;
}

export function ProviderWorkspace({
  provider,
  readiness,
  isCheckingReadiness,
  isSyncing,
  syncDisabled,
  balance,
  balanceError,
  isCheckingBalance,
  isDeletingProvider,
  onCheckReadiness,
  onSync,
  onCheckBalance,
  onDeleteProvider,
  onApplyToCli,
  modelsTab,
  credentialTab,
  t,
}: ProviderWorkspaceProps) {
  return (
    <div className="min-w-0 space-y-6">
      <Card className="forgebadger-animate-in">
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
                onClick={onApplyToCli}
              >
                <ShieldCheck className="size-4" />
                {t("models.applyToCli")}
              </Button>
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
                variant="outline"
                disabled={isCheckingBalance}
                onClick={onCheckBalance}
              >
                <Wallet className="size-4" />
                {t("models.checkBalance")}
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
            {applyTargetsForProvider(provider).map((adapter) => (
              <CliBrandChip key={adapter} aiTool={adapter} />
            ))}
          </div>
          {(balance || balanceError) && (
            <div className="space-y-2" data-testid="provider-balance-row">
              {balanceError ? (
                <span className="text-xs text-destructive">{balanceError}</span>
              ) : balance && !balance.supported ? (
                <span className="text-xs text-muted-foreground">{t("models.balanceNotSupported")}</span>
              ) : balance && balance.balances.length === 0 ? (
                <span className="text-xs text-muted-foreground">{t("models.balanceEmpty")}</span>
              ) : (
                balance?.balances.map((entry) => (
                  <BalanceMeter key={`${entry.label}-${entry.resetsAt ?? ""}`} entry={entry} t={t} />
                ))
              )}
              {balance?.supported && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {isCheckingBalance && <RefreshCw className="size-3 animate-spin" />}
                  <span>{formatCheckedAt(balance.checkedAt)}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {(readiness != null || isCheckingReadiness) && (
        <ProviderHealthPanel readiness={readiness} t={t} />
      )}

      <Tabs defaultValue="models" className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
        <TabsList>
          <TabsTrigger value="models">{t("models.modelsWorkspace")}</TabsTrigger>
          <TabsTrigger value="credentials">{t("models.credentials")}</TabsTrigger>
        </TabsList>
        <TabsContent value="models" className="pt-4">
          <ModelsTab {...modelsTab} t={t} />
        </TabsContent>
        <TabsContent value="credentials" className="pt-4">
          <CredentialTab {...credentialTab} t={t} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BalanceMeter({ entry, t }: { entry: ProviderBalanceEntry; t: Translate }) {
  const usedPercent = balanceEntryUsedPercent(entry);
  const unavailable = entry.isAvailable === false;
  const valueText =
    usedPercent !== undefined ? `${Math.round(usedPercent)}%` : `${entry.remaining} ${entry.unit}`;
  const barColor =
    usedPercent === undefined
      ? ""
      : usedPercent >= 80
        ? "bg-red-500"
        : usedPercent >= 50
          ? "bg-amber-500"
          : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={unavailable ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
          {entry.label}
          {unavailable ? ` · ${t("models.balanceUnavailable")}` : ""}
          {entry.resetsAt ? ` · ${t("models.balanceResetsAt")}: ${formatCheckedAt(entry.resetsAt)}` : ""}
        </span>
        <span className={`font-medium ${unavailable ? "text-amber-700 dark:text-amber-300" : ""}`}>
          {valueText}
        </span>
      </div>
      {usedPercent !== undefined && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${barColor}`}
            style={{ width: `${usedPercent}%` }}
          />
        </div>
      )}
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
    <Card data-testid="provider-health-card" className="forgebadger-animate-in">
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
