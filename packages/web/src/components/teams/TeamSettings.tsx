"use client";
import { useState } from "react";
import { useLanguage } from "@/hooks/use-language";
import { teamsApi, type TeamDetail } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import {
  Field,
  Panel,
  inputClass,
  TeamError,
  useTeamAction,
} from "./TeamShared";
export function TeamSettings({ detail }: { detail: TeamDetail }) {
  const { t } = useLanguage();
  const { team, members } = detail;
  const [name, setName] = useState(team.name);
  const [owner, setOwner] = useState("");
  const [confirm, setConfirm] = useState<"transfer" | "close" | null>(null);
  const action = useTeamAction(team.id);
  if (!team.capabilities.manageMembers) return null;
  return (
    <Panel title={t("membersHub.administration")}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          action.mutate(() =>
            teamsApi.rename(team.id, name.trim(), team.revision),
          );
        }}
      >
        <Field label={t("teams.name")}>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </Field>
        <Button disabled={action.isPending || !name.trim()}>
          {t("common.save")}
        </Button>
      </form>
      {team.capabilities.transferOwner && (
        <>
          <Field label={t("teams.newOwner")}>
            <select
              className={inputClass}
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                setConfirm(null);
              }}
            >
              <option value="">{t("teams.select")}</option>
              {members
                .filter(
                  (m) => m.state === "active" && m.userId !== team.ownerId,
                )
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.email}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            variant="outline"
            disabled={!owner || action.isPending}
            onClick={() => setConfirm("transfer")}
          >
            {t("teams.transfer")}
          </Button>
        </>
      )}
      {team.capabilities.close && (
        <Button
          className="ml-2"
          variant="outline"
          disabled={action.isPending || team.state === "closed"}
          onClick={() => setConfirm("close")}
        >
          {t("teams.close")}
        </Button>
      )}
      {confirm && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm">
            {t(
              confirm === "transfer" ? "teams.transferHint" : "teams.closeHint",
            )}
            {confirm === "transfer" && (
              <strong className="ml-2">
                {members.find((m) => m.userId === owner)?.email}
              </strong>
            )}
          </p>
          <Button
            disabled={action.isPending}
            onClick={() =>
              action.mutate(async () => {
                if (confirm === "transfer")
                  await teamsApi.transfer(team.id, owner, team.revision);
                else await teamsApi.close(team.id, team.revision);
                setConfirm(null);
              })
            }
          >
            {t("teams.confirm")}
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
      <TeamError error={action.error} />
    </Panel>
  );
}
