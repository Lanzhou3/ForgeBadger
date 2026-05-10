"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderOpen, Download, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("projects.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("projects.subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/projects/import">
            <Button variant="outline">
              <Download className="mr-2 size-4" />
              {t("common.import")}
            </Button>
          </Link>
          <Link href="/projects/new">
            <Button>
              <Plus className="mr-2 size-4" />
              {t("projects.new")}
            </Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("projects.loading")}
          </CardContent>
        </Card>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="size-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">{t("projects.emptyTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("projects.emptyDescription")}
            </p>
            <Link href="/projects/new" className="mt-4">
              <Button>
                <Plus className="mr-2 size-4" />
                {t("projects.create")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.path")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${project.id}`}
                      className="hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {project.path ?? project.rootPath}
                  </TableCell>
                  <TableCell>{project.status ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/projects/${project.id}`}>
                          {t("common.open")}
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => handleDelete(project.id)}
                        disabled={deleteMutation.isPending}
                        aria-label={`${t("projects.deleteRecord")} ${project.name}`}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
