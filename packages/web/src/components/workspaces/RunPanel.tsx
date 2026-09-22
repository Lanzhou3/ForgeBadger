"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import {
  collaborationApi,
  hasCapability,
  canDevelop,
  type WorkspaceDetail,
} from "@/lib/collaboration-api";
import { ErrorNotice, WorkspaceStatus } from "./WorkspaceShared";
import { RunArtifacts } from "./RunArtifacts";
import { RunReview } from "./RunReview";
import { VerificationPanel } from "./VerificationPanel";
import { RunGitDelivery } from "./RunGitDelivery";
import { RunActions } from "./RunActions";
interface Props {
  project: WorkspaceDetail["project"];
  runId: string;
  actorId?: string;
  team: boolean;
  reviewerId?: string | null;
  onRecovered: (id: string) => void;
}
export function RunPanel({
  project,
  runId,
  actorId,
  team,
  reviewerId,
  onRecovered,
}: Props) {
  const { t } = useLanguage();
  const query = useQuery({
    queryKey: ["collaboration", project.id, "run", runId, actorId],
    queryFn: () => collaborationApi.run(project.id, runId),
    refetchInterval: (q) =>
      q.state.data?.run.state === "provisioning" ||
      Boolean(q.state.data?.run.operation) ||
      q.state.data?.verifications.some((r) => r.status === "running")
        ? 3000
        : 15_000,
  });
  if (query.isLoading) return <p role="status">{t("common.loading")}</p>;
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  if (!query.data) return null;
  const detail = query.data;
  const { run, git } = detail;
  const own = actorId === run.actorId;
  const executor = canDevelop(project) && own;
  const ready = run.state === "ready";
  return (
    <div className="min-w-0 space-y-4 border-t border-border pt-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <WorkspaceStatus value={run.state} />
          <span className="text-sm">{run.actorLabel}</span>
          <code className="break-all text-xs text-muted-foreground">
            {run.branch}
          </code>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          {t("workspace.refresh")}
        </Button>
      </header>
      {run.error && <ErrorNotice error={run.error} />}
      {run.operation && (
        <p
          role="status"
          className="rounded-md border border-amber-500/40 p-3 text-sm"
        >
          {t(
            run.operation.phase === "interrupted"
              ? "workspace.operationInterrupted"
              : "workspace.operationActive",
          )}{" "}
          {t("workspace.operationRecoveryHint")}
        </p>
      )}
      {git.error && <ErrorNotice error={t("workspace.unavailable")} />}
      <p className="text-xs text-muted-foreground">
        {t("workspace.privateHint")}
      </p>
      {run.sessionId && executor && !run.operation && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/sessions/${run.sessionId}`}>
            {t("workspace.terminal")}
          </Link>
        </Button>
      )}
      <div className="space-y-1 text-xs">
        <p>
          {t("workspace.commit")}:{" "}
          <code className="break-all">{git.commit || "—"}</code>
        </p>
        {!git.error && (
          <p className={git.dirty ? "text-amber-500" : "text-muted-foreground"}>
            {t(git.dirty ? "workspace.dirty" : "workspace.clean")}
          </p>
        )}
      </div>
      <RunArtifacts
        key={`${run.id}:${run.previewUrl}:${run.prUrl}`}
        projectId={project.id}
        actorId={actorId}
        detail={detail}
        editable={executor && ready}
      />
      <VerificationPanel detail={detail} />
      <RunReview
        project={project}
        detail={detail}
        actorId={actorId}
        reviewerId={reviewerId}
        team={team}
      />
      <RunGitDelivery project={project} detail={detail} executor={executor} onReconciled={onRecovered}/>
      <RunActions
        project={project}
        detail={detail}
        executor={executor}
        onRecovered={onRecovered}
      />
    </div>
  );
}
