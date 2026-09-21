"use client";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { getProjectTaskContext } from "@/lib/project-task-api";
import { collaborationApi } from "@/lib/collaboration-api";
import PrivateProjectPage from "@/components/projects/PrivateProjectPage";
import { ProjectManagerPanel } from "@/components/projects/ProjectManagerPanel";
import { ErrorNotice } from "@/components/workspaces/WorkspaceShared";
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const context = useQuery({
    queryKey: ["project-task-context", id, user?.id],
    queryFn: () => getProjectTaskContext(id),
    enabled: !!user,
    retry: false,
    refetchInterval: 30_000,
  });
  const detail = useQuery({
    queryKey: ["collaboration", id, "project", user?.id],
    queryFn: () => collaborationApi.project(id),
    enabled: !!context.data,
    retry: false,
    refetchInterval: 30_000,
  });
  const error = context.error ?? detail.error;
  if (error)
    return (
      <main className="p-6">
        <ErrorNotice
          error={error}
          retry={() => {
            void context.refetch();
            void detail.refetch();
          }}
        />
      </main>
    );
  if (!context.data || !detail.data || !user)
    return (
      <main role="status" className="p-6">
        {t("common.loading")}
      </main>
    );
  const authority = {
    canEdit: context.data.access.capabilities.some(
      (c) => c === "develop" || c === "manage",
    ),
    canManage: context.data.access.capabilities.includes("manage"),
    legacySessions: context.data.privateDetailAllowed && !context.data.revisionRequired,
    collaboration: detail.data,
    actorId: user.id,
  };
  if (context.data.privateDetailAllowed)
    return <PrivateProjectPage key={`${user?.id}:${id}`} taskAuthority={authority} />;
  return (
    <main className="mx-auto max-w-[1500px] space-y-5 p-4 pt-16 md:p-6">
      <Link href="/projects" className="text-sm text-muted-foreground">
        ← {t("nav.projects")}
      </Link>
      <h1 className="text-xl font-semibold">{context.data.project.name}</h1>
      <h2 className="text-sm font-medium">{t("projects.devTasks")}</h2>
        <ProjectManagerPanel
          key={`${user?.id}:${id}`}
          projectId={id}
          enabled
          selectedWorkItemId={search.get("workItemId") ?? search.get("task")}
          authority={authority}
        />
    </main>
  );
}
