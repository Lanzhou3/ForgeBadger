"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import {
  collaborationApi,
  hasCapability,
  canDevelop,
  type AiTool,
  type WorkspaceDetail,
} from "@/lib/collaboration-api";
import {
  ErrorNotice,
  Field,
  inputClass,
  Panel,
  useWorkspaceAction,
  WorkspaceStatus,
} from "./WorkspaceShared";
import { RunPanel } from "./RunPanel";
interface Props {
  detail: WorkspaceDetail;
  taskId: string;
  actorId?: string;
}
export function TaskExecutionPanel({ detail, taskId, actorId }: Props) {
  const { t } = useLanguage();
  const { project } = detail;
  const action = useWorkspaceAction(project.id);
  const [comment, setComment] = useState("");
  const [aiTool, setAiTool] = useState<AiTool>("claude");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [runId, setRunId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["collaboration", project.id, "task", taskId, actorId],
    queryFn: () => collaborationApi.task(project.id, taskId),
  });
  if (query.isLoading) return <p role="status">{t("common.loading")}</p>;
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  if (!query.data) return null;
  const { task, comments, runs } = query.data;
  const developer = canDevelop(project);
  const selectedRun = runId ?? runs[0]?.id;
  return (
    <div className="min-w-0 space-y-4">
      {(project.executionEnabled || runs.length > 0) && <Panel title={t("workspace.runs")}>
        {project.managedExecution?.supported === false && (
          <p role="status" className="rounded-md border border-amber-500/40 p-3 text-sm">
            {t("workspace.runtimeUpgrade")}
          </p>
        )}
        {developer && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("common.aiTool")}>
              <select
                className={inputClass}
                value={aiTool}
                disabled={action.isPending}
                onChange={(e) => {
                  setAiTool(e.target.value as AiTool);
                  setKey(crypto.randomUUID());
                }}
              >
                {(["claude", "opencode", "codex", "kimi"] as const).map(
                  (tool) => (
                    <option key={tool} value={tool}>
                      {tool}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Button
              size="sm"
              disabled={
                !project.executionEnabled ||
                project.managedExecution?.supported === false ||
                Boolean(task.assigneeId && task.assigneeId !== actorId) ||
                action.isPending
              }
              onClick={() =>
                action.mutate(async () => {
                  const result = await collaborationApi.prepare(
                    project.id,
                    task.id,
                    aiTool,
                    key,
                  );
                  setRunId(result.run.id);
                  setKey(crypto.randomUUID());
                })
              }
            >
              {t("workspace.prepare")}
            </Button>
          </div>
        )}
        {developer && task.assigneeId && task.assigneeId !== actorId && (
          <p className="text-xs text-muted-foreground">
            {t("workspace.assignedElsewhere")}
          </p>
        )}
        {runs.length ? (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("workspace.runs")}
          >
            {runs.map((run) => (
              <button
                key={run.id}
                aria-pressed={selectedRun === run.id}
                onClick={() => setRunId(run.id)}
                className={`flex items-center gap-2 rounded-md border p-2 text-xs ${selectedRun === run.id ? "border-brand bg-brand/10" : "border-border/70"}`}
              >
                <span>
                  {run.actorLabel} · {run.id.slice(0, 8)}
                </span>
                <WorkspaceStatus value={run.state} />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("workspace.noRuns")}
          </p>
        )}
        {selectedRun && (
          <RunPanel
            key={selectedRun}
            project={project}
            runId={selectedRun}
            actorId={actorId}
            reviewerId={task.reviewerId}
            team={Boolean(project.teamId) || detail.members.some(
              (m) => m.role !== "owner" && m.state === "active",
            )}
            onRecovered={setRunId}
          />
        )}
      </Panel>}
      <Panel title={t("workspace.comments")}>
        {comments.length ? (
          <ul className="space-y-3">
            {comments.map((item) => (
              <li
                key={item.id}
                className="rounded-md border border-border/70 p-3"
              >
                <p className="text-xs text-muted-foreground">
                  {item.actorLabel}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {item.text}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("workspace.noComments")}
          </p>
        )}
        {hasCapability(project,"comment") && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate(async () => {
                await collaborationApi.comment(
                  project.id,
                  task.id,
                  comment.trim(),
                );
                setComment("");
              });
            }}
          >
            <Field label={t("workspace.comment")}>
              <textarea
                required
                maxLength={5000}
                className={inputClass}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </Field>
            <Button size="sm" disabled={!comment.trim() || action.isPending}>
              {t("workspace.post")}
            </Button>
          </form>
        )}
      </Panel>
      <ErrorNotice error={action.error} retry={() => void query.refetch()} />
    </div>
  );
}
