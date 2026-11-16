"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { hasCapability, safeWorkspaceUrl, type WorkspaceDetail } from "@/lib/collaboration-api";
import { hubApi, type HubChecksStatus, type HubConfirmation, type HubDecision, type HubSubmission, type HubTask } from "@/lib/hub-api";
import { Field, inputClass, Panel, WorkspaceStatus } from "@/components/workspaces/WorkspaceShared";
import { HubError, useHubAction } from "./HubShared";
import { TaskHubInsights } from "./TaskHubInsights";

interface Props {
  detail: WorkspaceDetail;
  taskId: string;
  actorId?: string;
}

type SubmissionWithConfirmations = HubSubmission & { confirmations: HubConfirmation[] };
const CHECKS: HubChecksStatus[] = ["passed", "failed", "not_run"];

/**
 * Hub delivery for one shared task: claim it, record the pushed branch and
 * let a reviewer confirm. Code and execution stay on each member's machine.
 */
export function TaskHubDelivery({ detail, taskId, actorId }: Props) {
  const { t } = useLanguage();
  const { project, members } = detail;
  const action = useHubAction(project.id);
  const query = useQuery({
    queryKey: ["hub", project.id, "task", taskId, actorId],
    queryFn: () => hubApi.task(project.id, taskId),
  });
  if (query.isLoading) return <p role="status">{t("common.loading")}</p>;
  if (query.isError) return <HubError error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return null;

  const { task, submissions } = query.data;
  const label = (userId: string | null) => {
    if (!userId) return t("hub.unassigned");
    const member = members.find(item => item.userId === userId);
    return member?.displayName || member?.email || userId.slice(0, 8);
  };
  const open = task.status !== "done" && task.status !== "cancelled";
  const mine = Boolean(actorId) && task.assigneeId === actorId;
  const [latest, ...earlier] = submissions;

  return (
    <Panel title={t("hub.delivery")}>
      <p className="text-xs text-muted-foreground">{t("hub.deliveryHint")}</p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2"><dt className="text-muted-foreground">{t("hub.assignee")}</dt><dd>{label(task.assigneeId)}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">{t("hub.reviewer")}</dt><dd>{label(task.reviewerId)}</dd></div>
        <WorkspaceStatus value={task.status} />
      </dl>
      {open && !task.assigneeId && hasCapability(project, "develop") && (
        <Button size="sm" disabled={action.isPending} onClick={() => action.mutate(() => hubApi.claim(project.id, task.id, task.revision))}>
          {t("hub.claim")}
        </Button>
      )}
      {latest ? (
        <SubmissionCard title={t("hub.latestSubmission")} submission={latest} stale={open && latest.taskSemanticRevision !== task.semanticRevision} label={label} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("hub.noSubmission")}</p>
      )}
      {latest && task.status === "ready_for_review" && (
        <ConfirmForm
          key={latest.id}
          task={task}
          submission={latest}
          canReview={hasCapability(project, "review")}
          canManage={hasCapability(project, "manage")}
          actorId={actorId}
          pending={action.isPending}
          onDecide={(decision, note) => action.mutate(() => hubApi.confirm(project.id, task.id, { expectedRevision: task.revision, submissionId: latest.id, decision, note }))}
        />
      )}
      <TaskHubInsights projectId={project.id} taskId={task.id} submissionId={latest?.id ?? null} canManage={hasCapability(project, "manage")} />
      {open && mine && task.status !== "ready_for_review" && (
        <SubmitForm
          key={task.revision}
          pending={action.isPending}
          onSubmit={input => action.mutate(() => hubApi.submit(project.id, task.id, { expectedRevision: task.revision, ...input }))}
        />
      )}
      {earlier.length > 0 && (
        <details className="rounded-md border border-border/70 p-3">
          <summary className="cursor-pointer text-sm">{t("hub.history")} ({earlier.length})</summary>
          <div className="mt-3 space-y-3">
            {earlier.map(item => <SubmissionCard key={item.id} submission={item} stale={false} label={label} />)}
          </div>
        </details>
      )}
      <HubError error={action.error} retry={() => void query.refetch()} />
    </Panel>
  );
}

interface SubmissionCardProps {
  title?: string;
  submission: SubmissionWithConfirmations;
  stale: boolean;
  label: (userId: string | null) => string;
}

function SubmissionCard({ title, submission, stale, label }: SubmissionCardProps) {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const prUrl = safeWorkspaceUrl(submission.prUrl);
  return (
    <div className="space-y-2 rounded-md border border-border/70 p-3 text-sm">
      {title && <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>}
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all text-xs">{submission.branch}</code>
        <code className="text-xs text-muted-foreground" title={submission.commitSha}>{submission.commitSha.slice(0, 12)}</code>
        <span className="rounded border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground">
          {t("hub.checks")}: {t(`hub.checks.${submission.checksStatus}`)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("hub.submittedBy")}: {label(submission.actorId)} · {new Date(submission.createdAt).toLocaleString(locale)}
      </p>
      {submission.checksSummary && <p className="whitespace-pre-wrap break-words text-xs">{submission.checksSummary}</p>}
      {prUrl && <a className="text-xs underline" href={prUrl} target="_blank" rel="noopener noreferrer">{t("hub.openPr")}</a>}
      {stale && <p role="status" className="rounded-md border border-amber-500/40 p-2 text-xs">{t("hub.stale")}</p>}
      {submission.confirmations.length > 0 && (
        <ul className="space-y-2" aria-label={t("hub.confirmations")}>
          {submission.confirmations.map(item => (
            <li key={item.id} className="rounded-md border border-border/70 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <WorkspaceStatus value={item.decision} />
                <span>{t(`hub.kind.${item.actorKind}`)} · {label(item.actorId)}</span>
                {item.effect === "advisory" && <span className="rounded border border-border/70 px-1.5 py-0.5 text-muted-foreground">{t("hub.advisory")}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{item.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ConfirmFormProps {
  task: HubTask;
  submission: SubmissionWithConfirmations;
  canReview: boolean;
  canManage: boolean;
  actorId?: string | undefined;
  pending: boolean;
  onDecide: (decision: HubDecision, note: string) => void;
}

function ConfirmForm({ task, submission, canReview, canManage, actorId, pending, onDecide }: ConfirmFormProps) {
  const { t } = useLanguage();
  const [note, setNote] = useState("");
  if (!canReview) return null;
  if (submission.taskSemanticRevision !== task.semanticRevision) return null;
  if (submission.actorId === actorId) return <p className="text-xs text-muted-foreground">{t("hub.ownSubmission")}</p>;
  if (task.reviewerId && task.reviewerId !== actorId && !canManage) return <p className="text-xs text-muted-foreground">{t("hub.reviewerOnly")}</p>;
  const disabled = pending || !note.trim();
  return (
    <div className="space-y-2">
      <Field label={t("hub.confirmNote")}>
        <textarea required maxLength={5000} className={inputClass} value={note} onChange={event => setNote(event.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={() => onDecide("accepted", note.trim())}>{t("hub.accept")}</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onDecide("changes_requested", note.trim())}>{t("hub.requestChanges")}</Button>
      </div>
    </div>
  );
}

interface SubmitFormProps {
  pending: boolean;
  onSubmit: (input: { branch: string; commitSha: string; prUrl: string | null; checksStatus: HubChecksStatus; checksSummary: string }) => void;
}

function SubmitForm({ pending, onSubmit }: SubmitFormProps) {
  const { t } = useLanguage();
  const [branch, setBranch] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [checksStatus, setChecksStatus] = useState<HubChecksStatus>("passed");
  const [checksSummary, setChecksSummary] = useState("");
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({ branch: branch.trim(), commitSha: commitSha.trim(), prUrl: prUrl.trim() || null, checksStatus, checksSummary: checksSummary.trim() });
      }}
    >
      <Field label={t("hub.branch")}>
        <input required maxLength={200} className={inputClass} value={branch} onChange={event => setBranch(event.target.value)} placeholder="fb/123-short-name" />
      </Field>
      <Field label={t("hub.commit")}>
        <input required minLength={40} maxLength={64} pattern="[a-fA-F0-9]{40}|[a-fA-F0-9]{64}" className={inputClass} value={commitSha} onChange={event => setCommitSha(event.target.value)} />
      </Field>
      <Field label={t("hub.prUrl")}>
        <input type="url" maxLength={2048} className={inputClass} value={prUrl} onChange={event => setPrUrl(event.target.value)} placeholder="https://" />
      </Field>
      <Field label={t("hub.checks")}>
        <select className={inputClass} value={checksStatus} onChange={event => setChecksStatus(event.target.value as HubChecksStatus)}>
          {CHECKS.map(value => <option key={value} value={value}>{t(`hub.checks.${value}`)}</option>)}
        </select>
      </Field>
      <div className="md:col-span-2">
        <Field label={t("hub.checksSummary")}>
          <textarea maxLength={2000} className={inputClass} value={checksSummary} onChange={event => setChecksSummary(event.target.value)} />
        </Field>
      </div>
      <div><Button size="sm" disabled={pending || !branch.trim() || !commitSha.trim()}>{t("hub.submit")}</Button></div>
    </form>
  );
}
