"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { teamsApi, type TeamDetail, type TeamProject } from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import {
  Field,
  Panel,
  inputClass,
  TeamError,
  useTeamAction,
} from "./TeamShared";
export function TeamProjects({ detail }: { detail: TeamDetail }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { team, projects } = detail;
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const action = useTeamAction(team.id);
  const candidates = useQuery({
    queryKey: ["teams", team.id, "candidates", user?.id],
    queryFn: () => teamsApi.candidates(team.id),
    enabled: team.capabilities.enrollOwnProjects,
  });
  const candidate = candidates.data?.projects.find((p) => p.id === selected);
  return (
    <Panel title={t("teams.projects")}>
      <ul className="divide-y divide-border/70">
        {projects.map((p) => (
          <li className="space-y-3 py-3" key={p.projectId}>
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-sm font-medium">{p.name}</span>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/members?project=${encodeURIComponent(p.projectId)}`}>
                  {t("teams.openProject")}
                </Link>
              </Button>
            </div>
            {p.capabilities.includes("manage") && (
              <ProjectTransfer
                key={`${p.projectId}:${p.revision}`}
                project={p}
                detail={detail}
              />
            )}
          </li>
        ))}
      </ul>
      {!projects.length && (
        <p className="text-sm text-muted-foreground">{t("teams.noProjects")}</p>
      )}
      {team.capabilities.enrollOwnProjects && (
        <div className="space-y-3 border-t border-border pt-3">
          <h3 className="text-sm font-medium">{t("teams.enroll")}</h3>
          {candidates.isLoading ? (
            <p>{t("common.loading")}</p>
          ) : candidates.isError ? (
            <TeamError
              error={candidates.error}
              retry={() => void candidates.refetch()}
            />
          ) : !candidates.data?.projects.length ? (
            <p className="text-sm text-muted-foreground">
              {t("teams.noCandidates")}
            </p>
          ) : (
            <>
              <Field label={t("common.project")}>
                <select
                  className={inputClass}
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">{t("teams.select")}</option>
                  {candidates.data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t("teams.enrollHint")}
              </label>
              <Button
                disabled={!candidate || !confirmed || action.isPending}
                onClick={() =>
                  candidate &&
                  action.mutate(async () => {
                    await teamsApi.enroll(
                      team.id,
                      candidate.id,
                      candidate.revision,
                      team.revision,
                    );
                    setSelected("");
                    setConfirmed(false);
                  })
                }
              >
                {t("teams.enroll")}
              </Button>
            </>
          )}
        </div>
      )}
      <TeamError error={action.error} />
    </Panel>
  );
}
function ProjectTransfer({
  project,
  detail,
}: {
  project: TeamProject;
  detail: TeamDetail;
}) {
  const { t } = useLanguage();
  const [newOwner, setNewOwner] = useState("");
  const [confirm, setConfirm] = useState(false);
  const action = useTeamAction(detail.team.id);
  return (
    <div className="space-y-2 rounded-md border border-border/70 p-3">
      <Field label={t("teams.newOwner")}>
        <select
          className={inputClass}
          value={newOwner}
          onChange={(e) => {
            setNewOwner(e.target.value);
            setConfirm(false);
          }}
        >
          <option value="">{t("teams.select")}</option>
          {detail.members
            .filter(
              (m) =>
                m.state === "active" && m.userId !== project.logicalOwnerId,
            )
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
        </select>
      </Field>
      <Button
        size="sm"
        variant="outline"
        disabled={!newOwner || action.isPending}
        onClick={() => setConfirm(true)}
      >
        {t("teams.transferProject")}
      </Button>
      {confirm && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs">
            {project.name} →{" "}
            {detail.members.find((m) => m.userId === newOwner)?.email}
          </p>
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(() =>
                teamsApi.transferProject(
                  detail.team.id,
                  project.projectId,
                  newOwner,
                  project.revision,
                ),
              )
            }
          >
            {t("teams.confirm")}
          </Button>
        </div>
      )}
      <TeamError error={action.error} />
    </div>
  );
}
