"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, FolderOpen, RotateCcw, TerminalSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  listProjects,
  listSessions,
  listSnapshots,
  restoreSnapshot,
  type Session,
  type SessionSnapshot
} from "@/lib/api";
import { canRestoreSnapshot, snapshotFiltersFromSearchParams } from "@/lib/snapshot-filters";
import { QueryState } from "@/components/ui/query-state";
import { useLanguage, useUiLocale } from "@/hooks/use-language";

// Radix Select items cannot use an empty value; this sentinel maps back to
// "no filter" in onValueChange.
const ALL_FILTER_VALUE = "__all__";

// The snapshots API has no pagination parameters; the page slices the
// client-side list and offers "load more" once the list grows past one page.
const SNAPSHOT_PAGE_SIZE = 20;

export default function HistoryPage() {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const filters = snapshotFiltersFromSearchParams(searchParams);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects
  });
  const { data: sessionsData } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions
  });
  const { data: snapshotData, isLoading, isError, refetch } = useQuery({
    queryKey: ["snapshots", filters],
    queryFn: () => listSnapshots(filters)
  });
  const [restoringSnapshot, setRestoringSnapshot] = useState<{ id: string; label: string } | null>(null);
  const [visibleCount, setVisibleCount] = useState(SNAPSHOT_PAGE_SIZE);

  const projects = projectsData?.projects ?? [];
  const sessions = sessionsData?.sessions ?? [];
  const sessionsForFilter = useMemo(
    () => sessions.filter((session) => !filters.projectId || session.projectId === filters.projectId),
    [filters.projectId, sessions]
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );
  const snapshots = snapshotData?.snapshots ?? [];
  // A new filter produces a fresh (usually shorter) list: start back at one page.
  useEffect(() => {
    setVisibleCount(SNAPSHOT_PAGE_SIZE);
  }, [filters.projectId, filters.sessionId]);
  const restoreMutation = useMutation({
    mutationFn: restoreSnapshot,
    onSuccess: async ({ session }) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["snapshots"] });
      router.push(`/sessions/${session.id}`);
    }
  });

  const setFilter = (key: "projectId" | "sessionId", value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    if (key === "projectId") {
      next.delete("sessionId");
    }
    const query = next.toString();
    router.push(query ? `/history?${query}` : "/history");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("snapshots.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("snapshots.subtitle")}</p>
      </div>

      <Card className="forgebadger-animate-in">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">{t("snapshots.filters")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("snapshots.noTerminalHistory")}</p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Select
            value={filters.projectId ?? ALL_FILTER_VALUE}
            onValueChange={(value) => setFilter("projectId", value === ALL_FILTER_VALUE ? "" : value)}
          >
            <SelectTrigger aria-label={t("common.project")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>{t("snapshots.allProjects")}</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.sessionId ?? ALL_FILTER_VALUE}
            onValueChange={(value) => setFilter("sessionId", value === ALL_FILTER_VALUE ? "" : value)}
          >
            <SelectTrigger aria-label={t("snapshots.session")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>{t("snapshots.allSessions")}</SelectItem>
              {sessionsForFilter.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  {session.name || session.runtimeSessionName || session.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {restoreMutation.error instanceof Error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive forgebadger-animate-in">
          <span className="size-1.5 shrink-0 rounded-full bg-red-400" />
          {restoreMutation.error.message}
        </div>
      )}

      <QueryState
        isLoading={isLoading}
        isError={isError}
        isEmpty={snapshots.length === 0}
        onRetry={() => void refetch()}
        loading={
          <Card className="forgebadger-animate-in">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {t("snapshots.loading")}
            </CardContent>
          </Card>
        }
        empty={
          <Card className="forgebadger-animate-in">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Clock3 className="size-5" />
              </div>
              <div>
                <div className="text-sm font-medium">{t("snapshots.emptyTitle")}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("snapshots.emptyDescription")}
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/sessions">{t("snapshots.viewSession")}</Link>
              </Button>
            </CardContent>
          </Card>
        }
      >
        <div className="space-y-3">
          {snapshots.slice(0, visibleCount).map((snapshot, index) => (
            <div
              key={snapshot.id}
              className="forgebadger-animate-in"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <SnapshotCard
                snapshot={snapshot}
                session={snapshot.sessionId ? sessionById.get(snapshot.sessionId) : undefined}
                projectName={snapshot.projectId ? projectById.get(snapshot.projectId)?.name : undefined}
                canRestore={canRestoreSnapshot(snapshot)}
                restoring={restoreMutation.isPending}
                onRestore={() => {
                  const session = snapshot.sessionId ? sessionById.get(snapshot.sessionId) : undefined;
                  const label = [
                    snapshot.projectId ? projectById.get(snapshot.projectId)?.name : undefined,
                    session?.name || session?.runtimeSessionName,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  setRestoringSnapshot({ id: snapshot.id, label });
                }}
              />
            </div>
          ))}
          {snapshots.length > visibleCount && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setVisibleCount((count) => count + SNAPSHOT_PAGE_SIZE)}
              >
                {t("snapshots.loadMore")}
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("snapshots.showingCount")
                  .replace("{shown}", String(Math.min(visibleCount, snapshots.length)))
                  .replace("{total}", String(snapshots.length))}
              </span>
            </div>
          )}
        </div>
      </QueryState>

      <ConfirmDialog
        open={restoringSnapshot !== null}
        pending={restoreMutation.isPending}
        title={t("snapshots.restoreTitle")}
        description={
          restoringSnapshot
            ? [restoringSnapshot.label, t("snapshots.restoreConfirm")].filter(Boolean).join(" ")
            : ""
        }
        onOpenChange={(open) => {
          if (!open) setRestoringSnapshot(null);
        }}
        onConfirm={() => {
          if (restoringSnapshot) restoreMutation.mutate(restoringSnapshot.id);
          setRestoringSnapshot(null);
        }}
      />
    </div>
  );
}

function SnapshotCard({
  snapshot,
  session,
  projectName,
  canRestore,
  restoring,
  onRestore
}: {
  snapshot: SessionSnapshot;
  session?: Session;
  projectName?: string;
  canRestore: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const { t } = useLanguage();
  const locale = useUiLocale();

  return (
    <Card className="transition-colors duration-200 hover:border-brand/30">
      <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <TerminalSquare className="size-3" />
              {session?.name || snapshot.sessionId || t("snapshots.session")}
            </Badge>
            {session?.aiTool && <CliBrandChip aiTool={session.aiTool} />}
            {projectName && (
              <Badge variant="outline" className="gap-1">
                <FolderOpen className="size-3" />
                {projectName}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {formatSnapshotTime(snapshot.createdAt, locale)}
            </span>
          </div>
          <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
            <SnapshotField label={t("snapshots.runtimeSessionName")} value={snapshot.runtimeSessionName} />
            <SnapshotField label={t("snapshots.model")} value={snapshot.modelId} />
            <SnapshotField label={t("snapshots.configVersion")} value={snapshot.configVersion} />
          </dl>
        </div>
        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
          {snapshot.projectId && (
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link href={`/projects/${snapshot.projectId}`}>
                {t("snapshots.viewProject")}
              </Link>
            </Button>
          )}
          {snapshot.sessionId && (
            <Button
              asChild
              size="sm"
              variant="brand"
            >
              <Link href={`/sessions/${snapshot.sessionId}`}>
                {t("snapshots.viewSession")}
              </Link>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canRestore || restoring}
            onClick={onRestore}
          >
            <RotateCcw className="size-3.5" />
            {restoring ? t("snapshots.restoring") : t("snapshots.restore")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SnapshotField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs">{value || "-"}</dd>
    </div>
  );
}

function formatSnapshotTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(locale);
}
