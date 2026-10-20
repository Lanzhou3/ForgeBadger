"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

import { ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
import { CliBrandIcon } from "@/components/cli-brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  runtimeAdapterIds,
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

const CLI_ADAPTERS: RuntimeAdapterId[] = [...runtimeAdapterIds];

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
    <section className="space-y-3" data-testid="cli-status-section">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("models.cliStatusTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("models.cliStatusDescription")}</p>
      </div>
      {appliedQuery.isLoading ? (
        // Skeleton while the applied-state probe resolves so the grid does
        // not flash "not configured" for every CLI.
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="cli-status-skeleton">
          {CLI_ADAPTERS.map((adapter) => (
            <div
              key={adapter}
              className="min-h-[148px] animate-pulse rounded-xl border border-border/60 bg-muted/20 p-3"
            />
          ))}
        </div>
      ) : (
      <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
              className={`flex h-full min-h-[148px] min-w-0 flex-col gap-2 rounded-xl border p-3 ${
                activeHere ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-border/60 bg-muted/20"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60">
                    <CliBrandIcon aiTool={adapter} className="size-4" />
                  </span>
                  <span className="truncate">{brand.label}</span>
                </span>
                {status?.stale ? (
                  <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
                    <TriangleAlert className="size-3" />
                    {t("models.cliStatusStale")}
                  </Badge>
                ) : activeHere ? (
                  <Badge variant="outline" className="shrink-0 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
                    {t("models.cliStatusActiveHere")}
                  </Badge>
                ) : null}
              </div>

              <div className="min-w-0 text-xs">
                {applied ? (
                  <div className="min-w-0">
                    <div className={`truncate text-[13px] font-medium ${activeHere ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                      {applied.providerName ??
                        `${t("models.cliStatusUnknownProvider")} · ${applied.providerProfileId.slice(0, 8)}`}
                      {activeHere ? ` · ${t("models.cliStatusActiveHere")}` : ""}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {applied.modelName ?? applied.modelId ?? t("models.cliStatusNoModel")}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">{t("models.cliStatusNotConfigured")}</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1">
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
      )}
      {appliedQuery.isError ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("models.cliStatusLoadFailed")}</p>
      ) : null}
    </section>
  );
}

/**
 * Native login badge for the claude/codex/kimi cards. cli_missing renders
 * nothing (the install badge already says so); custom_endpoint (routed
 * Claude) renders a neutral badge because a first-party login claim would be
 * misleading; unknown degrades to a muted badge instead of an error state.
 */
function CliLoginBadge({ login, t }: { login: CliLoginStatus; t: Translate }) {
  if (login.state === "cli_missing") return null;
  if (login.state === "custom_endpoint") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] text-muted-foreground"
        title={t("models.cliAccountCustomEndpointHint")}
      >
        {t("models.cliAccountCustomEndpoint")}
      </Badge>
    );
  }
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