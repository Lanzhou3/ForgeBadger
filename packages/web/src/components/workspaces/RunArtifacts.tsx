"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import {
  collaborationApi,
  safeWorkspaceUrl,
  type RunDetail,
} from "@/lib/collaboration-api";
import {
  ErrorNotice,
  Field,
  inputClass,
  Panel,
  useWorkspaceAction,
} from "./WorkspaceShared";
interface Props {
  projectId: string;
  actorId?: string;
  detail: RunDetail;
  editable: boolean;
}
export function RunArtifacts({ projectId, actorId, detail, editable }: Props) {
  const { t } = useLanguage();
  const action = useWorkspaceAction(projectId);
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState(detail.run.previewUrl ?? "");
  const [pr, setPr] = useState(detail.run.prUrl ?? "");
  const diff = useQuery({
    queryKey: [
      "collaboration",
      projectId,
      "run",
      detail.run.id,
      "diff",
      actorId,
      detail.git.commit,
      path,
    ],
    queryFn: () => collaborationApi.diff(projectId, detail.run.id, path),
    enabled: Boolean(path),
  });
  const invalid = Boolean(
    (preview && !safeWorkspaceUrl(preview)) || (pr && !safeWorkspaceUrl(pr)),
  );
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Panel title={t("workspace.changes")}>
        {detail.git.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("workspace.noChanges")}
          </p>
        ) : (
          <ul className="max-h-48 overflow-auto">
            {detail.git.files.map((file) => (
              <li key={file.path}>
                <button
                  className="flex w-full gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted"
                  onClick={() => setPath(file.path)}
                  aria-pressed={path === file.path}
                >
                  <span>{file.status}</span>
                  <span className="break-all">{file.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {diff.isLoading && <p role="status">{t("common.loading")}</p>}
        <ErrorNotice error={diff.error} retry={() => void diff.refetch()} />
        {diff.data && !diff.isError && (
          <pre
            className="max-h-96 overflow-auto rounded-md border border-border/70 bg-background p-3 text-xs"
            aria-label={path}
          >
            {diff.data.diff || t("workspace.noChanges")}
          </pre>
        )}
      </Panel>
      <Panel title={t("workspace.preview")}>
        <p className="text-xs text-muted-foreground">
          {t("workspace.linksHint")}
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid)
              action.mutate(() =>
                collaborationApi.links(
                  projectId,
                  detail.run.id,
                  preview || null,
                  pr || null,
                ),
              );
          }}
        >
          <Field label={t("workspace.preview")}>
            <input
              className={inputClass}
              type="url"
              maxLength={2048}
              value={preview}
              disabled={!editable}
              onChange={(e) => setPreview(e.target.value)}
            />
          </Field>
          <Field label={t("workspace.pr")}>
            <input
              className={inputClass}
              type="url"
              maxLength={2048}
              value={pr}
              disabled={!editable}
              onChange={(e) => setPr(e.target.value)}
            />
          </Field>
          {invalid && (
            <p role="alert" className="text-sm text-destructive">
              {t("workspace.invalidUrl")}
            </p>
          )}
          <ErrorNotice error={action.error} />
          {editable && (
            <Button size="sm" disabled={invalid || action.isPending}>
              {t("common.save")}
            </Button>
          )}
        </form>
        <div className="flex flex-wrap gap-3 text-sm text-brand">
          {safeWorkspaceUrl(detail.run.previewUrl) && (
            <a
              href={safeWorkspaceUrl(detail.run.previewUrl)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("workspace.preview")} ↗
            </a>
          )}
          {safeWorkspaceUrl(detail.run.prUrl) && (
            <a
              href={safeWorkspaceUrl(detail.run.prUrl)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("workspace.pr")} ↗
            </a>
          )}
        </div>
      </Panel>
    </div>
  );
}
