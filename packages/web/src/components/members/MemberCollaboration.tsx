"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { teamsApi } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import { Field, inputClass, TeamError, useTeamAction } from "@/components/teams/TeamShared";
import { MembershipDetail } from "./MembershipDetail";
export function MemberCollaboration({selectedTeamId}:{selectedTeamId:string|null}) {
  const {user}=useAuth(); const {t}=useLanguage(); const router=useRouter();
  const [name,setName]=useState(""); const action=useTeamAction();
  const query=useQuery({queryKey:["teams","list",user?.id],queryFn:teamsApi.list,enabled:!!user});
  if(query.isLoading) return <p role="status">{t("common.loading")}</p>;
  if(query.isError) return <TeamError error={query.error} retry={()=>void query.refetch()}/>;
  const teams=query.data?.teams??[];
  // Explicit stale/inaccessible links are never silently replaced by another group.
  const teamId=selectedTeamId??teams[0]?.id;
  return <section className="space-y-5">
    {!!teams.length && <Field label={t("membersHub.selectTeam")}><select className={inputClass} value={teamId??""} onChange={event=>router.push(`/members?team=${encodeURIComponent(event.target.value)}`)}>
      {selectedTeamId&&!teams.some(team=>team.id===selectedTeamId)&&<option value={selectedTeamId}>{t("teams.notFound")}</option>}
      {teams.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}
    </select></Field>}
    {teamId ? <MembershipDetail key={`${user?.id}:${teamId}`} teamId={teamId}/> : <p className="text-sm text-muted-foreground">{t("teams.empty")}</p>}
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("membersHub.createGroup")}</summary>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();action.mutate(async()=>{const {team}=await teamsApi.create(name.trim());setName("");router.push(`/members?team=${encodeURIComponent(team.id)}`);});}}>
        <Field label={t("teams.name")}><input className={inputClass} value={name} onChange={event=>setName(event.target.value)} required maxLength={100}/></Field>
        <Button disabled={!name.trim()||action.isPending}>{t("membersHub.createGroup")}</Button>
      </form><TeamError error={action.error}/>
    </details>
  </section>;
}
