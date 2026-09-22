"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { getGatewayBaseUrl } from "@/lib/runtime-config";
import {
  collaborationApi,
  secureCredentialTransport,
  safeWorkspaceUrl,
  type RunDetail,
  type WorkspaceDetail,
} from "@/lib/collaboration-api";
import {
  Field,
  Panel,
  inputClass,
  ErrorNotice,
  useWorkspaceAction,
} from "./WorkspaceShared";
interface Props {
  project: WorkspaceDetail["project"];
  detail: RunDetail;
  executor: boolean;
  onReconciled: (id: string) => void;
}
export function RunGitDelivery({
  project,
  detail,
  executor,
  onReconciled,
}: Props) {
  const { t } = useLanguage();
  const action = useWorkspaceAction(project.id);
  const [confirm, setConfirm] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const { run, git } = detail;
  const available =
    executor &&
    project.managedExecution?.supported !== false &&
    !run.operation &&
    ["ready", "closed", "revoking"].includes(run.state) &&
    !!git.commit &&
    !git.error;
  return (
    <Panel title={t("delivery.git")}>
      {Boolean(git.conflicts?.length) && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-amber-500/40 p-3"
        >
          <p className="text-sm">{t("delivery.conflicts")}</p>
          <ul className="text-xs">
            {git.conflicts!.map((path) => (
              <li className="break-all" key={path}>
                {path}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t("delivery.reconcileHint")}
      </p>
      {executor && (
        <Button
          variant="outline"
          size="sm"
          disabled={!available || action.isPending}
          onClick={() => setConfirm(true)}
        >
          {t("delivery.reconcile")}
        </Button>
      )}
      {confirm && (
        <div className="space-y-3 rounded-md border border-border/70 p-3">
          <p className="text-sm">{t("delivery.reconcileConfirm")}</p>
          <code className="block break-all text-xs">{git.commit}</code>
          <Button
            size="sm"
            disabled={!available || action.isPending}
            onClick={() =>
              action.mutate(async () => {
                const result = await collaborationApi.reconcile(
                  project.id,
                  run.id,
                  git.commit,
                  key,
                );
                setKey(crypto.randomUUID());
                setConfirm(false);
                onReconciled(result.run.id);
              })
            }
          >
            {t("workspace.confirm")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={action.isPending}
            onClick={() => setConfirm(false)}
          >
            {t("common.cancel")}
          </Button>
        </div>
      )}
      <ErrorNotice error={action.error} />
      {executor && <DraftPullRequest project={project} detail={detail} />}
    </Panel>
  );
}
function DraftPullRequest({
  project,
  detail,
}: {
  project: WorkspaceDetail["project"];
  detail: RunDetail;
}) {
  const { t } = useLanguage();
  const action = useWorkspaceAction(project.id);
  const [open, setOpen] = useState(false);
  const [repository, setRepository] = useState("");
  const [head, setHead] = useState(detail.run.branch);
  const [base, setBase] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [token, setToken] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [url, setUrl] = useState("");
  const receipt = detail.verifications.find(
    (r) =>
      r.current === true &&
      r.status === "passed" &&
      r.commit === detail.git.commit,
  );
  const ready =
    !!receipt &&
    detail.run.state === "ready" &&
    !detail.run.operation &&
    !detail.git.dirty &&
    !detail.git.error &&
    !detail.git.conflicts?.length;
  const secure =
    typeof window !== "undefined" &&
    secureCredentialTransport(getGatewayBaseUrl(), location.href);
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <Button
        size="sm"
        variant="outline"
        disabled={!ready}
        onClick={() => setOpen(true)}
      >
        {t("delivery.draftPr")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("delivery.prHint")}</p>
      {url && (
        <a
          className="text-sm text-brand underline"
          target="_blank"
          rel="noopener noreferrer"
          href={url}
        >
          {t("workspace.pr")} ↗
        </a>
      )}
      {open && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready || !secure || !confirmed || !receipt) return;
            action.mutate(async () => {
              try {
                const result = await collaborationApi.pullRequest(
                  project.id,
                  detail.run.id,
                  {
                    expectedCommit: detail.git.commit,
                    verificationId: receipt.id,
                    repository: repository.trim(),
                    headBranch: head.trim(),
                    baseBranch: base.trim(),
                    title: title.trim(),
                    body,
                    token,
                  },
                );
                setUrl(safeWorkspaceUrl(result.pullRequest.url) ?? "");
                setOpen(false);
                setConfirmed(false);
              } finally {
                setToken("");
              }
            });
          }}
        >
          <p className="break-all text-xs">
            {t("workspace.commit")}: {detail.git.commit}
          </p>
          <fieldset disabled={action.isPending} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("delivery.repository")}>
                <input
                  className={inputClass}
                  required
                  value={repository}
                  onChange={(e) => {
                    setRepository(e.target.value);
                    setConfirmed(false);
                  }}
                  placeholder="owner/repo"
                />
              </Field>
              <Field label={t("delivery.head")}>
                <input
                  className={inputClass}
                  required
                  value={head}
                  onChange={(e) => {
                    setHead(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </Field>
              <Field label={t("delivery.base")}>
                <input
                  className={inputClass}
                  required
                  value={base}
                  onChange={(e) => {
                    setBase(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </Field>
              <Field label={t("delivery.title")}>
                <input
                  className={inputClass}
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
            </div>
            <Field label={t("common.description")}>
              <textarea
                className={inputClass}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <Field label={t("delivery.token")}>
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={!secure}
              />
            </Field>
            {!secure && (
              <p role="alert" className="text-sm text-destructive">
                {t("delivery.secure")}
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t("delivery.confirmPr")}
            </label>
            <div className="flex gap-2">
              <Button
                disabled={
                  !ready || !secure || !confirmed || !token || action.isPending
                }
              >
                {t("delivery.draftPr")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setToken("");
                  setConfirmed(false);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      <ErrorNotice error={action.error} />
    </div>
  );
}
