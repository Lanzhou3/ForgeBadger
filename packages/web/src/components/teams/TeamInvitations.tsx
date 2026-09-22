"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { teamsApi, type Team } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import {
  Field,
  Panel,
  inputClass,
  TeamError,
  TeamBadge,
  CopyLink,
  useTeamAction,
} from "./TeamShared";
export function TeamInvitations({ team }: { team: Team }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [hours, setHours] = useState(24);
  const [link, setLink] = useState("");
  const action = useTeamAction(team.id);
  const query = useQuery({
    queryKey: ["teams", team.id, "invitations", user?.id],
    queryFn: () => teamsApi.invitations(team.id),
    enabled: team.capabilities.inviteMembers,
  });
  if (!team.capabilities.inviteMembers) return null;
  return (
    <Panel title={t("teams.invitations")}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          action.mutate(async () => {
            const result = await teamsApi.invite(
              team.id,
              email.trim(),
              role,
              hours,
            );
            setLink(
              `${location.origin}/join#token=${encodeURIComponent(result.token)}`,
            );
            setEmail("");
          });
        }}
      >
        <Field label={t("teams.email")}>
          <input
            className={inputClass}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={action.isPending}
          />
        </Field>
        <Field label={t("teams.role")}>
          <select
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
            disabled={action.isPending}
          >
            <option value="member">{t("teams.member")}</option>
            {team.capabilities.inviteAdmins && (
              <option value="admin">{t("teams.admin")}</option>
            )}
          </select>
        </Field>
        <Field label={t("teams.hours")}>
          <input
            className={inputClass}
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </Field>
        <Button
          className="self-end"
          disabled={action.isPending || team.state !== "active"}
        >
          {t("teams.invite")}
        </Button>
      </form>
      {link && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">{t("teams.oneTime")}</p>
          <CopyLink value={link} />
        </div>
      )}
      <TeamError error={action.error} />
      {query.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : query.isError ? (
        <TeamError error={query.error} retry={() => void query.refetch()} />
      ) : query.data?.invitations.length ? (
        <ul className="divide-y divide-border/70">
          {query.data.invitations.map((i) => (
            <li
              className="flex flex-wrap items-center justify-between gap-2 py-3"
              key={i.id}
            >
              <div className="min-w-0 space-y-1">
                <p className="break-all text-sm">{i.email}</p>
                <TeamBadge value={i.role} /> <TeamBadge value={i.state} />
                <p className="text-xs text-muted-foreground">
                  {t("teams.expires")}: {new Date(i.expiresAt).toLocaleString()}
                </p>
              </div>
              {i.state === "pending" &&
                (i.role === "member" || team.capabilities.inviteAdmins) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate(() => teamsApi.revoke(team.id, i.id))
                    }
                  >
                    {t("teams.revoke")}
                  </Button>
                )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("teams.noInvites")}</p>
      )}
    </Panel>
  );
}
