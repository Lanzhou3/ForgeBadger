"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { hubInsightsApi, type HubCheckKind, type HubInsights } from "@/lib/hub-insights-api";
import { Field, inputClass, Panel } from "@/components/workspaces/WorkspaceShared";
import { HubError, useHubAction } from "./HubShared";

interface Props {
  projectId: string;
  canManage: boolean;
  canReview: boolean;
}

const KINDS: HubCheckKind[] = ["base_conflict", "peer_conflict", "scope", "pull_request", "ci"];

function attentionCounts(insights: HubInsights): Array<[HubCheckKind, number]> {
  const counts = KINDS.map(kind => {
    const submissions = new Set(insights.checks.filter(check => check.kind === kind && check.status === "attention").map(check => check.submissionId));
    return [kind, submissions.size] as [HubCheckKind, number];
  });
  return counts.filter(([, count]) => count > 0);
}

/** Team radar: conflict and PR/CI freshness, repository modules and the optional Git host token. */
export function HubInsightsPanel({ projectId, canManage, canReview }: Props) {
  const { t } = useLanguage();
  const query = useQuery({ queryKey: ["hub-insights", projectId], queryFn: () => hubInsightsApi.insights(projectId) });
  if (query.isLoading) return <p role="status">{t("common.loading")}</p>;
  if (query.isError) return <HubError error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return null;
  return (
    <div className="space-y-4">
      <Radar projectId={projectId} insights={query.data} canRefresh={canManage || canReview} />
      <Modules insights={query.data} />
      {canManage && <GitHostToken projectId={projectId} configured={query.data.remote.tokenConfigured} />}
    </div>
  );
}

interface RadarProps {
  projectId: string;
  insights: HubInsights;
  canRefresh: boolean;
}

function Radar({ projectId, insights, canRefresh }: RadarProps) {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const action = useHubAction(projectId);
  const { sync } = insights;
  const date = (value: number | null) => (value ? new Date(value).toLocaleString(locale) : t("hub.never"));
  const counts = attentionCounts(insights);
  return (
    <Panel title={t("hubInsights.radar")}>
      <p className="text-xs text-muted-foreground">{t("hubInsights.radarHint")}</p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2"><dt className="text-muted-foreground">{t("hubInsights.mirrorFetched")}</dt><dd>{date(sync.mirrorFetchedAt)}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">{t("hubInsights.remotePolled")}</dt><dd>{date(sync.remotePolledAt)}</dd></div>
      </dl>
      {sync.mirrorError && <SyncNotice label={t("hubInsights.mirrorError")} code={sync.mirrorError} />}
      {sync.remoteError && <SyncNotice label={t("hubInsights.remoteError")} code={sync.remoteError} />}
      <p className="text-sm">
        <span className="text-muted-foreground">{t("hubInsights.summary")}: </span>
        {counts.length
          ? counts.map(([kind, count]) => `${t(`hubInsights.kind.${kind}`)} ${count}`).join(" · ")
          : t("hubInsights.summaryNone")}
      </p>
      {canRefresh && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => hubInsightsApi.refreshMirror(projectId))}>
            {t("hubInsights.refreshMirror")}
          </Button>
          <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => hubInsightsApi.refreshRemote(projectId))}>
            {t("hubInsights.refreshRemote")}
          </Button>
        </div>
      )}
      <HubError error={action.error} />
    </Panel>
  );
}

function SyncNotice({ label, code }: { label: string; code: string }) {
  return (
    <div role="status" className="space-y-1 rounded-md border border-amber-500/40 p-2 text-xs">
      <p className="font-medium">{label}</p>
      <HubError error={new Error(code)} />
    </div>
  );
}

function Modules({ insights }: { insights: HubInsights }) {
  const { t } = useLanguage();
  return (
    <Panel title={t("hubInsights.modules")}>
      {insights.modules.length ? (
        <ul className="divide-y divide-border/70">
          {insights.modules.map(item => (
            <li key={item.pattern} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <code className="break-all text-xs">{item.pattern}</code>
              <span className="text-xs text-muted-foreground">
                {t("hubInsights.owners")}: {item.owners.length ? item.owners.join(", ") : t("hubInsights.noOwners")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("hubInsights.modulesEmpty")}</p>
      )}
    </Panel>
  );
}

interface GitHostTokenProps {
  projectId: string;
  configured: boolean;
}

function GitHostToken({ projectId, configured }: GitHostTokenProps) {
  const { t } = useLanguage();
  const action = useHubAction(projectId);
  const [token, setToken] = useState("");
  return (
    <Panel title={t("hubInsights.tokenTitle")}>
      <p className="text-xs text-muted-foreground">{t("hubInsights.tokenHint")}</p>
      <p className="text-sm">{configured ? t("hubInsights.tokenConfigured") : t("hubInsights.tokenMissing")}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={event => {
          event.preventDefault();
          action.mutate(async () => {
            await hubInsightsApi.putCredential(projectId, token.trim());
            setToken("");
          });
        }}
      >
        <Field label={t("hubInsights.tokenLabel")}>
          <input type="password" autoComplete="off" maxLength={512} className={inputClass} value={token} onChange={event => setToken(event.target.value)} />
        </Field>
        <Button size="sm" disabled={action.isPending || !token.trim()}>{t("hubInsights.tokenSave")}</Button>
        {configured && (
          <Button type="button" size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => hubInsightsApi.deleteCredential(projectId))}>
            {t("hubInsights.tokenRemove")}
          </Button>
        )}
      </form>
      <HubError error={action.error} />
    </Panel>
  );
}
