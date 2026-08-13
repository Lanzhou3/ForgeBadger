"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, FolderOpen, RotateCcw, TerminalSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import {
  listProjects,
  listSessions,
  listSnapshots,
  restoreSnapshot,
  type Session,
  type SessionSnapshot
} from "@/lib/api";
import { canRestoreSnapshot, snapshotFiltersFromSearchParams } from "@/lib/snapshot-filters";
import { useLanguage } from "@/hooks/use-language";

export default function HistoryPage() {
  const { t } = useLanguage();
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
  const { data: snapshotData, isLoading } = useQuery({
    queryKey: ["snapshots", filters],
    queryFn: () => listSnapshots(filters)
  });

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

      <Card className="of-animate-in">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">{t("snapshots.filters")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("snapshots.noTerminalHistory")}</p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={filters.projectId ?? ""}
            onChange={(event) => setFilter("projectId", event.target.value)}
            aria-label={t("common.project")}
          >
            <option value="">{t("snapshots.allProjects")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={filters.sessionId ?? ""}
            onChange={(event) => setFilter("sessionId", event.target.value)}
            aria-label={t("snapshots.session")}
          >
            <option value="">{t("snapshots.allSessions")}</option>
            {sessionsForFilter.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name || session.tmuxName || session.id}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {restoreMutation.error instanceof Error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive of-animate-in">
          <span className="size-1.5 shrink-0 rounded-full bg-red-400" />
          {restoreMutation.error.message}
        </div>
      )}

      {isLoading ? (
        <Card className="of-animate-in">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("snapshots.loading")}
          </CardContent>
        </Card>
      ) : snapshots.length === 0 ? (
        <Card className="of-animate-in">
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
      ) : (
        <div className="space-y-3">
          {snapshots.map((snapshot, index) => (
            <div
              key={snapshot.id}
              className="of-animate-in"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <SnapshotCard
                snapshot={snapshot}
                session={snapshot.sessionId ? sessionById.get(snapshot.sessionId) : undefined}
                projectName={snapshot.projectId ? projectById.get(snapshot.projectId)?.name : undefined}
                canRestore={canRestoreSnapshot(snapshot)}
                restoring={restoreMutation.isPending}
                onRestore={() => {
                  if (window.confirm(t("snapshots.restoreConfirm"))) {
                    restoreMutation.mutate(snapshot.id);
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}
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
              {formatSnapshotTime(snapshot.createdAt)}
            </span>
          </div>
          <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
            <SnapshotField label={t("snapshots.tmuxSession")} value={snapshot.tmuxSession} />
            <SnapshotField label={t("snapshots.model")} value={snapshot.modelId} />
            <SnapshotField label={t("snapshots.agent")} value={snapshot.agentId} />
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
              className="bg-brand text-brand-foreground hover:bg-brand/90"
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

function formatSnapshotTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
