"use client";

import Link from "next/link";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Download, FolderOpen, Plus, GitBranch, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listProjects, deleteProject, getProjectGitChanges } from "@/lib/api";
import { getProjectTaskContext } from "@/lib/project-task-api";
import { collaborationApi } from "@/lib/collaboration-api";
import { ErrorNotice } from "@/components/workspaces/WorkspaceShared";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

export default function ProjectsPage() {
  const { t } = useLanguage();
  const {user} = useAuth();
  const client = useQueryClient();
  const deletion = useMutation({mutationFn: deleteProject, onSuccess: async () => {await client.invalidateQueries({queryKey: ["projects"]}); await client.invalidateQueries({queryKey: ["collaboration", "projects"]});}});
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["projects", user?.id],
    enabled: !!user,
    queryFn: listProjects,
  });
  const shared = useQuery({queryKey: ["collaboration", "projects", user?.id], enabled: !!user, queryFn: collaborationApi.projects});
  const privateProjects = data?.projects ?? [];
  const projects = [...privateProjects.map(p => ({id: p.id, name: p.name, status: p.status, path: p.path ?? p.rootPath})), ...(shared.data?.projects ?? []).filter(p => !privateProjects.some(own => own.id === p.id)).map(p => ({id: p.id, name: p.name, status: p.role, path: undefined}))];
  const contexts = useQueries({queries: projects.map(p => ({queryKey: ["project-task-context", p.id, user?.id], enabled: !!user, queryFn: () => getProjectTaskContext(p.id), retry: false}))});
  const branches = useQueries({queries: projects.map((p, i) => ({queryKey: ["project", p.id, "git-branch"], queryFn: () => getProjectGitChanges(p.id), enabled: contexts[i]?.data?.privateDetailAllowed === true, staleTime: 60_000}))});
  const loadError = error ?? shared.error;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("projects.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("projects.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
            <Link href="/projects/new">
              <Plus className="size-4" />
              {t("projects.new")}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/projects/import">
              <Download className="size-4" />
              {t("common.import")}
            </Link>
          </Button>
        </div>
      </div>

      <ErrorNotice error={deletion.error} />
      {loadError ? <ErrorNotice error={loadError} retry={() => {void refetch(); void shared.refetch();}} /> : isLoading || shared.isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("projects.loading")}
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
              <FolderOpen className="size-5" />
            </div>
            <div>
              <div className="text-sm font-medium">{t("projects.emptyTitle")}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("projects.emptyDescription")}
              </p>
            </div>
            <Button asChild size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Link href="/projects/new">
                <Plus className="size-4" />
                {t("projects.create")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {projects.map((project, index) => (
            <div
              key={project.id}
              className="forgebadger-animate-in flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <Link
                href={`/projects/${project.id}`}
                className="group flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <FolderOpen className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {contexts[index]?.data?.privateDetailAllowed ? project.path : t("projects.devTasks")}
                  </div>
                </div>
                {branches[index]?.data?.branch && <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex"><GitBranch className="size-3" />{branches[index]?.data?.branch}</span>}
                <span className="hidden w-20 shrink-0 truncate text-right text-xs text-muted-foreground sm:inline">
                  {project.status ?? "—"}
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-brand" />
              </Link>
              {contexts[index]?.data?.privateDetailAllowed && <Button variant="ghost" size="icon-sm" disabled={deletion.isPending} aria-label={`${t("projects.deleteRecord")} ${project.name}`} onClick={() => {if(window.confirm(t("projects.deleteConfirm"))) deletion.mutate(project.id);}}><Trash2 className="size-4" /></Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
