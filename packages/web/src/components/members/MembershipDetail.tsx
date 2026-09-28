"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { teamsApi, type TeamMember } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import { TeamError, TeamBadge } from "@/components/teams/TeamShared";
import { TeamMembers } from "@/components/teams/TeamMembers";
import { TeamInvitations } from "@/components/teams/TeamInvitations";
import { TeamProjects } from "@/components/teams/TeamProjects";
import { TeamSettings } from "@/components/teams/TeamSettings";
import {
  TeamOffboarding,
  PlanRecovery,
} from "@/components/teams/TeamOffboarding";
export function MembershipDetail({ teamId }: { teamId: string }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [member, setMember] = useState<TeamMember | null>(null);
  const query = useQuery({
    queryKey: ["teams", teamId, "detail", user?.id],
    queryFn: () => teamsApi.detail(teamId),
    enabled: !!user,
    refetchInterval: 15000,
  });
  if (query.isLoading || !user)
    return (
      <section className="p-6" role="status">
        {t("common.loading")}
      </section>
    );
  if (query.isError && !query.data)
    return (
      <section className="p-6">
        <TeamError error={query.error} retry={() => void query.refetch()} />
        <PlanRecovery teamId={teamId} actorId={user.id} canResume={false} />
      </section>
    );
  if (!query.data) return null;
  const detail = query.data;
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="my-2 text-xl font-semibold">{detail.team.name}</h2>
          <TeamBadge value={detail.team.role} />{" "}
          <TeamBadge value={detail.team.state} />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          {t("workspace.refresh")}
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{t("teams.scope")}</p>
      {member && (
        <TeamOffboarding
          canResume={detail.team.capabilities.manageMembers && !query.isError}
          key={member.userId}
          teamId={teamId}
          actorId={user.id}
          member={member}
          onClose={() => setMember(null)}
        />
      )}
      {query.isError && (
        <TeamError error={query.error} retry={() => void query.refetch()} />
      )}
      {!query.isError && (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <TeamMembers
              detail={detail}
              actorId={user.id}
              onOffboard={setMember}
            />
            <TeamInvitations team={detail.team} />
          </div>
          <TeamProjects detail={detail} />
          <TeamSettings key={detail.team.revision} detail={detail} />
        </>
      )}
      <PlanRecovery
        teamId={teamId}
        actorId={user.id}
        canResume={detail.team.capabilities.manageMembers && !query.isError}
      />
    </section>
  );
}
