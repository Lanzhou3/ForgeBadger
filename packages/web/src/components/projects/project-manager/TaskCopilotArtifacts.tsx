"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { taskArtifactsApi } from "@/lib/project-task-api";
import { Button } from "@/components/ui/button";
import {
  ErrorNotice,
  Field,
  inputClass,
  Panel,
} from "@/components/workspaces/WorkspaceShared";
export function TaskCopilotArtifacts({
  projectId,
  taskId,
  revision,
  canLink,
  actorId,
}: {
  projectId: string;
  taskId: string;
  revision?: number;
  canLink: boolean;
  actorId?: string;
}) {
  const { t } = useLanguage();
  const client = useQueryClient();
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const query = useQuery({
    queryKey: ["task-artifacts", projectId, taskId, actorId],
    queryFn: () => taskArtifactsApi.list(projectId, taskId),
  });
  const candidate = query.data?.candidates.find(
    (c) => c.developmentTaskId === selected,
  );
  const action = useMutation({
    mutationFn: async () => {
      if (!candidate || !confirmed || revision === undefined || !canLink)
        return;
      await taskArtifactsApi.link(projectId, taskId, {
        developmentTaskId: candidate.developmentTaskId,
        artifactDigest: candidate.artifactDigest,
        expectedTaskRevision: revision,
        shareSummary: true,
      });
    },
    onSuccess: async () => {
      setSelected("");
      setConfirmed(false);
      await client.invalidateQueries({
        queryKey: ["task-artifacts", projectId, taskId],
      });
    },
  });
  return (
    <Panel title={t("task.artifacts")}>
      <p className="text-xs text-muted-foreground">{t("task.artifactHint")}</p>
      {query.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.artifacts.length ? (
            <ul className="space-y-3">
              {query.data.artifacts.map((a) => (
                <li
                  className="space-y-2 rounded-md border border-border/70 p-3 text-xs"
                  key={a.id}
                >
                  <p>Copilot · {a.status}</p>
                  <code className="block break-all">{a.artifactDigest}</code>
                  <p>
                    {t("task.filesChecks")}: {a.filesCount} / {a.passedChecks} /{" "}
                    {a.checksCount}
                  </p>
                  <p>
                    {t(
                      a.current ? "task.snapshotCurrent" : "task.snapshotStale",
                    )}
                  </p>
                  {a.canOpen && (
                    <Link
                      className="text-brand underline"
                      href={`/copilot/tasks?${new URLSearchParams({ projectId, taskId: a.developmentTaskId })}`}
                    >
                      {t("task.openPrivate")}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("task.noArtifacts")}
            </p>
          )}
          {canLink &&
            (query.data.candidates.length ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  action.mutate();
                }}
              >
                <Field label={t("task.artifactCandidate")}>
                  <select
                    className={inputClass}
                    value={selected}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      setConfirmed(false);
                    }}
                    disabled={action.isPending}
                  >
                    <option value="">{t("teams.select")}</option>
                    {query.data.candidates.map((c) => (
                      <option
                        key={c.developmentTaskId}
                        value={c.developmentTaskId}
                      >
                        Copilot · {c.status} · {c.developmentTaskId.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </Field>
                {candidate && (
                  <code className="block break-all text-xs">
                    {candidate.artifactDigest}
                  </code>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    disabled={action.isPending}
                  />
                  {t("task.shareSummary")}
                </label>
                <Button
                  size="sm"
                  disabled={
                    !candidate ||
                    !confirmed ||
                    revision === undefined ||
                    action.isPending
                  }
                >
                  {t("task.linkArtifact")}
                </Button>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("task.noCandidates")}
              </p>
            ))}
        </>
      )}
      <ErrorNotice error={action.error} />
    </Panel>
  );
}
