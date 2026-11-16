"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import type { HubChecksStatus } from "@/lib/hub-api";
import { hubLinkApi, type HubLink, type HubLinkTask, type LocalGitState } from "@/lib/hub-link-api";
import { Field, inputClass, Panel, WorkspaceStatus } from "@/components/workspaces/WorkspaceShared";
import { HubError, useHubAction } from "./HubShared";

interface Props {
  projectId: string;
  enabled: boolean;
}

const CHECKS: HubChecksStatus[] = ["passed", "failed", "not_run"];

/**
 * Node view of the team hub for one local project: connect this clone to the
 * hub, see the tasks assigned to you and report the branch you pushed.
 */
export function TeamHubLink({ projectId, enabled }: Props) {
  const links = useQuery({ queryKey: ["hub-link", "list"], queryFn: hubLinkApi.list, enabled, retry: false });
  if (!links.data) {
    // Linking is reserved for the instance admin; other users simply do not get this panel.
    const hidden = !links.isError || (links.error instanceof Error && links.error.message === "HUB_LINK_ADMIN_REQUIRED");
    return hidden ? null : <HubError error={links.error} retry={() => void links.refetch()} />;
  }
  const link = links.data.links.find(item => item.localProjectId === projectId);
  return link ? <LinkedTasks key={link.id} link={link} projectId={projectId} /> : <ConnectForm projectId={projectId} />;
}

function ConnectForm({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const action = useHubAction(projectId);
  const [hubUrl, setHubUrl] = useState("");
  const [token, setToken] = useState("");
  return (
    <details className="rounded-lg border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("hubLink.connect")}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{t("hubLink.connectHint")}</p>
      <form
        className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
        onSubmit={event => {
          event.preventDefault();
          action.mutate(async () => {
            await hubLinkApi.connect({ hubUrl: hubUrl.trim(), token: token.trim(), localProjectId: projectId });
            setToken("");
          });
        }}
      >
        <Field label={t("hubLink.hubUrl")}>
          <input required maxLength={512} className={inputClass} value={hubUrl} onChange={event => setHubUrl(event.target.value)} placeholder="https://forge.lan" />
        </Field>
        <Field label={t("hubLink.token")}>
          <input required type="password" autoComplete="off" maxLength={256} className={inputClass} value={token} onChange={event => setToken(event.target.value)} />
        </Field>
        <Button size="sm" disabled={action.isPending || !hubUrl.trim() || !token.trim()}>{t("hubLink.connectAction")}</Button>
      </form>
      <div className="mt-3"><HubError error={action.error} /></div>
    </details>
  );
}

function LinkedTasks({ link, projectId }: { link: HubLink; projectId: string }) {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const action = useHubAction(projectId);
  const sync = useQuery({ queryKey: ["hub-link", link.id, "sync"], queryFn: () => hubLinkApi.sync(link.id), refetchInterval: 60_000, retry: false });
  const git = useQuery({ queryKey: ["hub-link", link.id, "git"], queryFn: () => hubLinkApi.git(link.id), retry: false });
  // Only what this member can act on: their own open tasks and unassigned ones.
  const tasks = (sync.data?.tasks ?? []).filter(task => task.status !== "done" && task.status !== "cancelled" && (task.mine || !task.assigneeId));
  const synced = sync.data?.link.lastSyncedAt ?? link.lastSyncedAt;
  return (
    <Panel title={`${t("hubLink.title")} · ${link.hubProjectName}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="break-all">{link.hubUrl}{synced ? ` · ${t("hubLink.lastSynced")}: ${new Date(synced).toLocaleString(locale)}` : ""}</span>
        <span className="flex gap-2">
          <Button size="sm" variant="outline" disabled={sync.isFetching} onClick={() => { void sync.refetch(); void git.refetch(); }}>{t("hubLink.sync")}</Button>
          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => hubLinkApi.remove(link.id))}>{t("hubLink.disconnect")}</Button>
        </span>
      </div>
      {git.data && <GitLine git={git.data.git} />}
      {git.isError && <HubError error={git.error} />}
      {sync.isError && <HubError error={sync.error} retry={() => void sync.refetch()} />}
      {sync.isLoading && <p role="status" className="text-sm">{t("common.loading")}</p>}
      {sync.data && tasks.length === 0 && <p className="text-sm text-muted-foreground">{t("hubLink.empty")}</p>}
      <ul className="space-y-2">
        {tasks.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            git={git.data?.git}
            pending={action.isPending}
            onClaim={() => action.mutate(() => hubLinkApi.claim(link.id, task.id))}
            onCreateLocal={() => action.mutate(() => hubLinkApi.createLocalTask(link.id, task.id))}
            onSubmit={input => action.mutate(() => hubLinkApi.submit(link.id, task.id, input))}
          />
        ))}
      </ul>
      <HubError error={action.error} />
    </Panel>
  );
}

function GitLine({ git }: { git: LocalGitState }) {
  const { t } = useLanguage();
  const state = !git.branch ? t("hubLink.gitDetached") : git.dirty ? t("hubLink.gitDirty") : git.pushed ? t("hubLink.gitReady") : t("hubLink.gitNotPushed");
  return (
    <p className="text-xs text-muted-foreground">
      {t("hubLink.gitBranch")}: <code>{git.branch ?? "—"}</code> · <code title={git.commit}>{git.commit.slice(0, 12)}</code> · {state}
    </p>
  );
}

interface TaskRowProps {
  task: HubLinkTask;
  git: LocalGitState | undefined;
  pending: boolean;
  onClaim: () => void;
  onCreateLocal: () => void;
  onSubmit: (input: { prUrl: string | null; checksStatus: HubChecksStatus; checksSummary: string }) => void;
}

function TaskRow({ task, git, pending, onClaim, onCreateLocal, onSubmit }: TaskRowProps) {
  const { t } = useLanguage();
  const [prUrl, setPrUrl] = useState("");
  const [checksStatus, setChecksStatus] = useState<HubChecksStatus>("passed");
  const [checksSummary, setChecksSummary] = useState("");
  const canSubmit = task.mine && (task.status === "in_progress" || task.status === "blocked" || task.status === "todo");
  const gitReady = Boolean(git?.branch) && !git?.dirty && Boolean(git?.pushed);
  return (
    <li className="space-y-2 rounded-md border border-border/70 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words font-medium">{task.title}</span>
        <span className="flex items-center gap-2">
          {task.mine && <span className="text-xs text-muted-foreground">{t("hubLink.mine")}</span>}
          <WorkspaceStatus value={task.status} />
        </span>
      </div>
      {task.mine && <p className="text-xs text-muted-foreground">{t("hubLink.workOn")}: <code className="select-all">{task.suggestedBranch}</code></p>}
      <div className="flex flex-wrap gap-2">
        {!task.assigneeId && <Button size="sm" disabled={pending} onClick={onClaim}>{t("hub.claim")}</Button>}
        {task.mine && !task.localWorkItemId && <Button size="sm" variant="outline" disabled={pending} onClick={onCreateLocal}>{t("hubLink.createLocal")}</Button>}
        {task.mine && task.localWorkItemId && <span className="text-xs text-muted-foreground">{t("hubLink.localCreated")}</span>}
      </div>
      {canSubmit && (
        <details className="rounded-md border border-border/70 p-3">
          <summary className="cursor-pointer text-sm">{t("hubLink.submitCurrent")}</summary>
          <p className="mt-2 text-xs text-muted-foreground">{t("hubLink.submitHint")}</p>
          <form
            className="mt-3 grid gap-3 md:grid-cols-2"
            onSubmit={event => {
              event.preventDefault();
              onSubmit({ prUrl: prUrl.trim() || null, checksStatus, checksSummary: checksSummary.trim() });
            }}
          >
            <Field label={t("hub.checks")}>
              <select className={inputClass} value={checksStatus} onChange={event => setChecksStatus(event.target.value as HubChecksStatus)}>
                {CHECKS.map(value => <option key={value} value={value}>{t(`hub.checks.${value}`)}</option>)}
              </select>
            </Field>
            <Field label={t("hub.prUrl")}>
              <input type="url" maxLength={2048} className={inputClass} value={prUrl} onChange={event => setPrUrl(event.target.value)} placeholder="https://" />
            </Field>
            <div className="md:col-span-2">
              <Field label={t("hub.checksSummary")}>
                <textarea maxLength={2000} className={inputClass} value={checksSummary} onChange={event => setChecksSummary(event.target.value)} />
              </Field>
            </div>
            <div><Button size="sm" disabled={pending || !gitReady}>{t("hub.submit")}</Button></div>
          </form>
        </details>
      )}
    </li>
  );
}
