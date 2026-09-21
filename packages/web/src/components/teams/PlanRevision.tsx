"use client";
import { useState } from "react";
import { useLanguage } from "@/hooks/use-language";
import {
  teamsApi,
  type HandoffSelection,
  type OffboardingImpact,
  type OffboardingPlan,
} from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import { Field, inputClass, TeamError, useTeamAction } from "./TeamShared";
interface Props {
  teamId: string;
  plan: OffboardingPlan;
  impact: OffboardingImpact;
  onSaved: () => void;
  onCancel: () => void;
  onReload: () => Promise<void>;
}
export function PlanRevision({
  teamId,
  plan,
  impact,
  onSaved,
  onCancel,
  onReload,
}: Props) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<
    Record<string, Partial<HandoffSelection>>
  >({});
  const [preview, setPreview] = useState(false);
  const action = useTeamAction(teamId);
  const valid = impact.projects.every((p) => {
    const s = selected[p.projectId];
    return (
      s &&
      (!p.requiresOwnerTransfer || s.newOwnerId) &&
      (s.assigneeId === null || Boolean(s.assigneeId)) &&
      (s.reviewerId === null || Boolean(s.reviewerId))
    );
  });
  function choose(
    projectId: string,
    field: keyof HandoffSelection,
    value: string,
  ) {
    setSelected((old) => ({
      ...old,
      [projectId]: {
        ...old[projectId],
        projectId,
        [field]: value === "__clear__" ? null : value,
      },
    }));
  }
  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 p-3">
      <h3 className="text-sm font-semibold">{t("teams.revise")}</h3>
      <p className="text-sm text-muted-foreground">{t("teams.reviseHint")}</p>
      <p className="text-xs">
        {t("teams.planId")}: {plan.id} · {plan.revision}
      </p>
      {impact.projects.map((p) => (
        <div
          key={p.projectId}
          className="space-y-3 border-t border-border/70 pt-3"
        >
          <h4 className="text-sm font-medium">{p.name}</h4>
          <ul className="text-xs text-muted-foreground">
            {p.tasks.map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
            {p.runs.map((run) => (
              <li key={run.id}>
                {run.id} · {run.state}
              </li>
            ))}
          </ul>
          {preview ? (
            <div className="space-y-1 text-sm">
              {p.requiresOwnerTransfer && (
                <p>
                  {t("teams.newOwner")}:{" "}
                  {
                    p.eligibleOwners.find(
                      (o) => o.userId === selected[p.projectId]?.newOwnerId,
                    )?.label
                  }
                </p>
              )}
              <p>
                {t("teams.assignee")}:{" "}
                {selected[p.projectId]?.assigneeId
                  ? p.eligibleAssignees.find(
                      (o) => o.userId === selected[p.projectId]?.assigneeId,
                    )?.label
                  : t("teams.unassign")}
              </p>
              <p>
                {t("teams.reviewer")}:{" "}
                {selected[p.projectId]?.reviewerId
                  ? p.eligibleReviewers.find(
                      (o) => o.userId === selected[p.projectId]?.reviewerId,
                    )?.label
                  : t("teams.unassign")}
              </p>
            </div>
          ) : (
            <fieldset
              disabled={action.isPending}
              className="grid gap-3 sm:grid-cols-3"
            >
              {p.requiresOwnerTransfer && (
                <Choice
                  label={t("teams.newOwner")}
                  value={selected[p.projectId]?.newOwnerId}
                  options={p.eligibleOwners}
                  onChange={(v) => choose(p.projectId, "newOwnerId", v)}
                />
              )}
              <Choice
                clear
                label={t("teams.assignee")}
                value={selected[p.projectId]?.assigneeId}
                options={p.eligibleAssignees}
                onChange={(v) => choose(p.projectId, "assigneeId", v)}
              />
              <Choice
                clear
                label={t("teams.reviewer")}
                value={selected[p.projectId]?.reviewerId}
                options={p.eligibleReviewers}
                onChange={(v) => choose(p.projectId, "reviewerId", v)}
              />
            </fieldset>
          )}
        </div>
      ))}
      {!impact.projects.length && <p>{t("teams.noImpact")}</p>}
      <div className="flex flex-wrap gap-2">
        {preview ? (
          <Button
            disabled={action.isPending || !valid}
            onClick={() =>
              action.mutate(async () => {
                const handoffs = Object.values(selected).filter(
                  (s): s is HandoffSelection =>
                    !!s.projectId &&
                    s.assigneeId !== undefined &&
                    s.reviewerId !== undefined,
                );
                await teamsApi.revisePlan(
                  teamId,
                  plan.id,
                  plan.revision,
                  impact.impactDigest,
                  handoffs,
                );
                onSaved();
              })
            }
          >
            {t("teams.confirmRevision")}
          </Button>
        ) : (
          <Button
            disabled={!valid || action.isPending}
            onClick={() => setPreview(true)}
          >
            {t("teams.preview")}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={action.isPending}
          onClick={() => action.mutate(onReload)}
        >
          {t("teams.reloadImpact")}
        </Button>
        <Button variant="ghost" disabled={action.isPending} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
      <TeamError error={action.error} />
    </div>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
  clear,
}: {
  label: string;
  value: string | null | undefined;
  options: { userId: string; label: string }[];
  onChange: (value: string) => void;
  clear?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Field label={label}>
      <select
        className={inputClass}
        value={value === null ? "__clear__" : (value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("teams.select")}</option>
        {clear && <option value="__clear__">{t("teams.unassign")}</option>}
        {options.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
