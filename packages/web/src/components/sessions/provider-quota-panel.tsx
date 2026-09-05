"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatQuotaAmount,
  quotaBarToneClass,
  quotaUsagePercent,
} from "@/components/sessions/provider-quota";
import { useLanguage } from "@/hooks/use-language";
import {
  checkProviderBalance,
  getAppliedProviderForAdapter,
  getProviderBalance,
  type ProviderBalanceEntry,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  aiTool: string;
}

const REFRESH_INTERVAL_MS = 60_000;
const KNOWN_TOOLS = new Set(["claude", "opencode", "codex", "kimi"]);

export function ProviderQuotaPanel({ aiTool }: Props) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const knownTool = KNOWN_TOOLS.has(aiTool);

  const appliedQuery = useQuery({
    queryKey: ["applied-provider", aiTool],
    queryFn: () => getAppliedProviderForAdapter(aiTool),
    enabled: knownTool,
    retry: false,
  });
  const applied = appliedQuery.data?.appliedProvider ?? null;
  const providerId = applied?.providerProfileId;

  const balanceQuery = useQuery({
    queryKey: ["provider-balance", providerId],
    queryFn: () => getProviderBalance(providerId as string),
    enabled: Boolean(providerId),
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => checkProviderBalance(providerId as string),
    onSuccess: (result) => {
      queryClient.setQueryData(["provider-balance", providerId], result);
    },
  });

  if (!knownTool) return null;

  const balance = balanceQuery.data;
  const refreshing = balanceQuery.isFetching || refreshMutation.isPending;

  return (
    <section className="rounded-lg border border-border p-3" data-testid="provider-quota-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Gauge className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0">{t("sessions.providerQuota")}</span>
          {applied && (
            <span
              className="min-w-0 truncate rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
              title={applied.providerName}
            >
              {applied.providerName}
            </span>
          )}
        </div>
        {providerId && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground"
            disabled={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate()}
            aria-label={t("sessions.providerQuotaRefresh")}
            title={t("sessions.providerQuotaRefresh")}
          >
            <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
          </Button>
        )}
      </div>

      {!applied ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("sessions.providerQuotaEmpty")}</p>
      ) : balanceQuery.error ? (
        <p className="mt-2 text-xs text-destructive">{t("sessions.providerQuotaLoadFailed")}</p>
      ) : !balance ? (
        <p className="mt-2 text-xs text-muted-foreground">…</p>
      ) : !balance.supported ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("sessions.providerQuotaUnsupported")}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {balance.balances.map((entry) => (
            <ProviderQuotaRow key={entry.label} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProviderQuotaRow({ entry }: { entry: ProviderBalanceEntry }) {
  const { t } = useLanguage();
  const percent = quotaUsagePercent(entry);
  return (
    <li className="rounded-md border border-border/70 bg-muted/10 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="shrink-0 text-muted-foreground">{entry.label}</span>
        <span className="min-w-0 truncate font-mono text-[11px]">
          {entry.limit !== undefined
            ? `${formatQuotaAmount(entry.remaining)} / ${formatQuotaAmount(entry.limit)} ${entry.unit}`
            : `${formatQuotaAmount(entry.remaining)} ${entry.unit}`}
        </span>
      </div>
      {percent !== null && (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/60"
          title={t("sessions.providerQuota") + ` ${percent}%`}
        >
          <div
            className={cn("h-full rounded-full", quotaBarToneClass(percent))}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {entry.resetsAt && (
        <div className="mt-1 text-[10px] text-muted-foreground/70">
          {t("sessions.providerQuotaResetAt")}: {new Date(entry.resetsAt).toLocaleString()}
        </div>
      )}
    </li>
  );
}
