"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Download, FolderOpen, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { deleteProject, listProjects } from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

export default function ProjectsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const handleDelete = (projectId: string) => {
    if (window.confirm(t("projects.deleteConfirm"))) {
      deleteMutation.mutate(projectId);
    }
  };

  const projects = data?.projects ?? [];

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

      {isLoading ? (
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
              className="of-animate-in flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
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
                    {project.path ?? project.rootPath}
                  </div>
                </div>
                {project.aiTool ? <CliBrandChip aiTool={project.aiTool} /> : null}
                <span className="hidden w-20 shrink-0 truncate text-right text-xs text-muted-foreground sm:inline">
                  {project.status ?? "—"}
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-brand" />
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(project.id)}
                disabled={deleteMutation.isPending}
                aria-label={`${t("projects.deleteRecord")} ${project.name}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
