"use client";
import { useState } from "react";
import { useLanguage } from "@/hooks/use-language";
import { teamsApi, type TeamDetail, type TeamMember } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import {
  Panel,
  TeamBadge,
  TeamError,
  useTeamAction,
  inputClass,
} from "./TeamShared";
export function TeamMembers({
  detail,
  actorId,
  onOffboard,
}: {
  detail: TeamDetail;
  actorId: string;
  onOffboard: (member: TeamMember) => void;
}) {
  const { t } = useLanguage();
  const { team, members } = detail;
  return (
    <Panel title={t("teams.members")}>
      <ul className="divide-y divide-border/70">
        {members.map((m) => (
          <li className="space-y-2 py-3" key={m.userId}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all text-sm">{m.email}</span>
              <TeamBadge value={m.role} />
              <TeamBadge value={m.state} />
            </div>
            <div className="flex flex-wrap gap-2">
              {m.state === "active" &&
                m.role !== "owner" &&
                team.capabilities.manageAdmins &&
                m.userId !== actorId && (
                  <RoleEditor
                    key={`${m.userId}:${m.revision}`}
                    teamId={team.id}
                    member={m}
                  />
                )}{" "}
              {m.state !== "left" &&
                (m.userId === actorId ||
                  (m.role !== "owner" &&
                    (team.capabilities.manageAdmins ||
                      (team.capabilities.manageMembers &&
                        m.role === "member")))) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOffboard(m)}
                  >
                    {t(m.userId === actorId ? "teams.leave" : "teams.offboard")}
                  </Button>
                )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
function RoleEditor({
  teamId,
  member,
}: {
  teamId: string;
  member: TeamMember;
}) {
  const { t } = useLanguage();
  const [role, setRole] = useState(
    member.role === "admin" ? "admin" : "member",
  );
  const action = useTeamAction(teamId);
  return (
    <div className="flex flex-wrap gap-2">
      <select
        aria-label={`${t("teams.role")}: ${member.email}`}
        className={inputClass}
        value={role}
        onChange={(e) => setRole(e.target.value)}
        disabled={action.isPending}
      >
        <option value="member">{t("teams.member")}</option>
        <option value="admin">{t("teams.admin")}</option>
      </select>
      <Button
        size="sm"
        disabled={action.isPending || role === member.role}
        onClick={() =>
          action.mutate(() =>
            teamsApi.member(
              teamId,
              member.userId,
              role as "admin" | "member",
              member.revision,
            ),
          )
        }
      >
        {t("common.save")}
      </Button>
      <TeamError error={action.error} />
    </div>
  );
}
