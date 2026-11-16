"use client";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { safeWorkspaceUrl } from "@/lib/collaboration-api";
import { hubInsightsApi, type HubInsightCheck } from "@/lib/hub-insights-api";
import { inputClass } from "@/components/workspaces/WorkspaceShared";
import { HubError, useHubAction } from "./HubShared";

interface Props {
  projectId: string;
  taskId: string;
  submissionId: string | null;
  canManage: boolean;
}

const MAX_FILES = 5;
const KIND_ORDER: HubInsightCheck["kind"][] = ["base_conflict", "peer_conflict", "scope", "pull_request", "ci"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Module assignment and the stored conflict / PR / CI checks for a task's latest submission. */
export function TaskHubInsights({ projectId, taskId, submissionId, canManage }: Props) {
  const { t } = useLanguage();
  const action = useHubAction(projectId);
  const query = useQuery({ queryKey: ["hub-insights", projectId], queryFn: () => hubInsightsApi.insights(projectId), retry: false });
  if (query.isLoading) return <p role="status" className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  if (!query.data) return null;

  const { modules, taskModules } = query.data;
  const current = taskModules[taskId] ?? "";
  const patterns = modules.map(item => item.pattern);
  if (current && !patterns.includes(current)) patterns.push(current);
  const checks = submissionId
    ? KIND_ORDER.flatMap(kind => query.data.checks.filter(check => check.submissionId === submissionId && check.kind === kind))
    : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("hubInsights.module")}</span>
        {canManage ? (
          <select
            aria-label={t("hubInsights.module")}
            className={`${inputClass} w-auto max-w-full`}
            value={current}
            disabled={action.isPending}
            onChange={event => {
              const pattern = event.target.value || null;
              action.mutate(() => hubInsightsApi.setTaskModule(projectId, taskId, pattern));
            }}
          >
            <option value="">{t("hubInsights.moduleNone")}</option>
            {patterns.map(pattern => <option key={pattern} value={pattern}>{pattern}</option>)}
          </select>
        ) : (
          <code className="break-all text-xs">{current || t("hubInsights.moduleUnset")}</code>
        )}
      </div>
      {checks.length > 0 && (
        <ul className="space-y-2" aria-label={t("hubInsights.checks")}>
          {checks.map(check => <CheckRow key={`${check.submissionId}:${check.kind}`} check={check} />)}
        </ul>
      )}
      <HubError error={action.error} />
    </div>
  );
}

function CheckRow({ check }: { check: HubInsightCheck }) {
  const { t } = useLanguage();
  const tone = check.status === "attention" ? "border-amber-500/40" : check.status === "unknown" ? "border-border/70 text-muted-foreground" : "border-border/70";
  return (
    <li className={`space-y-1 rounded-md border p-2 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t(`hubInsights.kind.${check.kind}`)}</span>
        <span className="rounded border border-border/70 px-1.5 py-0.5">{t(`hubInsights.status.${check.status}`)}</span>
      </div>
      <CheckDetails check={check} />
    </li>
  );
}

function reasonText(reason: unknown, t: ReturnType<typeof useLanguage>["t"]): string {
  if (reason === "COMMIT_NOT_FETCHED") return t("hubInsights.reason.COMMIT_NOT_FETCHED");
  if (reason === "NOT_FOUND") return t("hubInsights.reason.NOT_FOUND");
  return t("hubInsights.reason.unknown");
}

function CheckDetails({ check }: { check: HubInsightCheck }) {
  const { t } = useLanguage();
  const details = isRecord(check.details) ? check.details : {};
  if (check.status === "unknown") return <p>{reasonText(details.reason, t)}</p>;
  switch (check.kind) {
    case "base_conflict": return <FileList files={strings(details.files)} label={t("hubInsights.files")} truncated={details.truncated === true} okText={t("hubInsights.noConflict")} />;
    case "scope": return <FileList files={strings(details.outside)} label={t("hubInsights.outsideFiles")} truncated={false} okText={t("hubInsights.inScope")} total={typeof details.total === "number" ? details.total : undefined} />;
    case "peer_conflict": return <Peers details={details} />;
    case "pull_request": return <PullRequest details={details} />;
    case "ci": return <Ci details={details} />;
    default: return null;
  }
}

interface FileListProps {
  files: string[];
  label: string;
  truncated: boolean;
  okText: string;
  total?: number | undefined;
}

function FileList({ files, label, truncated, okText, total }: FileListProps) {
  const { t } = useLanguage();
  if (!files.length) return <p>{okText}</p>;
  const hidden = Math.max(files.length - MAX_FILES, (total ?? 0) - MAX_FILES, 0);
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">{label}</p>
      <ul className="space-y-0.5">
        {files.slice(0, MAX_FILES).map(file => <li key={file}><code className="break-all">{file}</code></li>)}
      </ul>
      {hidden > 0 && <p className="text-muted-foreground">+{hidden} {t("hubInsights.more")}</p>}
      {truncated && <p className="text-muted-foreground">{t("hubInsights.truncated")}</p>}
    </div>
  );
}

function Peers({ details }: { details: Record<string, unknown> }) {
  const { t } = useLanguage();
  const peers = (Array.isArray(details.peers) ? details.peers : []).filter(isRecord);
  if (!peers.length) return <p>{t("hubInsights.noConflict")}</p>;
  return (
    <ul className="space-y-0.5">
      {peers.map((peer, index) => {
        const id = text(peer.taskId) ?? "";
        return (
          <li key={`${id}:${index}`}>
            {t("hubInsights.peerTask")} <code>{id.slice(0, 8)}</code> · {strings(peer.files).length} {t("hubInsights.files").toLowerCase()}
          </li>
        );
      })}
    </ul>
  );
}

function PullRequest({ details }: { details: Record<string, unknown> }) {
  const { t } = useLanguage();
  const url = safeWorkspaceUrl(text(details.url) ?? null);
  const state = details.state === "open" || details.state === "closed" || details.state === "merged" ? details.state : null;
  if (!state) return <p>{reasonText(details.reason, t)}</p>;
  const stateKey = state === "open" ? "hubInsights.prOpen" : state === "closed" ? "hubInsights.prClosed" : "hubInsights.prMerged";
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {typeof details.number === "number" && <span>#{details.number}</span>}
        <span>{t(stateKey)}</span>
        {details.draft === true && <span className="rounded border border-border/70 px-1.5 py-0.5">{t("hubInsights.prDraft")}</span>}
        {url && <a className="underline" href={url} target="_blank" rel="noopener noreferrer">{t("hubInsights.prLink")}</a>}
      </div>
      {details.matchesSubmission === false && <p role="status" className="rounded-md border border-amber-500/40 p-1.5">{t("hubInsights.prMismatch")}</p>}
    </div>
  );
}

function Ci({ details }: { details: Record<string, unknown> }) {
  const { t } = useLanguage();
  const state = details.state;
  if (state !== "success" && state !== "failure" && state !== "pending" && state !== "none") return <p>{reasonText(details.reason, t)}</p>;
  const key = { success: "hubInsights.ciSuccess", failure: "hubInsights.ciFailure", pending: "hubInsights.ciPending", none: "hubInsights.ciNone" } as const;
  const failed = typeof details.failed === "number" ? details.failed : 0;
  const total = typeof details.total === "number" ? details.total : 0;
  return (
    <p>
      {t(key[state])}
      {state !== "none" && ` · ${failed}/${total} ${t("hubInsights.ciCounts")}`}
    </p>
  );
}
