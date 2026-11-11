"use client";

import { useMemo, useRef } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjectActivity, type Project, type TokenDailyPoint } from "@/lib/api";
import { gsap, matchMotionPreference, useGSAP } from "@/lib/gsap-motion";
import { useLanguage } from "@/hooks/use-language";
import { formatTokens } from "@/lib/usage-format";
import { cn } from "@/lib/utils";

const DAY_COUNT = 14;
const PROJECT_LIMIT = 5;

type ActivityProject = Pick<Project, "id" | "name" | "path" | "rootPath">;

interface ProjectActivityRow {
  group: string;
  label: string;
  projectId?: string;
  totalTokens: number;
  activeDays: number;
  lastActiveDay: string;
  maxDailyTokens: number;
  totalsByDay: Map<string, number>;
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function recentDays(now: Date): string[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAY_COUNT - 1));
  return Array.from({ length: DAY_COUNT }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return localDay(date);
  });
}

function projectLabel(group: string): string {
  return group.split(/[\\/]/).filter(Boolean).pop() ?? group;
}

export function buildProjectActivityRows(
  series: readonly TokenDailyPoint[],
  days: readonly string[],
  projects: readonly ActivityProject[],
): ProjectActivityRow[] {
  const projectByKey = new Map<string, ActivityProject>();
  for (const project of projects) {
    projectByKey.set(project.id, project);
    if (project.path) projectByKey.set(project.path, project);
    if (project.rootPath) projectByKey.set(project.rootPath, project);
  }

  const totalsByGroup = new Map<string, Map<string, number>>();
  for (const point of series) {
    if (!days.includes(point.day) || point.totalTokens <= 0) continue;
    const totals = totalsByGroup.get(point.group) ?? new Map<string, number>();
    totals.set(point.day, (totals.get(point.day) ?? 0) + point.totalTokens);
    totalsByGroup.set(point.group, totals);
  }

  return [...totalsByGroup.entries()]
    .map(([group, totalsByDay]) => {
      const project = projectByKey.get(group);
      const activeDays = days.filter((day) => (totalsByDay.get(day) ?? 0) > 0);
      return {
        group,
        label: project?.name ?? projectLabel(group),
        ...(project ? { projectId: project.id } : {}),
        totalTokens: activeDays.reduce((sum, day) => sum + (totalsByDay.get(day) ?? 0), 0),
        activeDays: activeDays.length,
        lastActiveDay: activeDays.at(-1) ?? "",
        maxDailyTokens: Math.max(1, ...totalsByDay.values()),
        totalsByDay,
      };
    })
    .filter((row) => row.activeDays > 0)
    .sort((a, b) =>
      b.lastActiveDay.localeCompare(a.lastActiveDay) ||
      b.activeDays - a.activeDays ||
      b.totalTokens - a.totalTokens ||
      a.label.localeCompare(b.label)
    )
    .slice(0, PROJECT_LIMIT);
}

function activityLevel(total: number, max: number): number {
  return total > 0 ? Math.max(1, Math.ceil((total / max) * 4)) : 0;
}

export function ProjectActivityCard({ projects }: { projects: readonly ActivityProject[] }) {
  const { t, language } = useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => recentDays(new Date()), []);
  const range = useMemo(() => ({
    from: `${days[0]}T00:00:00`,
    to: `${localDay(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1))}T00:00:00`,
  }), [days]);
  const activityQuery = useQuery({
    queryKey: ["usage-project-activity", "dashboard", days[0], days.at(-1)],
    queryFn: () => getProjectActivity(range),
    staleTime: 60_000,
  });
  const rows = useMemo(
    () => buildProjectActivityRows(activityQuery.data?.series ?? [], days, projects),
    [activityQuery.data?.series, days, projects],
  );
  const rowKey = rows.map((row) => row.group).join("|");

  useGSAP(() => {
    if (!rowKey) return;
    matchMotionPreference({
      full: () => {
        gsap.from('[data-motion="project-activity-row"]', {
          opacity: 0,
          y: 6,
          duration: 0.28,
          stagger: 0.045,
        });
      },
    });
  }, { scope: rootRef, dependencies: [rowKey], revertOnUpdate: true });

  if (activityQuery.isSuccess && rows.length === 0) return null;

  const formatDay = (day: string) => new Intl.DateTimeFormat(language, {
    month: "numeric",
    day: "numeric",
  }).format(new Date(`${day}T00:00:00`));
  const lastActiveText = (day: string) => {
    if (day === days.at(-1)) return t("dashboard.activityToday");
    if (day === days.at(-2)) return t("dashboard.activityYesterday");
    return t("dashboard.activityLastActive").replace("{day}", formatDay(day));
  };

  return (
    <Card ref={rootRef} data-motion="dashboard-section" className="overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Activity className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">{t("dashboard.activityTitle")}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{t("dashboard.activityDescription")}</p>
            </div>
          </div>
          <Button asChild size="sm" variant="ghost" className="-mr-2 text-muted-foreground">
            <Link href="/usage">
              {t("dashboard.activityViewUsage")}
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {activityQuery.isLoading ? (
          <div className="space-y-3" aria-label={t("dashboard.activityLoading")}>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-4">
                <div className="h-4 w-36 animate-pulse rounded bg-muted" />
                <div className="h-5 flex-1 animate-pulse rounded bg-muted/70" />
              </div>
            ))}
          </div>
        ) : activityQuery.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-xs">
            <span className="text-muted-foreground">{t("dashboard.activityUnavailable")}</span>
            <Button size="sm" variant="ghost" onClick={() => void activityQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto pb-1">
              <div className="min-w-[620px] space-y-2">
                <div className="flex items-center gap-4">
                  <div className="sticky left-0 z-10 w-40 shrink-0 bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.activityProject")}
                  </div>
                  <div className="grid flex-1 grid-cols-14 gap-1.5">
                    {days.map((day, index) => (
                      <span key={day} className={cn(
                        "text-center text-[10px] tabular-nums text-muted-foreground",
                        index % 2 === 1 && "max-sm:invisible",
                      )}>
                        {Number(day.slice(8))}
                      </span>
                    ))}
                  </div>
                  <div className="w-24 shrink-0 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t("dashboard.activityDays")}
                  </div>
                </div>
                {rows.map((row) => (
                  <div key={row.group} data-motion="project-activity-row" className="group flex items-center gap-4">
                    <div className="sticky left-0 z-10 w-40 shrink-0 truncate bg-card pr-3 text-xs font-medium">
                      {row.projectId ? (
                        <Link
                          href={`/projects/${row.projectId}`}
                          className="rounded-sm outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
                          title={row.group}
                        >
                          {row.label}
                        </Link>
                      ) : (
                        <span title={row.group}>{row.label}</span>
                      )}
                      <span className="mt-1 block truncate text-[10px] font-normal text-muted-foreground">
                        {lastActiveText(row.lastActiveDay)}
                      </span>
                    </div>
                    <div className="grid flex-1 grid-cols-14 gap-1.5">
                      {days.map((day) => {
                        const total = row.totalsByDay.get(day) ?? 0;
                        const level = activityLevel(total, row.maxDailyTokens);
                        const detail = `${row.label} · ${formatDay(day)} · ${formatTokens(total)}`;
                        return (
                          <Link
                            key={day}
                            href={`/usage?range=last30&project=${encodeURIComponent(row.group)}&day=${day}`}
                            aria-label={detail}
                            title={detail}
                            data-testid={`dashboard-activity-${row.group}-${day}`}
                            className={cn(
                              "h-5 min-w-0 rounded-[4px] outline-none transition-[transform,box-shadow,background-color] duration-150 hover:scale-y-125 hover:ring-2 hover:ring-brand/25 focus-visible:z-10 focus-visible:scale-y-125 focus-visible:ring-2 focus-visible:ring-ring",
                              level === 0 && "bg-muted/60 hover:bg-muted",
                              level === 1 && "bg-brand/20",
                              level === 2 && "bg-brand/40",
                              level === 3 && "bg-brand/60",
                              level === 4 && "bg-brand",
                            )}
                          />
                        );
                      })}
                    </div>
                    <div className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {t("dashboard.activityActiveDays").replace("{count}", String(row.activeDays))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
              <span>{t("dashboard.activityScaleHint")}</span>
              <div className="flex items-center gap-1.5">
                <span>{t("dashboard.activityLess")}</span>
                {["bg-muted/60", "bg-brand/20", "bg-brand/40", "bg-brand/60", "bg-brand"].map((color) => (
                  <span key={color} className={cn("size-2.5 rounded-[2px]", color)} />
                ))}
                <span>{t("dashboard.activityMore")}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
