"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Brain,
  Braces,
  Database,
  RefreshCw,
  type LucideIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import {
  getProjectActivity,
  getTokenUsageSummary,
  syncUsageTokens,
  type TokenUsageBucket,
  type TokenDailyPoint
} from "@/lib/api";
import { getCliBrand } from "@/lib/cli-brand";
import { formatTokens } from "@/lib/usage-format";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

function monthOptionsList(count = 12): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function contiguousDayList(start: Date, endExclusive: Date): string[] {
  const days: string[] = [];
  for (const cursor = new Date(start); cursor < endExclusive; cursor.setDate(cursor.getDate() + 1)) {
    days.push(formatLocalDate(cursor));
  }
  return days;
}

const LAST_30_DAYS = "last30";

interface ActiveRange {
  from: string;
  to: string;
  days: string[];
}

// Backend filters are [from, to); pass local-midnight boundaries.
// "last30" is a rolling 30-day window ending today; "YYYY-MM" is a calendar month.
function activityRange(value: string): ActiveRange {
  if (value === LAST_30_DAYS) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return {
      from: `${formatLocalDate(start)}T00:00:00`,
      to: `${formatLocalDate(end)}T00:00:00`,
      days: contiguousDayList(start, end),
    };
  }
  const [year = 0, monthNumber = 1] = value.split("-").map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 1);
  return {
    from: `${formatLocalDate(start)}T00:00:00`,
    to: `${formatLocalDate(end)}T00:00:00`,
    days: contiguousDayList(start, end),
  };
}

export default function UsagePage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<"ok" | "error">("ok");
  const [range, setRange] = useState(LAST_30_DAYS);
  const monthOptions = useMemo(() => monthOptionsList(), []);
  const activeRange = useMemo(() => activityRange(range), [range]);

  const { data: usageData, isLoading } = useQuery({
    queryKey: ["usage-token-summary"],
    queryFn: () => getTokenUsageSummary()
  });
  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["usage-project-activity", range],
    queryFn: () => getProjectActivity({ from: activeRange.from, to: activeRange.to })
  });

  const summary = usageData?.summary;
  const series = activityData?.series ?? [];
  const rangeDays = activeRange.days;

  const syncMutation = useMutation({
    mutationFn: syncUsageTokens,
    onSuccess: (data) => {
      const inserted = data.result?.totalInserted ?? 0;
      setNoticeType("ok");
      setNotice(inserted > 0 ? `${t("usage.syncDone")} (+${inserted})` : t("usage.syncDone"));
      queryClient.invalidateQueries({ queryKey: ["usage-token-summary"] });
      queryClient.invalidateQueries({ queryKey: ["usage-project-activity"] });
    },
    onError: (error) => {
      setNoticeType("error");
      setNotice(error instanceof Error ? error.message : t("usage.syncFailed"));
    }
  });

  const daily = useMemo(() => {
    // Aggregate per-day across groups, then fill every day of the selected month.
    const byDay = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number }>();
    for (const point of series) {
      const current = byDay.get(point.day) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      current.inputTokens += point.inputTokens;
      current.outputTokens += point.outputTokens;
      current.totalTokens += point.totalTokens;
      byDay.set(point.day, current);
    }
    return rangeDays.map((day) => ({
      day,
      ...(byDay.get(day) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    }));
  }, [series, rangeDays]);

  const maxDailyTotal = Math.max(1, ...daily.map((row) => row.totalTokens));

  const metrics: { icon: LucideIcon; label: string; value: string; hint?: string }[] = summary
    ? [
        {
          icon: Braces,
          label: t("usage.totalTokens"),
          value: formatTokens(summary.totalTokens),
          hint: `${t("usage.requests")} ${summary.requestCount}`
        },
        {
          icon: Database,
          label: t("usage.totalInput"),
          value: formatTokens(summary.totalInputTokens)
        },
        {
          icon: Braces,
          label: t("usage.totalOutput"),
          value: formatTokens(summary.totalOutputTokens)
        },
        {
          icon: Database,
          label: t("usage.totalCacheRead"),
          value: formatTokens(summary.totalCacheReadTokens)
        },
        {
          icon: Database,
          label: t("usage.totalCacheWrite"),
          value: formatTokens(summary.totalCacheWriteTokens)
        },
        {
          icon: Brain,
          label: t("usage.totalReasoning"),
          value: formatTokens(summary.totalReasoningTokens)
        },
        {
          icon: Database,
          label: t("usage.cacheHitRate"),
          value: summary.cacheHitRate === null ? "—" : `${summary.cacheHitRate}%`,
          hint: t("usage.cacheHitRateHint")
        }
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("usage.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("usage.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label={t("usage.activityTitle")}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            value={range}
            onChange={(event) => setRange(event.target.value)}
          >
            <option value={LAST_30_DAYS}>{t("usage.last30Days")}</option>
            {monthOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <Button
            size="sm"
            className="bg-brand text-brand-foreground hover:bg-brand/90"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw className={cn("size-4", syncMutation.isPending && "animate-spin")} />
            {syncMutation.isPending ? t("usage.syncing") : t("usage.sync")}
          </Button>
        </div>
      </div>

      {notice && (
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm of-animate-in",
            noticeType === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              noticeType === "error" ? "bg-red-400" : "bg-emerald-400"
            )}
          />
          {notice}
        </div>
      )}

      {isLoading || !summary ? (
        <Card className="of-animate-in">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("usage.loading")}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="of-animate-in">
            <CardContent className="flex flex-wrap p-0">
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="flex min-w-[150px] flex-1 items-center gap-2.5 border-l border-border/70 px-4 py-3 first:border-l-0"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                    <metric.icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold leading-tight tabular-nums">
                      {metric.value}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={metric.hint ? `${metric.label} · ${metric.hint}` : metric.label}>
                      {metric.label}
                      {metric.hint ? (
                        <span className="text-muted-foreground/70"> · {metric.hint}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {summary.requestCount === 0 ? (
            <Card className="of-animate-in">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <Activity className="size-5" />
                </div>
                <div>
                  <div className="text-sm font-medium">{t("usage.emptyTitle")}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("usage.emptyDescription")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                >
                  <RefreshCw className={cn("size-4", syncMutation.isPending && "animate-spin")} />
                  {syncMutation.isPending ? t("usage.syncing") : t("usage.sync")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="of-animate-in">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold">{t("usage.dailyTrend")}</CardTitle>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-sm bg-brand" />
                        {t("usage.output")}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-sm bg-brand/50" />
                        {t("usage.input")}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex h-44 items-end gap-1 border-b border-border/70">
                    {daily.map((row) => {
                      const outputShare = row.totalTokens > 0
                        ? Math.min(100, (row.outputTokens / row.totalTokens) * 100)
                        : 0;
                      return (
                        <div
                          key={row.day}
                          className="group relative flex h-full flex-1 items-end"
                        >
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg group-hover:block">
                            <div className="font-medium">{row.day}</div>
                            <div className="mt-1 space-y-0.5 text-muted-foreground">
                              <div className="flex items-center justify-between gap-4">
                                <span>{t("usage.total")}</span>
                                <span className="font-medium tabular-nums text-foreground">
                                  {formatTokens(row.totalTokens)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="size-1.5 rounded-sm bg-brand" />
                                  {t("usage.output")}
                                </span>
                                <span className="tabular-nums">{formatTokens(row.outputTokens)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="size-1.5 rounded-sm bg-brand/50" />
                                  {t("usage.input")}
                                </span>
                                <span className="tabular-nums">{formatTokens(row.inputTokens)}</span>
                              </div>
                            </div>
                          </div>
                          {row.totalTokens > 0 && (
                            <div
                              className="flex w-full flex-col justify-end overflow-hidden rounded-t"
                              style={{ height: `${Math.max(2, (row.totalTokens / maxDailyTotal) * 100)}%` }}
                            >
                              <div
                                className="w-full bg-brand transition-colors group-hover:bg-brand/90"
                                style={{ height: `${outputShare}%` }}
                              />
                              <div className="w-full flex-1 bg-brand/50 transition-colors group-hover:bg-brand/60" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>{daily[0]?.day}</span>
                    <span>{daily[daily.length - 1]?.day}</span>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <UsageTable
                  title={t("usage.byAdapter")}
                  rows={summary.byAdapter}
                  brandChip
                />
                <UsageTable
                  title={t("usage.byProject")}
                  rows={summary.byProject}
                />
                <UsageTable
                  title={t("usage.byModel")}
                  rows={summary.byModel}
                  showHitRate
                  className="md:col-span-2"
                />
              </div>
            </>
          )}

          {activityLoading ? (
            <Card className="of-animate-in">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                {t("usage.loading")}
              </CardContent>
            </Card>
          ) : (
            <ActivityHeatmap series={series} days={rangeDays} />
          )}
        </>
      )}
    </div>
  );
}

function UsageTable({
  title,
  rows,
  brandChip = false,
  showHitRate = false,
  className
}: {
  title: string;
  rows: TokenUsageBucket[];
  brandChip?: boolean;
  showHitRate?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const maxRowTotal = Math.max(1, ...rows.map((row) => row.totalTokens));

  return (
    <section className={cn("space-y-3 of-animate-in", className)}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{t("usage.group")}</span>
          <span className="w-20 shrink-0 text-right">{t("usage.input")}</span>
          <span className="w-20 shrink-0 text-right">{t("usage.output")}</span>
          <span className="w-20 shrink-0 text-right">{t("usage.total")}</span>
          {showHitRate && (
            <span className="w-20 shrink-0 text-right">{t("usage.cacheHitRate")}</span>
          )}
        </div>
        {rows.map((row) => (
          <div
            key={row.key}
            className="relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
          >
            <span
              className="pointer-events-none absolute inset-y-0 left-0 bg-brand/5"
              style={{ width: `${(row.totalTokens / maxRowTotal) * 100}%` }}
            />
            <span className="relative min-w-0 flex-1 truncate text-sm font-medium">
              {brandChip && getCliBrand(row.key).id !== "unknown" ? (
                <CliBrandChip aiTool={row.key} />
              ) : (
                row.key
              )}
            </span>
            <span className="relative w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
              {formatTokens(row.inputTokens)}
            </span>
            <span className="relative w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
              {formatTokens(row.outputTokens)}
            </span>
            <span className="relative w-20 shrink-0 text-right text-sm font-medium tabular-nums">
              {formatTokens(row.totalTokens)}
            </span>
            {showHitRate && (
              <span className="relative w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {row.cacheHitRate === null ? "—" : `${row.cacheHitRate}%`}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityHeatmap({ series, days }: { series: TokenDailyPoint[]; days: string[] }) {
  const { t } = useLanguage();
  const [hoverInfo, setHoverInfo] = useState<{ project: string; day: string; total: number } | null>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, TokenDailyPoint>();
    for (const point of series) map.set(`${point.day}|${point.group}`, point);
    return map;
  }, [series]);

  const projects = useMemo(
    () => [...new Set(series.map((point) => point.group))].sort(),
    [series]
  );

  const maxTotal = Math.max(1, ...series.map((point) => point.totalTokens));

  if (projects.length === 0 || days.length === 0) return null;

  return (
    <Card className="of-animate-in">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{t("usage.activityTitle")}</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-muted-foreground">
              {hoverInfo
                ? `${hoverInfo.project.split("/").filter(Boolean).pop() ?? hoverInfo.project} · ${hoverInfo.day} · ${formatTokens(hoverInfo.total)}`
                : " "}
            </span>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="size-2.5 rounded-sm bg-muted" />
              <span className="size-2.5 rounded-sm bg-brand/20" />
              <span className="size-2.5 rounded-sm bg-brand/40" />
              <span className="size-2.5 rounded-sm bg-brand/60" />
              <span className="size-2.5 rounded-sm bg-brand" />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto" onMouseLeave={() => setHoverInfo(null)}>
          <div className="inline-block space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-36 shrink-0" />
              {days.map((day) => (
                <div
                  key={day}
                  className="w-4 shrink-0 text-center text-[10px] leading-none text-muted-foreground"
                >
                  {day.slice(8)}
                </div>
              ))}
            </div>
            {projects.map((project) => {
              const projectLabel = project.split("/").filter(Boolean).pop() ?? project;
              return (
                <div key={project} className="flex items-center gap-1.5">
                  <div
                    className="w-36 shrink-0 truncate pr-2 text-xs leading-none text-muted-foreground"
                    title={project}
                  >
                    {projectLabel}
                  </div>
                  {days.map((day) => {
                    const point = byKey.get(`${day}|${project}`);
                    const total = point?.totalTokens ?? 0;
                    const intensity = total > 0 ? Math.ceil((total / maxTotal) * 4) : 0;
                    return (
                      <div
                        key={`${day}|${project}`}
                        className={cn(
                          "size-4 shrink-0 rounded-[3px] transition-transform hover:scale-110 hover:ring-1 hover:ring-foreground/40",
                          intensity === 0
                            ? "bg-muted"
                            : intensity === 1
                              ? "bg-brand/20"
                              : intensity === 2
                                ? "bg-brand/40"
                                : intensity === 3
                                  ? "bg-brand/60"
                                  : "bg-brand"
                        )}
                        onMouseEnter={() => setHoverInfo({ project, day, total })}
                      />
                    );
                  })}
                </div>
              );
            })}
            <div className="flex items-center gap-1.5">
              <div className="w-36 shrink-0" />
              <div className="flex flex-1 justify-between pt-1 text-[10px] leading-none text-muted-foreground">
                <span>{days[0]}</span>
                <span>{days[days.length - 1]}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
