"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Gauge, RefreshCw } from "lucide-react";

import {
  CliQuotaSummary,
  LOGIN_HINT_KEYS,
  loginMethodLabel,
  type Translate,
} from "@/components/models/cli-quota";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  cliQuotaRemainingPercent,
  formatQuotaAmount,
  quotaRemainingPercent,
  quotaUsagePercent,
  remainingBarToneClass,
  remainingPillToneClass,
  remainingTextToneClass,
} from "@/components/sessions/provider-quota";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import {
  checkProviderBalance,
  CLI_ACCOUNT_ADAPTERS,
  getCliAccount,
  getAppliedProviderForAdapter,
  refreshCliAccountQuota,
  type AppliedProviderInfo,
  type CliAccountAdapter,
  type CliLoginStatus,
  type CliQuotaResult,
  type ProviderBalanceEntry,
  type ProviderBalanceResult,
  runtimeAdapterIds,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Props {
  aiTool: string;
  /** Render borderless inside a popover or expandable detail drawer. */
  embedded?: boolean;
  /** Omit the outer section header when hosted inside an expandable strip. */
  hideHeader?: boolean;
}

const REFRESH_INTERVAL_MS = 60_000;
const KNOWN_TOOLS = new Set<string>(runtimeAdapterIds);

/** Returns true when `aiTool` corresponds to a supported provider/CLI adapter rather than a plain shell terminal. */
export function supportsProviderQuota(aiTool?: string | null): boolean {
  return Boolean(aiTool && KNOWN_TOOLS.has(aiTool));
}

export interface CompactQuotaChip {
  id: string;
  label: string;
  remainingPercent: number | null;
  valueText: string;
}

export interface SessionQuotaState {
  knownTool: boolean;
  nativeAdapter: CliAccountAdapter | null;
  applied: AppliedProviderInfo | null;
  providerId: string | undefined;
  balance: ProviderBalanceResult | undefined;
  balanceError: unknown;
  nativeLogin: CliLoginStatus | null;
  nativeQuota: CliQuotaResult | undefined;
  nativeError: unknown;
  nativeMethod: string | undefined;
  providerBlockVisible: boolean;
  nativeBlockVisible: boolean;
  nativeQuotaVisible: boolean;
  dualMode: boolean;
  canRefresh: boolean;
  refreshing: boolean;
  refreshAll: () => void;
  chips: CompactQuotaChip[];
  headlineChip: CompactQuotaChip | null;
  lowestRemainingPercent: number | null;
  hasMetrics: boolean;
  needsLoginHint: boolean;
}

/** Shared React Query quota state so the inspector strip and top pill never double-fetch. */
export function useSessionQuota(aiTool?: string | null): SessionQuotaState {
  const { t } = useLanguage();
  const pick = useTrilingual();
  const normalizedTool = aiTool ?? "";
  const knownTool = supportsProviderQuota(normalizedTool);
  // Only CLIs with a native login/quota surface are probed by the gateway.
  // Derived from one list so a new adapter does not need a second edit here
  // (opencode and pi have no account surface, so they stay excluded).
  const nativeAdapter: CliAccountAdapter | null =
    CLI_ACCOUNT_ADAPTERS.includes(normalizedTool as CliAccountAdapter)
      ? (normalizedTool as CliAccountAdapter)
      : null;

  const appliedQuery = useQuery({
    queryKey: ["applied-provider", normalizedTool],
    queryFn: () => getAppliedProviderForAdapter(normalizedTool),
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

  // The native login overview is queried whenever the CLI exposes one,
  // independent of the applied provider: when a provider is applied and the
  // CLI is also natively logged in, the panel shows both sources side by side.
  const nativeQuery = useQuery({
    queryKey: ["cli-account", normalizedTool],
    queryFn: async () => (await getCliAccount(nativeAdapter as CliAccountAdapter)).overview,
    enabled: nativeAdapter !== null,
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });
  const nativeLogin = nativeQuery.data?.login ?? null;
  const nativeQuota = nativeQuery.data?.quota;
  const nativeQuotaVisible =
    nativeLogin?.state === "ready" && Boolean(nativeQuota?.supported && nativeQuota.entries.length > 0);
  const nativeMethod =
    nativeLogin && nativeLogin.state === "ready" ? loginMethodLabel(nativeLogin.method, t) : undefined;

  const providerBlockVisible = Boolean(applied);
  const nativeBlockVisible = nativeAdapter !== null && nativeLogin?.state === "ready";
  const dualMode = providerBlockVisible && nativeBlockVisible;
  const nativeRefreshVisible =
    nativeAdapter !== null &&
    nativeLogin !== null &&
    (nativeLogin.state === "ready" || (!providerBlockVisible && nativeLogin.state === "not_authenticated"));

  const canRefresh = Boolean(providerId || nativeRefreshVisible);
  const refreshing = balanceQuery.isFetching || refreshingNative;

  const refreshAll = () => {
    if (providerId) void balanceQuery.refetch();
    if (nativeAdapter && nativeRefreshVisible) {
      setRefreshingNative(true);
      refreshCliAccountQuota(nativeAdapter)
        .then(() => nativeQuery.refetch())
        .catch(() => toast.error(t("models.cliAccountQuotaRefreshFailed")))
        .finally(() => setRefreshingNative(false));
    }
  };

  const balance = balanceQuery.data;

  const chips = useMemo<CompactQuotaChip[]>(() => {
    const items: CompactQuotaChip[] = [];
    if (applied && balance?.supported) {
      for (const entry of balance.balances) {
        const remainingPercent = quotaRemainingPercent(entry);
        const valueText =
          remainingPercent !== null
            ? pick(`剩 ${remainingPercent}%`, `剩 ${remainingPercent}%`, `${remainingPercent}% left`)
            : `${formatQuotaAmount(entry.remaining)} ${entry.unit}`.trim();
        items.push({
          id: `provider:${entry.label}`,
          label: entry.label,
          remainingPercent,
          valueText,
        });
      }
    }
    if (nativeQuotaVisible && nativeQuota) {
      for (const entry of nativeQuota.entries) {
        const remainingPercent = cliQuotaRemainingPercent(entry);
        const valueText =
          remainingPercent !== null
            ? pick(`剩 ${remainingPercent}%`, `剩 ${remainingPercent}%`, `${remainingPercent}% left`)
            : entry.remaining !== undefined
              ? formatQuotaAmount(entry.remaining)
              : "";
        if (!valueText) continue;
        items.push({
          id: `native:${entry.label}:${entry.resetsAt ?? ""}`,
          label: entry.label,
          remainingPercent,
          valueText,
        });
      }
    }
    return items;
  }, [applied, balance, nativeQuota, nativeQuotaVisible, pick]);

  const { headlineChip, lowestRemainingPercent } = useMemo(() => {
    let lowest: number | null = null;
    let lowestChip: CompactQuotaChip | null = null;
    for (const chip of chips) {
      if (chip.remainingPercent !== null && (lowest === null || chip.remainingPercent < lowest)) {
        lowest = chip.remainingPercent;
        lowestChip = chip;
      }
    }
    return {
      headlineChip: lowestChip ?? chips[0] ?? null,
      lowestRemainingPercent: lowest,
    };
  }, [chips]);

  return {
    knownTool,
    nativeAdapter,
    applied,
    providerId,
    balance,
    balanceError: balanceQuery.error,
    nativeLogin,
    nativeQuota,
    nativeError: nativeQuery.error,
    nativeMethod,
    providerBlockVisible,
    nativeBlockVisible,
    nativeQuotaVisible,
    dualMode,
    canRefresh,
    refreshing,
    refreshAll,
    chips,
    headlineChip,
    lowestRemainingPercent,
    hasMetrics: chips.length > 0,
    needsLoginHint: !applied && nativeAdapter !== null && nativeLogin?.state === "not_authenticated",
  };
}

/**
 * Always-visible compact quota strip pinned at the top of the right inspector
 * pane. Hidden automatically when the session has no quota metrics or actionable
 * login/error state so non-quota CLIs pay zero vertical space.
 */
export function SessionQuotaStrip({ aiTool }: { aiTool?: string | null }) {
  const { t } = useLanguage();
  const pick = useTrilingual();
  const quota = useSessionQuota(aiTool);
  const [expanded, setExpanded] = useState(false);

  if (!quota.knownTool) return null;
  const hasVisibleContent = quota.hasMetrics || Boolean(quota.balanceError) || quota.needsLoginHint;
  if (!hasVisibleContent) return null;

  const gaugeTone =
    quota.lowestRemainingPercent !== null
      ? remainingTextToneClass(quota.lowestRemainingPercent)
      : "text-muted-foreground";
  const visibleChips = quota.chips.slice(0, 2);
  const toggleLabel = expanded
    ? pick("收起额度详情", "收起額度詳情", "Collapse quota details")
    : quota.hasMetrics
      ? `${pick("展开额度详情", "展開額度詳情", "Expand quota details")} · ${visibleChips.map((chip) => `${chip.label} ${chip.valueText}`).join(" · ")}`
      : pick("展开额度详情", "展開額度詳情", "Expand quota details");

  return (
    <section
      data-testid="session-quota-strip"
      className="shrink-0 border-b border-border/70 bg-card/45"
    >
      <div className="flex items-center gap-1 px-2.5 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={toggleLabel}
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Gauge className={cn("size-3.5 shrink-0", gaugeTone)} aria-hidden="true" />
          {quota.hasMetrics ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {visibleChips.map((chip) => (
                <span
                  key={chip.id}
                  title={`${chip.label} · ${chip.valueText}`}
                  className={cn(
                    "forgebadger-tabular-nums inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    chip.remainingPercent !== null
                      ? remainingPillToneClass(chip.remainingPercent)
                      : "border-border/70 bg-muted/40 text-foreground"
                  )}
                >
                  <span className="max-w-20 truncate text-[10px] font-normal text-muted-foreground">
                    {chip.label}
                  </span>
                  <span>{chip.valueText}</span>
                </span>
              ))}
              {quota.chips.length > 2 ? (
                <span className="forgebadger-tabular-nums text-[10px] text-muted-foreground">
                  +{quota.chips.length - 2}
                </span>
              ) : null}
            </div>
          ) : quota.balanceError ? (
            <span className="min-w-0 flex-1 truncate text-xs text-destructive">
              {t("sessions.providerQuotaLoadFailed")}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {pick("CLI 未登录，点击查看登录命令", "CLI 未登入，點擊檢視登入指令", "CLI not signed in · click for hint")}
            </span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
              expanded && "rotate-180"
            )}
          />
        </button>
        {quota.canRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            disabled={quota.refreshing}
            onClick={quota.refreshAll}
            aria-label={t("sessions.providerQuotaRefresh")}
            title={t("sessions.providerQuotaRefresh")}
          >
            <RefreshCw className={cn("size-3", quota.refreshing && "motion-safe:animate-spin")} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {expanded && aiTool ? (
        <div className="max-h-72 overflow-y-auto border-t border-border/50 bg-muted/15 p-3">
          <ProviderQuotaPanel aiTool={aiTool} embedded hideHeader />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Compact top-chrome quota pill shown only when the right inspector is hidden
 * (collapsed, mobile/tablet drawer mode, or focus mode), so remaining quota is
 * always one glance away.
 */
export function SessionQuotaPill({ aiTool }: { aiTool?: string | null }) {
  const { t } = useLanguage();
  const quota = useSessionQuota(aiTool);

  if (!quota.knownTool || !quota.headlineChip || !aiTool) return null;
  const { headlineChip, lowestRemainingPercent } = quota;
  const pillClass =
    lowestRemainingPercent !== null
      ? remainingPillToneClass(lowestRemainingPercent)
      : "border-border/70 bg-card/75 text-foreground";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="session-quota-pill"
          aria-label={`${t("sessions.providerQuota")} · ${headlineChip.label} ${headlineChip.valueText}`}
          title={`${headlineChip.label} · ${headlineChip.valueText}`}
          className={cn(
            "forgebadger-tabular-nums inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            pillClass
          )}
        >
          <Gauge className="size-3 shrink-0" aria-hidden="true" />
          <span>{headlineChip.valueText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <ProviderQuotaPanel aiTool={aiTool} embedded />
      </PopoverContent>
    </Popover>
  );
}

export function ProviderQuotaPanel({ aiTool, embedded = false, hideHeader = false }: Props) {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const quota = useSessionQuota(aiTool);

  if (!quota.knownTool) return null;

  const {
    applied,
    balance,
    balanceError,
    canRefresh,
    dualMode,
    nativeAdapter,
    nativeBlockVisible,
    nativeError,
    nativeLogin,
    nativeMethod,
    nativeQuota,
    nativeQuotaVisible,
    providerBlockVisible,
    refreshAll,
    refreshing,
  } = quota;

  const providerBlockLabel = dualMode && applied ? applied.providerName : null;
  const nativeBlockLabel = dualMode
    ? `${t("sessions.providerQuotaNative")}${nativeMethod ? ` · ${nativeMethod}` : ""}`
    : null;

  return (
    <section
      className={embedded ? "space-y-2" : "rounded-lg border border-border p-3"}
      data-testid="provider-quota-panel"
    >
      {!hideHeader ? (
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
            ) : null}
            {nativeQuotaVisible ? (
              <span
                className="min-w-0 truncate rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
                title={nativeMethod ? `${t("sessions.providerQuotaNative")} · ${nativeMethod}` : t("sessions.providerQuotaNative")}
              >
                {t("sessions.providerQuotaNative")}
                {nativeMethod ? ` · ${nativeMethod}` : ""}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canRefresh ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground"
                disabled={refreshing}
                onClick={refreshAll}
                aria-label={t("sessions.providerQuotaRefresh")}
                title={t("sessions.providerQuotaRefresh")}
              >
                <RefreshCw className={cn("size-3", refreshing && "motion-safe:animate-spin")} />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {applied ? (
        <QuotaBlock label={providerBlockLabel}>
          {balanceError ? (
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
                {new Date(balance.checkedAt).toLocaleTimeString(locale)}
                {refreshing && " ·…"}
              </p>
            </>
          )}
        </QuotaBlock>
      ) : null}

      {nativeAdapter && (dualMode || !applied) ? (
        <QuotaBlock label={nativeBlockLabel}>
          <NativeQuotaBody
            adapter={nativeAdapter}
            login={nativeLogin}
            quota={nativeQuota}
            failed={Boolean(nativeError)}
            t={t}
          />
        </QuotaBlock>
      ) : !applied && !nativeBlockVisible && !providerBlockVisible ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("sessions.providerQuotaEmpty")}</p>
      ) : null}
    </section>
  );
}

/**
 * One quota source in the panel. In dual display (applied provider + ready
 * native login) each block carries a source label; single-source mode renders
 * the body bare.
 */
function QuotaBlock({ label, children }: { label: string | null; children: ReactNode }) {
  if (!label) return <>{children}</>;
  return (
    <div>
      <p className="mt-3 text-[10px] font-medium text-muted-foreground/80">{label}</p>
      {children}
    </div>
  );
}

/**
 * Native login quota body. Never surfaces gateway error text — failures
 * collapse back to the neutral empty state.
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
  const locale = useUiLocale();
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
            <CliQuotaSummary quota={quota} t={t} displayMode="remaining" />
          </div>
          <p className="mt-2 text-right text-[10px] text-muted-foreground/60 tabular-nums">
            {t("sessions.providerQuotaCheckedAt")} {new Date(quota.fetchedAt).toLocaleTimeString(locale)}
          </p>
        </>
      );
    }
    if (!quota.supported && quota.unsupportedReason) {
      return (
        <div className="mt-2">
          <CliQuotaSummary quota={quota} t={t} displayMode="remaining" />
        </div>
      );
    }
  }
  return <p className="mt-2 text-xs text-muted-foreground">{t("sessions.providerQuotaEmpty")}</p>;
}

function ProviderQuotaRow({ entry }: { entry: ProviderBalanceEntry }) {
  const { t } = useLanguage();
  const pick = useTrilingual();
  const locale = useUiLocale();
  const usedPercent = quotaUsagePercent(entry);
  const remainingPercent = quotaRemainingPercent(entry);
  const titleText =
    remainingPercent !== null && usedPercent !== null
      ? `${t("sessions.providerQuotaRemaining")} ${remainingPercent}% · ${t("sessions.providerQuotaUsed")} ${usedPercent}%`
      : undefined;

  return (
    <li className="rounded-md border border-border/70 bg-muted/10 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{entry.label}</span>
        {remainingPercent !== null ? (
          <span
            className={cn("forgebadger-tabular-nums shrink-0 text-sm font-semibold", remainingTextToneClass(remainingPercent))}
            title={titleText}
          >
            {pick(`剩 ${remainingPercent}`, `剩 ${remainingPercent}`, `${remainingPercent}`)}
            <span className="text-[10px] font-normal">
              {pick("%", "%", "% left")}
            </span>
          </span>
        ) : (
          <span className="forgebadger-tabular-nums shrink-0 font-mono text-[11px]">
            {formatQuotaAmount(entry.remaining)} {entry.unit}
          </span>
        )}
      </div>
      {remainingPercent !== null && (
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted/60"
          role="progressbar"
          aria-valuenow={remainingPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${entry.label} ${t("sessions.providerQuotaRemaining")} ${remainingPercent}%`}
          title={titleText}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-700 ease-out", remainingBarToneClass(remainingPercent))}
            style={{ width: `${remainingPercent}%` }}
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
              {t("sessions.providerQuotaResetAt")}: {new Date(entry.resetsAt).toLocaleString(locale)}
            </span>
          )}
        </div>
      )}
    </li>
  );
}