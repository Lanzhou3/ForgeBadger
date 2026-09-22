"use client";
import { PlanRevision } from "./PlanRevision";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import {
  teamsApi,
  type TeamMember,
  type OffboardingImpact,
  type OffboardingPlan,
  type HandoffSelection,
} from "@/lib/teams-api";
import { Button } from "@/components/ui/button";
import {
  Field,
  Panel,
  inputClass,
  TeamError,
  useTeamAction,
} from "./TeamShared";
interface Props {
  teamId: string;
  member: TeamMember;
  onClose: () => void;
  actorId: string;
  canResume: boolean;
}
export function TeamOffboarding({
  teamId,
  member,
  onClose,
  actorId,
  canResume,
}: Props) {
  const { t } = useLanguage();
  const query = useQuery({
    queryKey: ["teams", teamId, "impact", member.userId, actorId],
    queryFn: () => teamsApi.impact(teamId, member.userId),
    retry: false,
  });
  return (
    <Panel title={`${t("teams.offboard")}: ${member.email}`}>
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t("common.close")}
      </Button>
      {query.isLoading ? (
        <p role="status">{t("common.loading")}</p>
      ) : query.isError && !query.data ? (
        <TeamError error={query.error} retry={() => void query.refetch()} />
      ) : (
        query.data && (
          <ImpactForm
            key={member.userId}
            teamId={teamId}
            impact={query.data.impact}
            actorId={actorId}
            canResume={canResume}
          />
        )
      )}
    </Panel>
  );
}
function ImpactForm({
  teamId,
  impact,
  actorId,
  canResume,
}: {
  teamId: string;
  impact: OffboardingImpact;
  actorId: string;
  canResume: boolean;
}) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<
    Record<string, Partial<HandoffSelection>>
  >({});
  const [snapshot, setSnapshot] = useState<HandoffSelection[]>([]);
  const [previewImpact, setPreviewImpact] = useState<OffboardingImpact | null>(
    null,
  );
  const [plan, setPlan] = useState<OffboardingPlan | null>(null);
  const [token, setToken] = useState("");
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
  const choose = (id: string, field: keyof HandoffSelection, value: string) =>
    setSelected((old) => ({
      ...old,
      [id]: {
        ...old[id],
        projectId: id,
        [field]: value === "__clear__" ? null : value,
      },
    }));
  const displayedImpact = plan && previewImpact ? previewImpact : impact;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("teams.handoffHint")}</p>
      {impact.blockers.map((b, i) => (
        <TeamError key={i} error={b.code} />
      ))}
      {!displayedImpact.projects.length && (
        <p className="text-sm">{t("teams.noImpact")}</p>
      )}
      {displayedImpact.projects.map((p) => (
        <section
          key={p.projectId}
          className="space-y-3 rounded-md border border-border/70 p-3"
        >
          <h3 className="text-sm font-medium">{p.name}</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {p.tasks.map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
            {p.runs.map((run) => (
              <li key={run.id}>
                {run.id} · {run.state}
              </li>
            ))}
          </ul>
          {!plan && (
            <fieldset
              disabled={action.isPending}
              className="grid gap-3 sm:grid-cols-3"
            >
              {p.requiresOwnerTransfer && (
                <HandoffSelect
                  label={t("teams.newOwner")}
                  value={selected[p.projectId]?.newOwnerId ?? ""}
                  options={p.eligibleOwners}
                  onChange={(v) => choose(p.projectId, "newOwnerId", v)}
                />
              )}
              <HandoffSelect
                label={t("teams.assignee")}
                clear
                value={
                  selected[p.projectId]?.assigneeId === null
                    ? "__clear__"
                    : (selected[p.projectId]?.assigneeId ?? "")
                }
                options={p.eligibleAssignees}
                onChange={(v) => choose(p.projectId, "assigneeId", v)}
              />
              <HandoffSelect
                label={t("teams.reviewer")}
                clear
                value={
                  selected[p.projectId]?.reviewerId === null
                    ? "__clear__"
                    : (selected[p.projectId]?.reviewerId ?? "")
                }
                options={p.eligibleReviewers}
                onChange={(v) => choose(p.projectId, "reviewerId", v)}
              />
            </fieldset>
          )}
        </section>
      ))}
      {!plan ? (
        <Button
          disabled={action.isPending || !valid || impact.blockers.length > 0}
          onClick={() =>
            action.mutate(async () => {
              const choices = Object.values(selected).filter(
                (s): s is HandoffSelection =>
                  Boolean(s.projectId) &&
                  s.assigneeId !== undefined &&
                  s.reviewerId !== undefined,
              );
              const result = await teamsApi.plan(
                teamId,
                impact.member.userId,
                impact.member.revision,
                choices,
                impact.impactDigest,
              );
              setSnapshot(choices);
              setPreviewImpact(impact);
              setPlan(result.plan);
              setToken(result.confirmationToken);
            })
          }
        >
          {t("teams.preview")}
        </Button>
      ) : plan.state === "planned" ? (
        <div className="space-y-3 rounded-md border border-amber-500/40 p-3">
          <p className="text-sm">{t("teams.planNotice")}</p>
          <p className="text-xs">
            {t("teams.expires")}: {new Date(plan.expiresAt).toLocaleString()}
          </p>
          {snapshot.map((s) => {
            const p = displayedImpact.projects.find(
              (p) => p.projectId === s.projectId,
            )!;
            return (
              <div className="space-y-1 text-sm" key={s.projectId}>
                <strong>{p.name}</strong>
                {s.newOwnerId && (
                  <p>
                    {t("teams.newOwner")}:{" "}
                    {
                      p.eligibleOwners.find((o) => o.userId === s.newOwnerId)
                        ?.label
                    }
                  </p>
                )}
                <p>
                  {t("teams.assignee")}:{" "}
                  {s.assigneeId
                    ? p.eligibleAssignees.find((o) => o.userId === s.assigneeId)
                        ?.label
                    : t("teams.unassign")}
                </p>
                <p>
                  {t("teams.reviewer")}:{" "}
                  {s.reviewerId
                    ? p.eligibleReviewers.find((o) => o.userId === s.reviewerId)
                        ?.label
                    : t("teams.unassign")}
                </p>
              </div>
            );
          })}
          <Button
            disabled={action.isPending || Date.now() > plan.expiresAt}
            onClick={() =>
              action.mutate(async () => {
                const result = await teamsApi.commit(teamId, plan.id, token);
                setPlan(result.plan);
                setToken("");
              })
            }
          >
            {t("teams.planConfirm")}
          </Button>
          <Button
            variant="ghost"
            disabled={action.isPending}
            onClick={() => {
              setPlan(null);
              setToken("");
            }}
          >
            {t("common.cancel")}
          </Button>
        </div>
      ) : (
        <PlanStatus
          teamId={teamId}
          initial={plan}
          actorId={actorId}
          canResume={canResume}
        />
      )}
      <TeamError error={action.error} />
    </div>
  );
}
function HandoffSelect({
  label,
  value,
  options,
  onChange,
  clear,
}: {
  label: string;
  value: string;
  options: { userId: string; label: string }[];
  onChange: (v: string) => void;
  clear?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Field label={label}>
      <select
        className={inputClass}
        value={value}
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
export function PlanRecovery({
  teamId,
  actorId,
  canResume,
}: {
  teamId: string;
  actorId: string;
  canResume: boolean;
}) {
  const { t } = useLanguage();
  const [id, setId] = useState("");
  const [loaded, setLoaded] = useState<OffboardingPlan | null>(null);
  const action = useTeamAction(teamId);
  const plans = useQuery({
    queryKey: ["teams", teamId, "plans", actorId],
    queryFn: () => teamsApi.plans(teamId),
    refetchInterval: 10000,
    retry: false,
  });
  return (
    <Panel title={t("teams.resume")}>
      {plans.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : plans.isError ? (
        <TeamError error={plans.error} retry={() => void plans.refetch()} />
      ) : (
        <ul className="space-y-2">
          {plans.data?.plans.map((plan) => (
            <li key={plan.id}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLoaded(plan)}
              >
                {plan.id}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("teams.planId")}>
          <input
            className={inputClass}
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setLoaded(null);
            }}
          />
        </Field>
        <Button
          variant="outline"
          disabled={!id.trim() || action.isPending}
          onClick={() =>
            action.mutate(async () =>
              setLoaded((await teamsApi.planStatus(teamId, id.trim())).plan),
            )
          }
        >
          {t("teams.loadPlan")}
        </Button>
      </div>
      {loaded && (
        <PlanStatus
          key={loaded.id}
          teamId={teamId}
          initial={loaded}
          actorId={actorId}
          canResume={canResume}
        />
      )}
      <TeamError error={action.error} />
    </Panel>
  );
}
function PlanStatus({
  teamId,
  initial,
  actorId,
  canResume,
}: {
  teamId: string;
  initial: OffboardingPlan;
  actorId: string;
  canResume: boolean;
}) {
  const { t } = useLanguage();
  const action = useTeamAction(teamId);
  const [editing, setEditing] = useState<{
    plan: OffboardingPlan;
    impact: OffboardingImpact;
  } | null>(null);
  const query = useQuery({
    queryKey: ["teams", teamId, "plan", initial.id, actorId],
    queryFn: () => teamsApi.planStatus(teamId, initial.id),
    initialData: { plan: initial },
    refetchInterval: (q) =>
      q.state.data?.plan.state === "stopping" ? 3000 : false,
    retry: false,
  });
  const plan = query.data.plan;
  return (
    <div className="space-y-3">
      <p className="break-all text-xs">
        {t("teams.planId")}: {plan.id}
      </p>
      <p role="status">
        {t(
          plan.state === "completed"
            ? "teams.completed"
            : plan.state === "stopping"
              ? "teams.stopping"
              : "teams.planNotice",
        )}
      </p>
      <p className="text-xs">
        {t("teams.pendingStops")}: {plan.pendingStops}
      </p>
      <TeamError error={query.error} retry={() => void query.refetch()} />
      <TeamError error={plan.error} />
      {plan.state === "stopping" &&
        canResume &&
        query.data.impact &&
        !editing && (
          <Button
            variant="outline"
            onClick={() => setEditing({ plan, impact: query.data.impact! })}
          >
            {t("teams.revise")}
          </Button>
        )}
      {editing && canResume && (
        <PlanRevision
          key={`${editing.plan.revision}:${editing.impact.impactDigest}`}
          teamId={teamId}
          plan={editing.plan}
          impact={editing.impact}
          onSaved={() => setEditing(null)}
          onCancel={() => setEditing(null)}
          onReload={async () => {
            const result = await query.refetch();
            if (result.error) throw result.error;
            if (result.data?.impact)
              setEditing({
                plan: result.data.plan,
                impact: result.data.impact,
              });
          }}
        />
      )}
      {plan.state === "stopping" && canResume && (
        <Button
          disabled={action.isPending || Boolean(editing)}
          onClick={() => action.mutate(() => teamsApi.resume(teamId, plan.id))}
        >
          {t("teams.resume")}
        </Button>
      )}
      <TeamError error={action.error} />
    </div>
  );
}
