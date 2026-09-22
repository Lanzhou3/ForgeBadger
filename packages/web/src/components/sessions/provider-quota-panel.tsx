"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge, RefreshCw } from "lucide-react";

import {
  CliQuotaSummary,
  LOGIN_HINT_KEYS,
  loginMethodLabel,
  type Translate,
} from "@/components/models/cli-quota";
import { Button } from "@/components/ui/button";
import {
  formatQuotaAmount,
  quotaBarToneClass,
  quotaTextToneClass,
  quotaUsagePercent,
} from "@/components/sessions/provider-quota";
import { useLanguage } from "@/hooks/use-language";
import {
  checkProviderBalance,
  getCliAccount,
  getAppliedProviderForAdapter,
  refreshCliAccountQuota,
  type CliAccountAdapter,
  type CliLoginStatus,
  type CliQuotaResult,
  type ProviderBalanceEntry,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Props {
  aiTool: string;
}

const REFRESH_INTERVAL_MS = 60_000;
const KNOWN_TOOLS = new Set(["claude", "opencode", "codex", "kimi", "pi"]);

export function ProviderQuotaPanel({ aiTool }: Props) {
  const { t } = useLanguage();
  const knownTool = KNOWN_TOOLS.has(aiTool);
  // Only these CLIs expose a native login quota through the gateway.
  const nativeAdapter: CliAccountAdapter | null =
    aiTool === "claude" || aiTool === "codex" || aiTool === "kimi" ? aiTool : null;

  const appliedQuery = useQuery({
    queryKey: ["applied-provider", aiTool],
    queryFn: () => getAppliedProviderForAdapter(aiTool),
    enabled: knownTool,
    retry: false,
  });
  const applied = appliedQuery.data?.appliedProvider ?? null;
  const providerId = applied?.providerProfileId;

  // Poll the probing endpoint (POST) rather than the cached GET read: the
  // server caches GET reads for 60s, so polling it could only ever surface a
  // fresh value every other cycle. One probe per minute stays far below the
  // balance rate limit and keeps the sidebar number honest.
  const balanceQuery = useQuery({
    queryKey: ["provider-balance", providerId],
    queryFn: () => checkProviderBalance(providerId as string),
    enabled: Boolean(providerId),
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const [refreshingNative, setRefreshingNative] = useState(false);

  // No Model Center provider applied: fall back to the CLI's native login
  // quota, mirroring the Model Center status cards. Gated on the applied read
  // settling so the fallback never fires for a CLI that has a provider.
  const nativeQuery = useQuery({
    queryKey: ["cli-account", aiTool],
    queryFn: async () => (await getCliAccount(nativeAdapter as CliAccountAdapter)).overview,
    enabled: nativeAdapter !== null && !appliedQuery.isInitialLoading && !applied,
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });
  const nativeLogin = nativeQuery.data?.login ?? null;
  const nativeQuota = nativeQuery.data?.quota;
  const nativeQuotaVisible =
    nativeLogin?.state === "ready" && Boolean(nativeQuota?.supported && nativeQuota.entries.length > 0);
  const nativeMethod =
    nativeLogin && nativeLogin.state === "ready" ? loginMethodLabel(nativeLogin.method, t) : undefined;

  const handleRefreshNative = () => {
    if (!nativeAdapter) return;
    setRefreshingNative(true);
    refreshCliAccountQuota(nativeAdapter)
      .then(() => nativeQuery.refetch())
      .catch(() => toast.error(t("models.cliAccountQuotaRefreshFailed")))
      .finally(() => setRefreshingNative(false));
  };

  if (!knownTool) return null;

  const balance = balanceQuery.data;
  const refreshing = balanceQuery.isFetching;

  return (
    <section className="rounded-lg border border-border p-3" data-testid="provider-quota-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Gauge className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0">{t("sessions.providerQuota")}</span>
          {applied ? (
            <span
              className="min-w-0 truncate rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
              title={applied.providerName}
            >
              {applied.providerName}
            </span>
          ) : nativeQuotaVisible ? (
            <span
              className="min-w-0 truncate rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
              title={nativeMethod ? `${t("sessions.providerQuotaNative")} · ${nativeMethod}` : t("sessions.providerQuotaNative")}
            >
              {t("sessions.providerQuotaNative")}
              {nativeMethod ? ` · ${nativeMethod}` : ""}
            </span>
          ) : null}
        </div>
        {providerId ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground"
            disabled={refreshing}
            onClick={() => void balanceQuery.refetch()}
            aria-label={t("sessions.providerQuotaRefresh")}
            title={t("sessions.providerQuotaRefresh")}
          >
            <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
          </Button>
        ) : nativeAdapter && nativeLogin && (nativeLogin.state === "ready" || nativeLogin.state === "not_authenticated") ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground"
            disabled={refreshingNative}
            onClick={handleRefreshNative}
            aria-label={t("sessions.providerQuotaRefresh")}
            title={t("sessions.providerQuotaRefresh")}
          >
            <RefreshCw className={cn("size-3", refreshingNative && "animate-spin")} />
          </Button>
        ) : null}
      </div>

      {!applied ? (
        nativeAdapter ? (
          <NativeQuotaBody
            adapter={nativeAdapter}
            login={nativeLogin}
            quota={nativeQuota}
            failed={Boolean(nativeQuery.error)}
            t={t}
          />
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{t("sessions.providerQuotaEmpty")}</p>
        )
      ) : balanceQuery.error ? (
        <p className="mt-2 text-xs text-destructive">{t("sessions.providerQuotaLoadFailed")}</p>
      ) : !balance ? (
        <p className="mt-2 text-xs text-muted-foreground">…</p>
      ) : !balance.supported ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("sessions.providerQuotaUnsupported")}</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {balance.balances.map((entry) => (
              <ProviderQuotaRow key={entry.label} entry={entry} />
            ))}
          </ul>
          <p className="mt-2 text-right text-[10px] text-muted-foreground/60 tabular-nums">
            {t("sessions.providerQuotaCheckedAt")}{" "}
            {new Date(balance.checkedAt).toLocaleTimeString()}
            {refreshing && " ·…"}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Native login quota body (no Model Center provider applied). Never surfaces
 * gateway error text — failures collapse back to the neutral empty state.
 */
function NativeQuotaBody({
  adapter,
  login,
  quota,
  failed,
  t,
}: {
  adapter: CliAccountAdapter;
  login: CliLoginStatus | null;
  quota: CliQuotaResult | undefined;
  failed: boolean;
  t: Translate;
}) {
  if (!login) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {failed ? t("sessions.providerQuotaEmpty") : "…"}
      </p>
    );
  }
  if (login.state === "not_authenticated") {
    return (
      <>
        <p className="mt-2 text-xs text-muted-foreground">{t("sessions.providerQuotaEmpty")}</p>
        <p
          className="mt-1 truncate text-[11px] text-muted-foreground/70"
          title={t(LOGIN_HINT_KEYS[adapter])}
        >
          {t(LOGIN_HINT_KEYS[adapter])}
        </p>
      </>
    );
  }
  if (login.state === "ready" && quota) {
    if (quota.supported && quota.entries.length > 0) {
      return (
        <>
          <div className="mt-3">
            <CliQuotaSummary quota={quota} t={t} />
          </div>
          <p className="mt-2 text-right text-[10px] text-muted-foreground/60 tabular-nums">
            {t("sessions.providerQuotaCheckedAt")} {new Date(quota.fetchedAt).toLocaleTimeString()}
          </p>
        </>
      );
    }
    if (!quota.supported && quota.unsupportedReason) {
      return (
        <div className="mt-2">
          <CliQuotaSummary quota={quota} t={t} />
        </div>
      );
    }
  }
  return <p className="mt-2 text-xs text-muted-foreground">{t("sessions.providerQuotaEmpty")}</p>;
}

function ProviderQuotaRow({ entry }: { entry: ProviderBalanceEntry }) {
  const { t } = useLanguage();
  const percent = quotaUsagePercent(entry);
  return (
    <li className="rounded-md border border-border/70 bg-muted/10 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{entry.label}</span>
        {percent !== null ? (
          <span
            className={cn("shrink-0 text-sm font-semibold tabular-nums", quotaTextToneClass(percent))}
            title={`${t("sessions.providerQuotaUsed")} ${percent}%`}
          >
            {percent}
            <span className="text-[10px] font-normal">%</span>
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            {formatQuotaAmount(entry.remaining)} {entry.unit}
          </span>
        )}
      </div>
      {percent !== null && (
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted/60"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${entry.label} ${t("sessions.providerQuotaUsed")} ${percent}%`}
          title={`${t("sessions.providerQuotaUsed")} ${percent}%`}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-700 ease-out", quotaBarToneClass(percent))}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {(entry.limit !== undefined || entry.unit === "%" || entry.resetsAt) && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground/70">
          {entry.limit !== undefined ? (
            <span className="font-mono tabular-nums">
              {formatQuotaAmount(entry.remaining)} / {formatQuotaAmount(entry.limit)} {entry.unit}
            </span>
          ) : entry.unit === "%" ? (
            <span className="font-mono tabular-nums">
              {t("sessions.providerQuotaRemaining")} {formatQuotaAmount(entry.remaining)}%
            </span>
          ) : (
            <span />
          )}
          {entry.resetsAt && (
            <span className="shrink-0 tabular-nums">
              {t("sessions.providerQuotaResetAt")}: {new Date(entry.resetsAt).toLocaleString()}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
