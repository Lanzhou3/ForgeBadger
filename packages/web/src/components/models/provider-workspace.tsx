"use client";

import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, RefreshCw, ServerCog, ShieldCheck, Trash2, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ProviderBalanceEntry,
  ProviderBalanceResult,
  ProviderProfile,
  RuntimeAdapterId,
} from "@/lib/api";
import { getClaudeRoute } from "@/lib/api";

import { CliStatusSection } from "./cli-status-section";
import { CredentialTab } from "./credential-tab";
import { DiagnosticsTab } from "./diagnostics-tab";
import { ModelsTab } from "./models-tab";
import {
  apiFormatLabel,
  applyTargetsForProvider,
  authTypeLabel,
  balanceEntryUsedPercent,
  formatCheckedAt,
  productTypeLabel,
  type Translate,
} from "./shared";

type ModelsTabProps = Parameters<typeof ModelsTab>[0];
type CredentialTabProps = Parameters<typeof CredentialTab>[0];

interface ProviderWorkspaceProps {
  provider: ProviderProfile;
  isSyncing: boolean;
  syncDisabled: boolean;
  balance: ProviderBalanceResult | null;
  balanceError: string | null;
  isCheckingBalance: boolean;
  isDeletingProvider: boolean;
  onEditProvider: () => void;
  onSync: () => void;
  onCheckBalance: () => void;
  onDeleteProvider: () => void;
  onApplyToCli: (adapter?: RuntimeAdapterId) => void;
  onViewCliConfig: (adapter: RuntimeAdapterId) => void;
  modelsTab: Omit<ModelsTabProps, "t" | "isSyncing" | "syncDisabled" | "onSync">;
  credentialTab: Omit<CredentialTabProps, "t">;
  t: Translate;
}

export function ProviderWorkspace({
  provider,
  isSyncing,
  syncDisabled,
  balance,
  balanceError,
  isCheckingBalance,
  isDeletingProvider,
  onEditProvider,
  onSync,
  onCheckBalance,
  onDeleteProvider,
  onApplyToCli,
  onViewCliConfig,
  modelsTab,
  credentialTab,
  t,
}: ProviderWorkspaceProps) {
  const { data: routeState } = useQuery({
    queryKey: ["claude-route"],
    queryFn: getClaudeRoute,
    retry: false,
    staleTime: 60_000,
  });
  const routedToClaude =
    routeState?.enabled === true &&
    provider.supportedAdapters.includes("claude") &&
    routeState.assignment?.providerProfileId === provider.id;
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
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={() => onApplyToCli()}
              >
                <ShieldCheck className="size-4" />
                {t("models.applyToCli")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-9"
                    aria-label={t("common.actions")}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onEditProvider}>
                    <Pencil className="size-4" />
                    {t("models.editProvider")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isCheckingBalance} onSelect={onCheckBalance}>
                    <Wallet className="size-4" />
                    {t("models.checkBalance")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    disabled={isDeletingProvider}
                    onSelect={onDeleteProvider}
                  >
                    <Trash2 className="size-4" />
                    {t("models.deleteProviderTitle")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{apiFormatLabel(provider.apiFormat, t)}</Badge>
            {routedToClaude && <Badge variant="secondary">{t("models.claudeRouteBadge")}</Badge>}
            {provider.region ? <Badge variant="outline">{provider.region}</Badge> : null}
            <Badge variant="secondary">{productTypeLabel(provider.productType, t)}</Badge>
            <Badge variant="outline">{authTypeLabel(provider.authType, t)}</Badge>
            {applyTargetsForProvider(provider).map((adapter) => (
              <CliBrandChip key={adapter} aiTool={adapter} />
            ))}
          </div>
          <div className="min-h-10 space-y-2" data-testid="provider-balance-row">
            {balanceError ? (
              <span className="text-xs text-destructive">{balanceError}</span>
            ) : balance && !balance.supported ? (
              <span className="text-xs text-muted-foreground">{t("models.balanceNotSupported")}</span>
            ) : !balance && isCheckingBalance ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="size-3 animate-spin" />
                {t("models.balanceLoading")}
              </span>
            ) : !balance ? (
              <span className="text-xs text-muted-foreground">{t("models.balanceNotQueried")}</span>
            ) : balance.balances.length === 0 ? (
              <span className="text-xs text-muted-foreground">{t("models.balanceEmpty")}</span>
            ) : (
              balance.balances.map((entry) => (
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
        </CardContent>
      </Card>

      <CliStatusSection
        provider={provider}
        onApply={(adapter) => onApplyToCli(adapter)}
        onViewConfig={onViewCliConfig}
      />

      <Tabs defaultValue="models" className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
        <TabsList>
          <TabsTrigger value="models">{t("models.modelsWorkspace")}</TabsTrigger>
          <TabsTrigger value="credentials">{t("models.credentials")}</TabsTrigger>
          <TabsTrigger value="diagnostics">{t("models.diagnosticsTab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="models" className="pt-4">
          <ModelsTab
            {...modelsTab}
            isSyncing={isSyncing}
            syncDisabled={syncDisabled}
            onSync={onSync}
            t={t}
          />
        </TabsContent>
        <TabsContent value="credentials" className="pt-4">
          <CredentialTab {...credentialTab} t={t} />
        </TabsContent>
        <TabsContent value="diagnostics" className="pt-4" forceMount>
          <DiagnosticsTab provider={provider} t={t} />
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
