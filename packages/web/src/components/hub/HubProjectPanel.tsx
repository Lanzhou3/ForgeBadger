"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { hubApi, type HubNodeToken, type HubProvider, type HubSettings } from "@/lib/hub-api";
import { Field, inputClass, Panel } from "@/components/workspaces/WorkspaceShared";
import { HubError, useHubAction } from "./HubShared";
import { HubInsightsPanel } from "./HubInsightsPanel";

interface Props {
  projectId: string;
  canManage: boolean;
  canReview?: boolean;
}

/** Project-level hub configuration: the shared Git remote and the caller's node tokens. */
export function HubProjectPanel({ projectId, canManage, canReview = false }: Props) {
  const { t } = useLanguage();
  const query = useQuery({ queryKey: ["hub", projectId, "project"], queryFn: () => hubApi.project(projectId) });
  if (query.isLoading) return <p role="status">{t("common.loading")}</p>;
  if (query.isError) return <HubError error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return null;
  const { settings } = query.data;
  return (
    <div className="space-y-4">
      <RepositorySettings key={settings.revision} projectId={projectId} settings={settings} canManage={canManage} />
      <HubInsightsPanel projectId={projectId} canManage={canManage} canReview={canReview} />
      <NodeTokens projectId={projectId} />
    </div>
  );
}

interface RepositorySettingsProps extends Props {
  settings: HubSettings;
}

function RepositorySettings({ projectId, settings, canManage }: RepositorySettingsProps) {
  const { t } = useLanguage();
  const action = useHubAction(projectId);
  const [provider, setProvider] = useState<HubProvider>(settings.provider ?? "github");
  const [remoteUrl, setRemoteUrl] = useState(settings.remoteUrl ?? "");
  const [defaultBranch, setDefaultBranch] = useState(settings.defaultBranch ?? "main");
  const policyKey = settings.confirmationPolicy === "human_only" ? t("hub.policy.human_only") : settings.confirmationPolicy;
  return (
    <Panel title={t("hub.settings")}>
      <p className="text-xs text-muted-foreground">{t("hub.settingsHint")}</p>
      {!canManage && (
        settings.remoteUrl
          ? <p className="break-all text-sm"><code>{settings.remoteUrl}</code> · {settings.defaultBranch}</p>
          : <p className="text-sm text-muted-foreground">{t("hub.notConfigured")}</p>
      )}
      {canManage && (
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={event => {
            event.preventDefault();
            action.mutate(() => hubApi.putSettings(projectId, { expectedRevision: settings.revision, provider, remoteUrl: remoteUrl.trim(), defaultBranch: defaultBranch.trim() }));
          }}
        >
          <Field label={t("hub.provider")}>
            <select className={inputClass} value={provider} onChange={event => setProvider(event.target.value as HubProvider)}>
              <option value="github">GitHub</option>
              <option value="gitee">Gitee</option>
            </select>
          </Field>
          <Field label={t("hub.remoteUrl")}>
            <input required maxLength={512} className={inputClass} value={remoteUrl} onChange={event => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repo.git" />
          </Field>
          <Field label={t("hub.defaultBranch")}>
            <input required maxLength={200} className={inputClass} value={defaultBranch} onChange={event => setDefaultBranch(event.target.value)} />
          </Field>
          <div><Button size="sm" disabled={action.isPending || !remoteUrl.trim() || !defaultBranch.trim()}>{t("hub.save")}</Button></div>
        </form>
      )}
      <p className="text-xs text-muted-foreground">{t("hub.policy")}: {policyKey}</p>
      <HubError error={action.error} />
    </Panel>
  );
}

function tokenState(token: HubNodeToken, now: number): "revoked" | "expired" | "active" {
  if (token.revokedAt) return "revoked";
  return token.expiresAt <= now ? "expired" : "active";
}

function NodeTokens({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const locale = useUiLocale();
  const action = useHubAction(projectId);
  const [name, setName] = useState("");
  const [days, setDays] = useState(30);
  const [issued, setIssued] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["hub", "tokens"], queryFn: hubApi.tokens });
  const tokens = (query.data?.tokens ?? []).filter(token => token.projectId === projectId);
  const [now] = useState(() => Date.now());
  const date = (value: number | null) => (value ? new Date(value).toLocaleString(locale) : t("hub.never"));
  return (
    <Panel title={t("hub.tokens")}>
      <p className="text-xs text-muted-foreground">{t("hub.tokensHint")}</p>
      {issued && (
        <div role="status" className="space-y-2 rounded-md border border-amber-500/40 p-3 text-sm">
          <p>{t("hub.tokenOnce")}</p>
          <code className="block select-all break-all text-xs">{issued}</code>
        </div>
      )}
      {query.isError && <HubError error={query.error} retry={() => void query.refetch()} />}
      {tokens.length ? (
        <ul className="divide-y divide-border/70">
          {tokens.map(token => {
            const state = tokenState(token, now);
            return (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 break-words">
                  {token.name}
                  <p className="text-xs text-muted-foreground">
                    {state === "active" ? `${t("hub.expires")}: ${date(token.expiresAt)}` : t(state === "revoked" ? "hub.revoked" : "hub.expired")}
                    {" · "}{t("hub.lastUsed")}: {date(token.lastUsedAt)}
                  </p>
                </div>
                {state === "active" && (
                  <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => hubApi.revokeToken(token.id))}>
                    {t("hub.revoke")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        !query.isLoading && <p className="text-sm text-muted-foreground">{t("hub.noTokens")}</p>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={event => {
          event.preventDefault();
          action.mutate(async () => {
            const created = await hubApi.createToken({ projectId, name: name.trim(), expiresInDays: days });
            setIssued(created.token);
            setName("");
          });
        }}
      >
        <Field label={t("hub.tokenName")}>
          <input required maxLength={64} className={inputClass} value={name} onChange={event => setName(event.target.value)} />
        </Field>
        <Field label={t("hub.tokenDays")}>
          <input type="number" min={1} max={90} className={inputClass} value={days} onChange={event => setDays(Number(event.target.value))} />
        </Field>
        <Button size="sm" disabled={action.isPending || !name.trim() || !Number.isInteger(days) || days < 1 || days > 90}>{t("hub.createToken")}</Button>
      </form>
      <HubError error={action.error} />
    </Panel>
  );
}
