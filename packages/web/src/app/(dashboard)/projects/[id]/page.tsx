"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  // Both queries are independent (detail needs only the id, and it succeeds
  // for private owner projects too), so they fire in parallel — no waterfall.
  const context = useQuery({
    queryKey: ["project-task-context", id, user?.id],
    queryFn: () => getProjectTaskContext(id),
    enabled: !!user,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const detail = useQuery({
    queryKey: ["collaboration", id, "project", user?.id],
    queryFn: () => collaborationApi.project(id),
    enabled: !!user,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const error = context.error ?? detail.error;
  if (error)
    return (
      <div className="p-6">
        <ErrorNotice
          error={error}
          retry={() => {
            void context.refetch();
            void detail.refetch();
          }}
        />
      </div>
    );
  if (!context.data || !detail.data || !user)
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
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
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div className="space-y-2 border-b pb-4">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t("projects.back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {context.data.project.name}
              </h1>
              <Badge variant="outline" className="rounded-full text-xs font-normal">
                {t("projects.sharedRoleBadge").replace("{role}", context.data.access.role)}
              </Badge>
              <Badge variant="secondary" className="rounded-full text-xs font-normal">
                <Users className="mr-1 size-3" />
                {t("projects.sharedMembersCount").replace("{count}", String(detail.data.members.length))}
              </Badge>
            </div>
            {context.data.project.description && (
              <p className="max-w-3xl text-sm text-muted-foreground">
                {context.data.project.description}
              </p>
            )}
            {context.data.access.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {context.data.access.capabilities.map((cap) => (
                  <Badge
                    key={cap}
                    variant="secondary"
                    className="rounded-full font-mono text-[10px] font-normal"
                  >
                    {cap}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {context.data.access.teamId && (
            <Button asChild variant="outline" size="sm">
              <Link href="/teams">
                <Users className="size-3.5" />
                {t("projects.sharedManageTeam")}
              </Link>
            </Button>
          )}
        </div>
      </div>
      <ProjectManagerPanel
        key={`${user?.id}:${id}`}
        projectId={id}
        enabled
        selectedWorkItemId={search.get("workItemId") ?? search.get("task")}
        authority={authority}
      />
    </div>
  );
}
