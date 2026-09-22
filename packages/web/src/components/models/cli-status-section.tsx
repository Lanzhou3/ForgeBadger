"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

import { ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
import { CliBrandIcon } from "@/components/cli-brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import {
  discoverAdapters,
  getCliAccounts,
  getAppliedProviders,
  getClaudeRoute,
  refreshCliAccountQuota,
  type CliAccountAdapter,
  type CliAccountOverview,
  type CliLoginStatus,
  type ProviderProfile,
  type RuntimeAdapterId,
} from "@/lib/api";
import { getCliBrand } from "@/lib/cli-brand";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import {
  CliQuotaSummary,
  LOGIN_HINT_KEYS,
  loginMethodLabel,
  type Translate,
} from "./cli-quota";
import { appliedStatusForAdapter, isProviderActiveOnAdapter } from "./shared";

const CLI_ADAPTERS: RuntimeAdapterId[] = ["claude", "opencode", "codex", "kimi", "pi"];

interface CliStatusSectionProps {
  provider: ProviderProfile;
  onApply: (adapter: RuntimeAdapterId) => void;
  onViewConfig: (adapter: RuntimeAdapterId) => void;
}

/**
 * Per-CLI "what is actually in effect" grid: install state, the provider/model
 * last applied to each CLI's global config, staleness hints, and shortcuts
 * into the apply dialog and the CLI config sheet.
 */
export function CliStatusSection({ provider, onApply, onViewConfig }: CliStatusSectionProps) {
  const { t } = useLanguage();
  const appliedQuery = useQuery({
    queryKey: ["applied-providers"],
    queryFn: getAppliedProviders,
    retry: false,
    staleTime: 30_000,
  });
  const adaptersQuery = useQuery({
    queryKey: ADAPTER_DISCOVERY_QUERY_KEY,
    queryFn: discoverAdapters,
    retry: false,
    staleTime: 30_000,
  });
  const routeQuery = useQuery({
    queryKey: ["claude-route"],
    queryFn: getClaudeRoute,
    retry: false,
    staleTime: 60_000,
  });
  const cliAccountsQuery = useQuery({
    queryKey: ["cli-accounts"],
    queryFn: getCliAccounts,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const discovered = new Map((adaptersQuery.data?.adapters ?? []).map((adapter) => [adapter.id, adapter]));
  const statuses = appliedQuery.data?.adapters;
  const routeState = routeQuery.data;
  const cliAccounts = new Map<string, CliAccountOverview>(
    (cliAccountsQuery.data?.accounts ?? []).map((account) => [account.login.adapter, account])
  );

  const queryClient = useQueryClient();
  const [refreshingAdapter, setRefreshingAdapter] = useState<CliAccountAdapter | null>(null);
  const handleRefreshQuota = (adapter: CliAccountAdapter) => {
    setRefreshingAdapter(adapter);
    refreshCliAccountQuota(adapter)
      .then(() => queryClient.invalidateQueries({ queryKey: ["cli-accounts"] }))
      .catch(() => toast.error(t("models.cliAccountQuotaRefreshFailed")))
      .finally(() => setRefreshingAdapter(null));
  };

  return (
    <Card data-testid="cli-status-section">
      <CardHeader>
        <CardTitle className="text-base">{t("models.cliStatusTitle")}</CardTitle>
        <CardDescription className="mt-1">{t("models.cliStatusDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {CLI_ADAPTERS.map((adapter) => {
            const brand = getCliBrand(adapter);
            const detected = discovered.get(adapter);
            const installed = detected?.available === true;
            const probeFailed = detected?.status === "check_failed";
            const status = appliedStatusForAdapter(statuses, adapter);
            const applied = status?.applied ?? null;
            const activeHere = isProviderActiveOnAdapter(status, provider.id);
            const supportedByProvider = provider.supportedAdapters.includes(adapter);
            const routedHere =
              adapter === "claude" &&
              routeState?.enabled === true &&
              routeState.assignment?.providerProfileId === provider.id;
            const account = cliAccounts.get(adapter);
            const login = account?.login ?? null;
            return (
              <div
                key={adapter}
                data-testid={`cli-status-${adapter}`}
                className={`flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2.5 ${
                  activeHere ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/70 bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <CliBrandIcon aiTool={adapter} className="size-4 shrink-0" />
                    <span className="truncate">{brand.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {routedHere && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t("models.claudeRouteBadge")}
                      </Badge>
                    )}
                    <Badge variant={installed ? "secondary" : "outline"} className="text-[10px]">
                      {installed
                        ? t("models.sdkInstalled")
                        : probeFailed
                          ? t("models.cliStatusCheckFailed")
                          : t("models.sdkMissing")}
                    </Badge>
                    {login ? <CliLoginBadge login={login} t={t} /> : null}
                  </span>
                </div>

                <div className="min-w-0 text-xs">
                  {applied ? (
                    <div className="min-w-0">
                      <div className={`truncate font-medium ${activeHere ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                        {applied.providerName ?? applied.providerProfileId}
                        {activeHere ? ` · ${t("models.cliStatusActiveHere")}` : ""}
                      </div>
                      <div className="truncate text-muted-foreground">
                        {applied.modelName ?? applied.modelId ?? t("models.cliStatusNoModel")}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{t("models.cliStatusNotConfigured")}</span>
                  )}
                  {status?.stale ? (
                    <div className="mt-1 flex items-center gap-1 text-amber-700 dark:text-amber-300">
                      <TriangleAlert className="size-3 shrink-0" />
                      {t("models.cliStatusStale")}
                    </div>
                  ) : null}
                </div>

                {login ? (
                  <div className="space-y-1.5">
                    {login.state === "not_authenticated" ? (
                      <div className="flex items-center gap-1.5">
                        <p
                          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                          title={t(LOGIN_HINT_KEYS[login.adapter])}
                        >
                          {t(LOGIN_HINT_KEYS[login.adapter])}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 text-muted-foreground"
                          disabled={refreshingAdapter === login.adapter}
                          aria-label={t("models.cliAccountQuotaRefresh")}
                          title={t("models.cliAccountQuotaRefresh")}
                          onClick={() => handleRefreshQuota(login.adapter)}
                        >
                          <RefreshCw className={cn("size-3", refreshingAdapter === login.adapter && "animate-spin")} />
                        </Button>
                      </div>
                    ) : null}
                    <CliQuotaSummary quota={account?.quota} t={t} />
                  </div>
                ) : null}

                <div className="mt-auto flex items-center gap-1.5 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 px-2 text-xs"
                    disabled={!supportedByProvider}
                    title={!supportedByProvider ? t("models.cliStatusApplyUnsupported") : undefined}
                    onClick={() => onApply(adapter)}
                  >
                    <ShieldCheck className="size-3.5" />
                    {t("models.cliStatusApply")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 flex-1 px-2 text-xs"
                    disabled={adaptersQuery.isSuccess && !installed}
                    title={adaptersQuery.isSuccess && !installed ? t("models.cliStatusCliMissing") : undefined}
                    onClick={() => onViewConfig(adapter)}
                  >
                    <FileCode2 className="size-3.5" />
                    {t("models.cliStatusViewConfig")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {appliedQuery.isError ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("models.cliStatusLoadFailed")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Native login badge for the claude/codex/kimi cards. cli_missing renders
 * nothing (the install badge already says so); unknown degrades to a muted
 * badge instead of an error state.
 */
function CliLoginBadge({ login, t }: { login: CliLoginStatus; t: Translate }) {
  if (login.state === "cli_missing") return null;
  if (login.state === "ready") {
    const method = loginMethodLabel(login.method, t);
    return (
      <Badge variant="default" className="text-[10px]">
        {t("models.cliAccountLoggedIn")}
        {method ? ` · ${method}` : ""}
      </Badge>
    );
  }
  if (login.state === "not_authenticated") {
    return (
      <Badge variant="outline" className="text-[10px]">
        {t("models.cliAccountNotLoggedIn")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      {t("models.cliAccountDetectFailed")}
    </Badge>
  );
}
