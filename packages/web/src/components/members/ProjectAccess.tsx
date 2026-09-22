"use client";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { collaborationApi, hasCapability } from "@/lib/collaboration-api";
import { ErrorNotice, Field, inputClass } from "@/components/workspaces/WorkspaceShared";
import { ArchiveProject } from "@/components/workspaces/ArchiveProject";
import { ProjectMembers } from "./ProjectMembers";
export function ProjectAccess({projectId}:{projectId:string|null}) {
  const {user}=useAuth();const {t}=useLanguage();const router=useRouter();
  const query=useQuery({queryKey:["collaboration","projects",user?.id],queryFn:collaborationApi.projects,enabled:!!user});
  if(query.isLoading)return <p role="status">{t("common.loading")}</p>;
  if(query.isError)return <ErrorNotice error={query.error} retry={()=>void query.refetch()}/>;
  const projects=query.data?.projects??[];const selected=projectId??projects[0]?.id;
  return <section className="space-y-4">
    <p className="text-sm text-muted-foreground">{t("membersHub.selectProject")}</p>
    {projects.length>0&&<Field label={t("common.project")}><select className={inputClass} value={selected??""} onChange={event=>router.push(`/members?project=${encodeURIComponent(event.target.value)}`)}>
      {projectId&&!projects.some(project=>project.id===projectId)&&<option value={projectId}>{t("teams.notFound")}</option>}
      {projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
    </select></Field>}
    {selected?<ProjectAccessDetail key={`${user?.id}:${selected}`} projectId={selected}/>:<p>{t("membersHub.noProjects")}</p>}
  </section>;
}
function ProjectAccessDetail({projectId}:{projectId:string}) {
  const {user}=useAuth();const {t}=useLanguage();
  const query=useQuery({queryKey:["collaboration",projectId,"project",user?.id],queryFn:()=>collaborationApi.project(projectId),enabled:!!user,retry:false,refetchInterval:15000});
  if(query.isError)return <ErrorNotice error={query.error} retry={()=>void query.refetch()}/>;
  if(!query.data)return <p role="status">{t("common.loading")}</p>;
  return <><ProjectMembers detail={query.data}/>{hasCapability(query.data.project,"manage")&&<details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm">{t("workspace.archive")}</summary><div className="mt-3"><ArchiveProject projectId={projectId}/></div></details>}</>;
}
