"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plug, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import {
  createMcpToken,
  GatewayApiError,
  getMcpStatus,
  getRuntimeSettings,
  listMcpTokens,
  listProjects,
  type Project,
  mcpStatusKey,
  mcpTokensKey,
  revokeMcpToken,
  runtimeSettingsValue,
  updateRuntimeSettings,
  type McpToken,
  type McpTokenScope,
} from "@/lib/api";
import { runtimeSettingsQueryKey } from "@/components/settings/InstanceRuntimeSettings";
import { SettingsCardHeader } from "@/components/settings/ui";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * MCP integration card: external MCP clients
 * connect to the Gateway's /mcp endpoint with a long-lived access token.
 * The plaintext token is returned exactly once by the API, so it is shown
 * in a one-time dialog right after creation.
 */
export function McpIntegrationSettings() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpTokenScope[]>(["read"]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [expiresInHours, setExpiresInHours] = useState<number | null>(null);
  const [plaintextToken, setPlaintextToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<McpToken | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);

  const status = useQuery({ queryKey: mcpStatusKey, queryFn: getMcpStatus, retry: false });
  const enabled = status.data?.enabled === true;
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects, enabled });
  // Admins can flip FORGEBADGER_MCP_ENABLED from the UI; the route mount
  // still needs a Gateway restart, which the saved toast communicates.
  const runtime = useQuery({
    queryKey: runtimeSettingsQueryKey,
    queryFn: getRuntimeSettings,
    retry: false,
    enabled: user?.role === "admin",
  });
  const mcpSwitch =
    user?.role === "admin" && runtime.data
      ? runtimeSettingsValue<boolean>(runtime.data, "mcp_enabled")
      : undefined;
  const mcpSwitchMutation = useMutation({
    mutationFn: (next: boolean) => updateRuntimeSettings({ mcp_enabled: next }),
    onSuccess: (_data, next) => {
      void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey });
      void queryClient.invalidateQueries({ queryKey: mcpStatusKey });
      // The route mount only changes on restart: enabling takes effect after
      // one, and until then a disable leaves /mcp mounted — say so honestly.
      toast.success(next ? t("settings.restartRequired") : t("settings.mcpDisablePendingRestart"));
    },
    onError: () => toast.error(t("settings.instanceSaveError")),
  });

  function handleMcpSwitch(checked: boolean) {
    if (checked) {
      setConfirmEnable(true);
      return;
    }
    mcpSwitchMutation.mutate(false);
  }
  const tokens = useQuery({
    queryKey: mcpTokensKey,
    queryFn: listMcpTokens,
    retry: false,
    enabled,
    // lastUsedAt updates as clients use a token; poll so the list self-heals
    // without waiting for a create/revoke to invalidate it.
    refetchInterval: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: createMcpToken,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: mcpTokensKey });
      setPlaintextToken(result.plaintext);
      setName("");
      setProjectIds([]);
    },
    onError: (error) => toast.error(error instanceof GatewayApiError ? error.message : t("settings.mcpCreateFailed")),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeMcpToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpTokensKey });
      setRevoking(null);
    },
    onError: () => toast.error(t("settings.mcpRevokeFailed")),
  });

  const endpoint = status.data?.endpoint ?? "";
  const showMcpSwitch =
    mcpSwitch !== undefined && !(runtime.data?.readonly ?? false);

  async function copyText(text: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("settings.mcpCopied"));
    } catch {
      toast.error(t("settings.mcpCopyFailed"));
    }
  }

  function toggleScope(scope: McpTokenScope) {
    const active = scopes.includes(scope);
    // Keep at least one scope selected.
    if (active && scopes.length === 1) return;
    if (scope === "cli_dispatch" && !active) {
      setScopes([...new Set<McpTokenScope>([...scopes, "operate", "cli_dispatch"])]);
    } else if (scope === "operate" && active) {
      const remaining = scopes.filter((item) => item !== "operate" && item !== "cli_dispatch");
      setScopes(remaining.length > 0 ? remaining : ["read"]);
    } else {
      setScopes(active ? scopes.filter((item) => item !== scope) : [...scopes, scope]);
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    if (projectIds.length === 0 || projects.isError || projects.isLoading) return;
    if (expiresInHours !== null && (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 87600)) return;
    createMutation.mutate({ name: name.trim(), scopes, projectIds, expiresInHours });
  }

  return (
    <Card className="forgebadger-animate-in">
      <SettingsCardHeader
        icon={<Plug className="size-4" />}
        title={t("settings.mcp")}
        description={t("settings.mcpDescription")}
        action={
          <>
            {status.data && (
              <Badge variant={enabled ? "secondary" : "outline"}>
                {enabled ? t("settings.mcpStateEnabled") : t("settings.mcpStateDisabled")}
              </Badge>
            )}
            {showMcpSwitch && (
              <Switch
                checked={mcpSwitch}
                onCheckedChange={handleMcpSwitch}
                disabled={mcpSwitchMutation.isPending}
                aria-label={t("settings.mcpToggle")}
              />
            )}
          </>
        }
      />
      <CardContent className="space-y-3">
        {status.isError ? (
          <p className="text-xs text-destructive">{t("settings.mcpLoadFailed")}</p>
        ) : status.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            {enabled ? (
              <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                <span className="text-xs text-muted-foreground">{t("settings.mcpEndpoint")}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{endpoint}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={t("settings.mcpEndpoint")}
                  onClick={() => void copyText(endpoint)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                {t("settings.mcpDisabledHint")}
                {mcpSwitch === undefined && (
                  <span className="mt-1 block font-mono">FORGEBADGER_MCP_ENABLED=true</span>
                )}
              </div>
            )}
            {enabled && <McpTokensSection endpoint={endpoint} scopes={scopes} onToggleScope={toggleScope} onCreate={handleCreate} creating={createMutation.isPending} name={name} onNameChange={setName} projectIds={projectIds} onProjectIdsChange={setProjectIds} projects={projects.data?.projects ?? []} projectsLoading={projects.isLoading} projectsError={projects.isError} onAllScopes={() => setScopes(["read", "operate", "cli_dispatch"])} expiresInHours={expiresInHours} onExpiresInHoursChange={setExpiresInHours} tokens={tokens.data?.tokens ?? undefined} loading={tokens.isLoading} error={tokens.isError} onRevoke={setRevoking} />}
          </>
        )}
      </CardContent>

      <McpPlaintextDialog endpoint={endpoint} plaintext={plaintextToken} onClose={() => setPlaintextToken(null)} onCopy={copyText} />
      <ConfirmDialog
        open={confirmEnable}
        pending={mcpSwitchMutation.isPending}
        title={t("settings.mcpEnableConfirmTitle")}
        description={t("settings.mcpEnableConfirmDescription")}
        confirmLabel={t("settings.mcpToggle")}
        onOpenChange={setConfirmEnable}
        onConfirm={() => {
          setConfirmEnable(false);
          mcpSwitchMutation.mutate(true);
        }}
      />
      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.mcpRevokeConfirm")}</DialogTitle>
            <DialogDescription>{revoking?.name}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              {t("settings.mcpClose")}
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMutation.isPending}
              onClick={() => revoking && revokeMutation.mutate(revoking.id)}
            >
              {t("settings.mcpRevoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function McpTokensSection({  endpoint,
  scopes,
  onToggleScope,
  onCreate,
  creating,
  name,
  onNameChange,
  projectIds,
  onProjectIdsChange,
  projects,
  projectsLoading,
  projectsError,
  onAllScopes,
  expiresInHours,
  onExpiresInHoursChange,
  tokens,
  loading,
  error,
  onRevoke,
}: {
  endpoint: string;
  scopes: McpTokenScope[];
  onToggleScope: (scope: McpTokenScope) => void;
  onCreate: (event: FormEvent) => void;
  creating: boolean;
  name: string;
  onNameChange: (value: string) => void;
  projectIds: string[];
  onProjectIdsChange: (value: string[]) => void;
  projects: Project[];
  projectsLoading: boolean;
  projectsError: boolean;
  onAllScopes: () => void;
  expiresInHours: number | null;
  onExpiresInHoursChange: (value: number | null) => void;
  tokens?: McpToken[];
  loading: boolean;
  error: boolean;
  onRevoke: (token: McpToken) => void;
}) {
  const locale = useUiLocale();
  const { t } = useLanguage();
  // A silently-disabled submit button is a dead end: name every missing input.
  const expiryInvalid =
    expiresInHours !== null &&
    (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 87600);
  const blockers: string[] = [];
  if (!name.trim()) blockers.push(t("settings.mcpFormMissingName"));
  if (projectIds.length === 0) blockers.push(t("settings.mcpFormMissingProjects"));
  if (projectsLoading) blockers.push(t("common.loading"));
  if (projectsError) blockers.push(t("settings.mcpFormProjectsUnavailable"));
  if (expiryInvalid) blockers.push(t("settings.mcpFormInvalidExpiry"));
  const cannotCreateReason = blockers.join("、");
  return (
    <div className="space-y-3">
      <form onSubmit={onCreate} className="space-y-2.5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs" htmlFor="mcp-token-name">
              {t("settings.mcpName")}
            </Label>
            <Input
              id="mcp-token-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={64}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pb-1.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox
                checked={scopes.includes("read")}
                onCheckedChange={() => onToggleScope("read")}
                aria-label={t("settings.mcpScopeRead")}
              />
              {t("settings.mcpScopeRead")}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox
                checked={scopes.includes("operate")}
                onCheckedChange={() => onToggleScope("operate")}
                aria-label={t("settings.mcpScopeOperate")}
              />
              {t("settings.mcpScopeOperate")}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox checked={scopes.includes("cli_dispatch")} onCheckedChange={() => onToggleScope("cli_dispatch")} aria-label={t("settings.mcpScopeCliDispatch")} />
              {t("settings.mcpScopeCliDispatch")}
            </label>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={onAllScopes}>{t("settings.mcpAllPermissions")}</Button>
            <Button
              type="submit"
              size="sm"
              className="h-8"
              disabled={creating || blockers.length > 0}
              title={blockers.length > 0 ? t("settings.mcpFormCannotCreate").replace("{reasons}", cannotCreateReason) : undefined}
            >
              {creating ? t("common.loading") : t("settings.mcpCreate")}
            </Button>
          </div>
        </div>
        {blockers.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.mcpFormCannotCreate").replace("{reasons}", cannotCreateReason)}
          </p>
        ) : null}
        <McpProjectPicker projects={projects} loading={projectsLoading} error={projectsError} selected={projectIds} onChange={onProjectIdsChange} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="mcp-lifetime">{t("settings.mcpLifetime")}</Label>
            <select id="mcp-lifetime" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={expiresInHours === null ? "permanent" : "limited"} onChange={event => onExpiresInHoursChange(event.target.value === "permanent" ? null : 24)}>
              <option value="permanent">{t("settings.mcpPermanent")}</option>
              <option value="limited">{t("settings.mcpLimited")}</option>
            </select>
          </div>
          {expiresInHours !== null && <div className="w-32 space-y-1"><Label className="text-xs" htmlFor="mcp-expiry-hours">{t("settings.mcpExpiresHours")}</Label><Input id="mcp-expiry-hours" type="number" min={1} max={87600} value={expiresInHours} onChange={event => onExpiresInHoursChange(Number(event.target.value))} className="h-8 text-xs" /></div>}
          <p className="pb-1 text-xs text-muted-foreground">{t("settings.mcpLifetimeHelp")}</p>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.mcpScopeOperateHelp")}</p>
      </form>

      <div className="rounded-md border border-border/70">
        {error ? (
          <p className="p-3 text-xs text-destructive">{t("settings.mcpLoadFailed")}</p>
        ) : loading ? (
          <p className="p-3 text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : tokens && tokens.length > 0 ? (
          <div className="divide-y divide-border/70">
            {tokens.map((token) => (
              <div
                key={token.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5",
                  token.revoked && "opacity-60"
                )}
              >
                <span className="min-w-0 truncate text-sm font-medium">{token.name}</span>
                {token.scopes.map((scope) => (
                  <Badge key={scope} variant={scope === "operate" ? "secondary" : "outline"}>
                    {scope === "operate" ? t("settings.mcpScopeOperate") : scope === "cli_dispatch" ? t("settings.mcpScopeCliDispatch") : t("settings.mcpScopeRead")}
                  </Badge>
                ))}
                {token.projectIds && <span className="text-xs text-muted-foreground">{token.projectIds.map(id => projects.find(project => project.id === id)?.name ?? t("settings.mcpUnavailableProject")).join("、")}</span>}
                {!token.projectIds && !token.allowedRoot && <span className="text-xs text-muted-foreground">{t("settings.mcpLegacyAccess")}</span>}
                {token.allowedRoot && <span className="truncate text-xs text-muted-foreground">{token.allowedRoot}</span>}
                <span className="text-xs text-muted-foreground">{token.expiresAt ? `${t("settings.mcpExpiresAt")}: ${new Date(token.expiresAt).toLocaleString(locale)}` : t("settings.mcpPermanent")}</span>
                {token.revoked && (
                  <Badge variant="destructive">{t("settings.mcpRevoked")}</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {token.lastUsedAt
                    ? `${t("settings.mcpLastUsed")}: ${new Date(token.lastUsedAt).toLocaleString(locale)}`
                    : t("settings.mcpNeverUsed")}
                </span>
                {!token.revoked && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive hover:text-destructive"
                    aria-label={`${t("settings.mcpRevoke")} ${token.name}`}
                    onClick={() => onRevoke(token)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="p-3 text-xs text-muted-foreground">{t("settings.mcpEmpty")}</p>
        )}
      </div>

      <McpConnectExamples endpoint={endpoint} />
    </div>
  );
}

function McpProjectPicker({ projects, loading, error, selected, onChange }: {
  projects: Project[]; loading: boolean; error: boolean; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const visible = projects.filter(project => `${project.name} ${project.path}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <fieldset className="space-y-2 rounded-md border border-border/70 p-3">
    <legend className="px-1 text-xs font-medium">{t("settings.mcpProjects")} · {selected.length}</legend>
    <div className="flex items-center gap-2">
      <Input aria-label={t("settings.mcpSearchProjects")} placeholder={t("settings.mcpSearchProjects")} value={search} onChange={event => setSearch(event.target.value)} className="h-8 min-w-0 text-xs" />
      <Button type="button" variant="outline" size="sm" disabled={loading || error || projects.length === 0 || projects.length > 200} onClick={() => onChange(projects.map(project => project.id))}>{t("settings.mcpSelectAll")}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={selected.length === 0} onClick={() => onChange([])}>{t("settings.mcpClear")}</Button>
    </div>
    {loading ? <p className="text-xs text-muted-foreground">{t("common.loading")}</p> : error ? <p className="text-xs text-destructive">{t("settings.mcpProjectsFailed")}</p> : visible.length === 0 ? <p className="text-xs text-muted-foreground">{t(projects.length === 0 ? "settings.mcpNoProjects" : "settings.mcpNoMatches")}</p> :
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {visible.map(project => <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
          <Checkbox aria-label={project.name} checked={selected.includes(project.id)} disabled={!selected.includes(project.id) && selected.length >= 200} onCheckedChange={checked => onChange(checked === true ? [...selected, project.id] : selected.filter(id => id !== project.id))} />
          <span className="min-w-0"><span className="block truncate text-xs font-medium">{project.name}</span><span className="block truncate font-mono text-xs text-muted-foreground">{project.path}</span></span>
        </label>)}
      </div>}
    <p className="text-xs text-muted-foreground">{t("settings.mcpProjectsHelp")}</p>
  </fieldset>;
}

function mcpClientConfig(endpoint: string, token: string): string {
  return JSON.stringify({ mcpServers: { forgebadger: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

function McpConnectExamples({ endpoint }: { endpoint: string }) {
  const { t } = useLanguage();
  return <div className="space-y-2">
    <p className="text-xs text-muted-foreground">{t("settings.mcpConnectHelp")}</p>
    <SnippetBlock label={t("settings.mcpConnectJson")} content={mcpClientConfig(endpoint, t("settings.mcpTokenPlaceholder"))} />
  </div>;
}

function SnippetBlock({ label, content }: { label: string; content: string }) {
  const { t } = useLanguage();
  async function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t("settings.mcpCopied"));
    } catch {
      toast.error(t("settings.mcpCopyFailed"));
    }
  }
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-border/70 bg-muted/20">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Button type="button" variant="ghost" size="icon" className="size-6" aria-label={label} onClick={() => void copy()}>
          <Copy className="size-3.5" />
        </Button>
      </div>
      <pre className="min-w-0 max-w-full overflow-x-auto p-3 font-mono text-xs leading-relaxed">{content}</pre>
    </div>
  );
}

function McpPlaintextDialog({
  endpoint,
  plaintext,
  onClose,
  onCopy,
}: {
  endpoint: string;
  plaintext: string | null;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={plaintext !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("settings.mcpPlaintextTitle")}</DialogTitle>
          <DialogDescription>{t("settings.mcpPlaintextWarning")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
          <span className="min-w-0 flex-1 break-all font-mono text-xs">{plaintext}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => plaintext && onCopy(plaintext)}
          >
            <Copy className="size-3.5" />
            {t("settings.mcpCopy")}
          </Button>
        </div>
        {plaintext && <SnippetBlock label={t("settings.mcpConnectJson")} content={mcpClientConfig(endpoint, plaintext)} />}
        <DialogFooter>
          <Button onClick={onClose}>{t("settings.mcpClose")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
