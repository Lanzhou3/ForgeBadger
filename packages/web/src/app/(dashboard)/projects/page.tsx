"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bot,
  Copy,
  Download,
  FolderGit2,
  FolderOpen,
  GitBranch,
  ListChecks,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";

import { SessionLaunchDialog } from "@/components/sessions/session-launch-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTile } from "@/components/ui/icon-tile";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorNotice } from "@/components/workspaces/WorkspaceShared";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import {
  deleteProject,
  getProjectGitSummaries,
  listProjects,
  listSessions,
  type Session,
} from "@/lib/api";
import { collaborationApi } from "@/lib/collaboration-api";
import { listGoals } from "@/lib/copilot-api";
import { listFleets } from "@/lib/fleet-api";
import { getProjectOverview } from "@/lib/platform-actions-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ProjectFilter = "all" | "running" | "dirty" | "shared";
type ProjectSort = "recent" | "name" | "sessions";

interface ProjectRowView {
  id: string;
  name: string;
  description?: string | null;
  path?: string;
  isOwned: boolean;
  roleLabel: string | null;
  runningSessions: number;
  totalSessions: number;
  lastActivityTs: number;
  isGitRepo: boolean;
  branch: string | null;
  changedCount: number;
  taskDone: number;
  taskTotal: number;
  activeFleetCount: number;
  activeGoalCount: number;
}

function isLiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "running" || s === "active" || s === "busy" || s === "idle";
}

export default function ProjectsPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useAuth();
  const client = useQueryClient();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [sort, setSort] = useState<ProjectSort>("recent");
  const [deletingProject, setDeletingProject] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [launchProject, setLaunchProject] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const deletion = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["projects"] });
      await client.invalidateQueries({ queryKey: ["collaboration", "projects"] });
      await client.invalidateQueries({ queryKey: ["projects-overview"] });
      await client.invalidateQueries({ queryKey: ["project-git-summaries"] });
    },
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["projects", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: listProjects,
  });

  const sharedQuery = useQuery({
    queryKey: ["collaboration", "projects", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: collaborationApi.projects,
  });

  const gitSummariesQuery = useQuery({
    queryKey: ["project-git-summaries", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: getProjectGitSummaries,
    retry: false,
  });

  const overviewQuery = useQuery({
    queryKey: ["projects-overview", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: getProjectOverview,
    retry: false,
  });

  const sessionsQuery = useQuery({
    queryKey: ["sessions", user?.id],
    enabled: !!user,
    staleTime: 15_000,
    queryFn: () => listSessions(),
    retry: false,
  });

  const fleetsQuery = useQuery({
    queryKey: ["fleets", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: listFleets,
    retry: false,
  });

  const goalsQuery = useQuery({
    queryKey: ["copilot-goals", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: () => listGoals(),
    retry: false,
  });

  const rows = useMemo<ProjectRowView[]>(() => {
    const owned = data?.projects ?? [];
    const sharedProjects = sharedQuery.data?.projects ?? [];
    const gitSummaries = gitSummariesQuery.data?.summaries ?? {};
    const overviewByProject = new Map(
      (overviewQuery.data?.projects ?? []).map((item) => [item.id, item]),
    );

    const sessionsByProject = new Map<string, Session[]>();
    for (const session of sessionsQuery.data?.sessions ?? []) {
      if (!session.projectId) continue;
      const list = sessionsByProject.get(session.projectId);
      if (list) list.push(session);
      else sessionsByProject.set(session.projectId, [session]);
    }

    const fleetCountByProject = new Map<string, number>();
    for (const fleet of fleetsQuery.data?.fleets ?? []) {
      if (fleet.status === "running" || fleet.status === "paused") {
        fleetCountByProject.set(
          fleet.projectId,
          (fleetCountByProject.get(fleet.projectId) ?? 0) + 1,
        );
      }
    }

    const goalCountByProject = new Map<string, number>();
    for (const goal of goalsQuery.data?.goals ?? []) {
      if (!goal.projectId) continue;
      if (goal.status === "active" || goal.status === "blocked") {
        goalCountByProject.set(
          goal.projectId,
          (goalCountByProject.get(goal.projectId) ?? 0) + 1,
        );
      }
    }

    const buildMetrics = (id: string) => {
      const projSessions = sessionsByProject.get(id) ?? [];
      let runningSessions = 0;
      let lastActivityTs = 0;
      for (const s of projSessions) {
        if (isLiveStatus(s.status)) runningSessions += 1;
        if (s.lastActive) {
          const ts = Date.parse(s.lastActive);
          if (Number.isFinite(ts) && ts > lastActivityTs) lastActivityTs = ts;
        }
      }
      const git = gitSummaries[id];
      const overview = overviewByProject.get(id);
      return {
        runningSessions,
        totalSessions: projSessions.length,
        lastActivityTs,
        isGitRepo: git?.isGitRepo ?? false,
        branch: git?.branch ?? null,
        changedCount: git?.changedCount ?? 0,
        taskDone: overview?.counts.done ?? 0,
        taskTotal: overview?.counts.total ?? 0,
        activeFleetCount: fleetCountByProject.get(id) ?? 0,
        activeGoalCount: goalCountByProject.get(id) ?? 0,
      };
    };

    const ownedIds = new Set(owned.map((p) => p.id));
    const list: ProjectRowView[] = owned.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      path: p.rootPath ?? p.path,
      isOwned: true,
      roleLabel: null,
      ...buildMetrics(p.id),
    }));

    for (const sp of sharedProjects) {
      if (ownedIds.has(sp.id)) continue;
      list.push({
        id: sp.id,
        name: sp.name,
        description: sp.description,
        path: undefined,
        isOwned: false,
        roleLabel: sp.role,
        ...buildMetrics(sp.id),
      });
    }

    return list;
  }, [
    data?.projects,
    fleetsQuery.data?.fleets,
    gitSummariesQuery.data?.summaries,
    goalsQuery.data?.goals,
    overviewQuery.data?.projects,
    sessionsQuery.data?.sessions,
    sharedQuery.data?.projects,
  ]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = rows.filter((row) => {
      if (filter === "running") {
        if (
          row.runningSessions === 0 &&
          row.activeFleetCount === 0 &&
          row.activeGoalCount === 0
        ) {
          return false;
        }
      } else if (filter === "dirty") {
        if (!row.isGitRepo || row.changedCount === 0) return false;
      } else if (filter === "shared") {
        if (row.isOwned) return false;
      }

      if (!query) return true;
      return (
        row.name.toLowerCase().includes(query) ||
        (row.path?.toLowerCase().includes(query) ?? false) ||
        (row.description?.toLowerCase().includes(query) ?? false)
      );
    });

    return [...matched].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "sessions") {
        if (b.runningSessions !== a.runningSessions) {
          return b.runningSessions - a.runningSessions;
        }
        return a.name.localeCompare(b.name);
      }
      // "recent"
      const aScore = a.lastActivityTs + (a.runningSessions > 0 ? 1e12 : 0);
      const bScore = b.lastActivityTs + (b.runningSessions > 0 ? 1e12 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });
  }, [filter, rows, search, sort]);

  async function handleCopyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(t("projects.pathCopied"));
    } catch {
      // Clipboard API unavailable.
    }
  }

  const loadError = error ?? sharedQuery.error;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("projects.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("projects.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/projects/import">
              <Download className="size-4" />
              {t("projects.import")}
            </Link>
          </Button>
          <Button asChild variant="brand" size="sm">
            <Link href="/projects/new">
              <Plus className="size-4" />
              {t("projects.create")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Search, filter & sort bar */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("projects.searchPlaceholder")}
                className="h-9 pl-8"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1">
              {(
                [
                  ["all", t("projects.filterAll")],
                  ["running", t("projects.filterRunning")],
                  ["dirty", t("projects.filterGitDirty")],
                  ["shared", t("projects.filterShared")],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={filter === key ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <Select value={sort} onValueChange={(value) => setSort(value as ProjectSort)}>
            <SelectTrigger className="h-9 w-[170px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">{t("projects.sortRecent")}</SelectItem>
              <SelectItem value="name">{t("projects.sortName")}</SelectItem>
              <SelectItem value="sessions">{t("projects.sortSessions")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <ErrorNotice error={deletion.error} />

      {loadError ? (
        <ErrorNotice
          error={loadError}
          retry={() => {
            void refetch();
            void sharedQuery.refetch();
          }}
        />
      ) : isLoading || sharedQuery.isLoading ? (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card shadow-card">
          {[1, 2, 3].map((row) => (
            <div key={row} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="space-y-2">
                <div className="h-4 w-44 animate-pulse rounded bg-muted" />
                <div className="h-3 w-72 animate-pulse rounded bg-muted/70" />
              </div>
              <div className="flex gap-2">
                <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
                <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <IconTile size="lg" tone="brand">
              <FolderOpen strokeWidth={1.75} />
            </IconTile>
            <div>
              <div className="text-sm font-medium">{t("projects.emptyTitle")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("projects.emptyDescription")}
              </div>
            </div>
            <Button asChild size="sm" variant="brand">
              <Link href="/projects/new">
                <Plus className="size-4" />
                {t("projects.create")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : filteredRows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="text-sm font-medium">{t("projects.emptyFilteredTitle")}</div>
            <div className="text-xs text-muted-foreground">
              {t("projects.emptyFilteredDescription")}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card shadow-card">
          {filteredRows.map((project) => (
            <div
              key={project.id}
              className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/projects/${project.id}`}
                    className="group inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                  >
                    <FolderGit2 className="size-4 text-muted-foreground" />
                    <span className="truncate">{project.name}</span>
                    <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>

                  <Badge variant="outline" className="rounded-full text-[11px] font-normal">
                    {project.isOwned ? (
                      t("projects.rolePersonal")
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3" />
                        {t("projects.roleTeam").replace("{role}", project.roleLabel ?? "member")}
                      </span>
                    )}
                  </Badge>

                  {project.runningSessions > 0 && (
                    <Badge
                      variant="secondary"
                      className="rounded-full text-[11px] text-emerald-700 dark:text-emerald-300"
                    >
                      <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
                      {t("projects.sessionsSummary")
                        .replace("{total}", String(project.totalSessions))
                        .replace("{running}", String(project.runningSessions))}
                    </Badge>
                  )}

                  {project.activeFleetCount > 0 && (
                    <Badge variant="secondary" className="rounded-full text-[11px]">
                      <Bot className="mr-1 size-3" />
                      Fleet ×{project.activeFleetCount}
                    </Badge>
                  )}

                  {project.activeGoalCount > 0 && (
                    <Badge variant="secondary" className="rounded-full text-[11px]">
                      Goal ×{project.activeGoalCount}
                    </Badge>
                  )}

                  {project.taskTotal > 0 && (
                    <Badge variant="outline" className="rounded-full text-[11px] tabular-nums">
                      <ListChecks className="mr-1 size-3 text-muted-foreground" />
                      {project.taskDone}/{project.taskTotal}
                    </Badge>
                  )}

                  {project.isGitRepo && (
                    <Badge variant="outline" className="rounded-full text-[11px] font-normal">
                      <GitBranch className="mr-1 size-3 text-muted-foreground" />
                      {project.branch || "HEAD"}
                      {project.changedCount > 0 && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400">
                          · {t("projects.gitDirtyCount").replace("{count}", String(project.changedCount))}
                        </span>
                      )}
                    </Badge>
                  )}
                </div>

                {project.description && (
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {project.description}
                  </p>
                )}

                {project.path && (
                  <p className="truncate font-mono text-xs text-muted-foreground/85">
                    {project.path}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {project.isOwned && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setLaunchProject({ id: project.id, name: project.name })
                    }
                  >
                    <Play className="size-3.5" />
                    {t("projects.quickStartSession")}
                  </Button>
                )}

                <Button asChild size="sm" variant="secondary">
                  <Link href={`/projects/${project.id}`}>
                    {t("projects.openWorkspace")}
                  </Link>
                </Button>

                {(project.path || project.isOwned) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        aria-label={t("projects.moreActions")}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {project.path && (
                        <DropdownMenuItem
                          onSelect={() => void handleCopyPath(project.path!)}
                        >
                          <Copy className="mr-2 size-3.5" />
                          {t("projects.copyPath")}
                        </DropdownMenuItem>
                      )}
                      {project.path && project.isOwned && <DropdownMenuSeparator />}
                      {project.isOwned && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() =>
                            setDeletingProject({ id: project.id, name: project.name })
                          }
                        >
                          <Trash2 className="mr-2 size-3.5" />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {launchProject && (
        <SessionLaunchDialog
          projectId={launchProject.id}
          projectName={launchProject.name}
          open={launchProject !== null}
          onOpenChange={(open) => {
            if (!open) setLaunchProject(null);
          }}
          onCreated={(session) => {
            setLaunchProject(null);
            router.push(`/sessions/${session.id}`);
          }}
        />
      )}

      <ConfirmDialog
        open={deletingProject !== null}
        destructive
        pending={deletion.isPending}
        title={t("projects.deleteConfirmTitle")}
        description={
          deletingProject
            ? t("projects.deleteConfirmNamed").replace("{name}", deletingProject.name)
            : ""
        }
        confirmLabel={t("common.delete")}
        onOpenChange={(open) => {
          if (!open) setDeletingProject(null);
        }}
        onConfirm={() => {
          if (deletingProject) deletion.mutate(deletingProject.id);
          setDeletingProject(null);
        }}
      />
    </div>
  );
}
