"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2, MessageSquare, RefreshCw, ShieldOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/hooks/use-language";
import {
  createFeishuConversationBinding,
  deleteFeishuConversationBinding,
  emergencyStopFeishu,
  getFeishuChannelAccount,
  getFeishuConnectionHealth,
  getFeishuIntegrationConfig,
  getFeishuQueueSummary,
  listFeishuUserMappings,
  listFeishuConversationBindings,
  listProjects,
  saveFeishuChannelAccount,
  replaceFeishuUserMappings,
  updateFeishuIntegrationConfig,
  updateFeishuConversationBinding,
  type FeishuConnectionHealth as FeishuConnectionHealthValue,
  type FeishuConversationBinding,
  type Project,
} from "@/lib/api";

const FEISHU_QUERY_ROOT = ["feishu-channel"] as const;

export function FeishuIntegrationSettings() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [allowedChatIds, setAllowedChatIds] = useState("");
  const [feishuOpenIds, setFeishuOpenIds] = useState("");

  const accountQuery = useQuery({
    queryKey: [...FEISHU_QUERY_ROOT, "account"],
    queryFn: getFeishuChannelAccount,
  });
  const healthQuery = useQuery({
    queryKey: [...FEISHU_QUERY_ROOT, "health"],
    queryFn: getFeishuConnectionHealth,
    refetchInterval: 15_000,
  });
  const bindingsQuery = useQuery({
    queryKey: [...FEISHU_QUERY_ROOT, "bindings"],
    queryFn: listFeishuConversationBindings,
  });
  const queueQuery = useQuery({
    queryKey: [...FEISHU_QUERY_ROOT, "queues"],
    queryFn: getFeishuQueueSummary,
    refetchInterval: 15_000,
  });
  const policyQuery = useQuery({
    queryKey: [...FEISHU_QUERY_ROOT, "policy"],
    queryFn: getFeishuIntegrationConfig,
  });
  const mappingsQuery = useQuery({
    queryKey: [...FEISHU_QUERY_ROOT, "mappings"],
    queryFn: listFeishuUserMappings,
  });

  // App Secret is write-only: hydrate only safe account metadata returned by the Gateway.
  useEffect(() => {
    if (!accountQuery.data) return;
    setAppId(accountQuery.data.appId);
    setEnabled(accountQuery.data.enabled);
  }, [accountQuery.data]);

  useEffect(() => {
    if (policyQuery.data) setAllowedChatIds(policyQuery.data.allowedChatIds.join(", "));
  }, [policyQuery.data]);

  useEffect(() => {
    if (mappingsQuery.data) setFeishuOpenIds(mappingsQuery.data.map((mapping) => mapping.feishuUserId).join(", "));
  }, [mappingsQuery.data]);

  async function refreshChannelState() {
    await queryClient.invalidateQueries({ queryKey: FEISHU_QUERY_ROOT });
  }

  const saveMutation = useMutation({
    mutationFn: async (account: { appId: string; appSecret?: string; enabled: boolean }) => {
      const chats = splitIdentifiers(allowedChatIds);
      const users = splitIdentifiers(feishuOpenIds);
      const saved = await saveFeishuChannelAccount(account);
      await updateFeishuIntegrationConfig({
        enabled: account.enabled,
        emergencyDisabled: false,
        identityMode: "bot",
        allowedChatIds: chats,
      });
      await replaceFeishuUserMappings(users.map((feishuUserId) => ({
        feishuUserId,
        openforgeUserId: "self",
      })));
      return saved;
    },
    onSuccess: async () => {
      setAppSecret("");
      await refreshChannelState();
    },
  });
  const stopMutation = useMutation({
    mutationFn: emergencyStopFeishu,
    onSuccess: refreshChannelState,
  });

  const loading = accountQuery.isLoading || healthQuery.isLoading;
  const failed = accountQuery.isError || healthQuery.isError || bindingsQuery.isError || queueQuery.isError;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-muted-foreground" />
              <CardTitle>{t("settings.feishuIntegration")}</CardTitle>
            </div>
            <CardDescription className="mt-2">
              {t("settings.feishuIntegrationDescription")}
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshChannelState()}>
            <RefreshCw className="mr-2 size-3.5" />
            {t("settings.feishuRefresh")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <p className="text-sm text-muted-foreground">{t("settings.feishuStatusLoading")}</p> : null}
        {failed ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t("settings.feishuStatusLoadFailed")}
          </div>
        ) : null}

        <div className="grid gap-4 rounded-md border border-border p-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="feishu-app-id">{t("settings.feishuAppId")}</Label>
            <Input
              id="feishu-app-id"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              placeholder="cli_xxxxxxxxxxxxxxxx"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="feishu-app-secret">{t("settings.feishuAppSecret")}</Label>
            <Input
              id="feishu-app-secret"
              type="password"
              value={appSecret}
              onChange={(event) => setAppSecret(event.target.value)}
              placeholder={accountQuery.data?.secretConfigured ? t("settings.feishuSecretConfigured") : ""}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">{t("settings.feishuSecretWriteOnly")}</p>
          </div>
          <div className="flex items-center justify-between gap-3 md:col-span-2">
            <div>
              <Label htmlFor="feishu-enabled">{t("settings.feishuEnabledState")}</Label>
              <p className="mt-1 text-xs text-muted-foreground">{t("settings.feishuEnabledDescription")}</p>
            </div>
            <Switch id="feishu-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="feishu-chat-allowlist">{t("settings.feishuAllowedChats")}</Label>
            <Input
              id="feishu-chat-allowlist"
              value={allowedChatIds}
              onChange={(event) => setAllowedChatIds(event.target.value)}
              placeholder="oc_xxx, oc_yyy"
            />
            <p className="text-xs text-muted-foreground">{t("settings.feishuAllowedChatsDescription")}</p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="feishu-user-mappings">{t("settings.feishuAllowedUsers")}</Label>
            <Input
              id="feishu-user-mappings"
              value={feishuOpenIds}
              onChange={(event) => setFeishuOpenIds(event.target.value)}
              placeholder="ou_xxx, ou_yyy"
            />
            <p className="text-xs text-muted-foreground">{t("settings.feishuAllowedUsersDescription")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Button
              type="button"
              disabled={!appId.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate({
                appId: appId.trim(),
                appSecret: appSecret || undefined,
                enabled,
              })}
            >
              {saveMutation.isPending ? t("settings.feishuSaving") : t("settings.feishuSave")}
            </Button>
            {saveMutation.isSuccess ? <span className="text-xs text-emerald-400">{t("settings.feishuSaved")}</span> : null}
            {saveMutation.isError ? <span className="text-xs text-destructive">{t("settings.feishuSaveFailed")}</span> : null}
          </div>
        </div>

        <FeishuConnectionHealth health={healthQuery.data} />
        <FeishuQueueOverview queues={queueQuery.data} />
        <FeishuBindingsManager bindings={bindingsQuery.data ?? []} onChanged={refreshChannelState} />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex min-w-0 items-start gap-2">
            <ShieldOff className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium">{t("settings.feishuEmergencyStop")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("settings.feishuEmergencyStopDescription")}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={stopMutation.isPending}
            onClick={() => stopMutation.mutate()}
          >
            {t("settings.feishuEmergencyStopAction")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function FeishuConnectionHealth({ health }: { health?: FeishuConnectionHealthValue }) {
  const { t } = useLanguage();
  const state = health?.state ?? "disabled";
  const healthy = state === "connected";

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">{t("settings.feishuConnectionHealth")}</div>
        <Badge variant={healthy ? "secondary" : state === "unhealthy" ? "destructive" : "outline"}>
          {state}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <StatusField label={t("settings.feishuConfigRevision")} value={String(health?.configRevision ?? "-")} />
        <StatusField label={t("settings.feishuReconnectAttempt")} value={String(health?.reconnectAttempt ?? 0)} />
        <StatusField label={t("settings.feishuLastConnectedAt")} value={formatTimestamp(health?.lastConnectedAt)} />
      </div>
      {health?.lastErrorMessage ? (
        <p className="mt-3 break-words text-xs text-destructive">{health.lastErrorMessage}</p>
      ) : null}
    </div>
  );
}

function FeishuQueueOverview({ queues }: { queues?: { inbox: Record<string, number>; outbox: Record<string, number> } }) {
  const { t } = useLanguage();
  const inbox = sumCounts(queues?.inbox);
  const outbox = sumCounts(queues?.outbox);

  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      <StatusField label={t("settings.feishuInboxQueue")} value={String(inbox)} />
      <StatusField label={t("settings.feishuOutboxQueue")} value={String(outbox)} />
    </div>
  );
}

export function FeishuBindingsManager({
  bindings,
  onChanged,
}: {
  bindings: FeishuConversationBinding[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [newChatId, setNewChatId] = useState("");
  const [newThreadKey, setNewThreadKey] = useState("root");
  const [newProjectId, setNewProjectId] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  async function refreshBindings() {
    await queryClient.invalidateQueries({ queryKey: [...FEISHU_QUERY_ROOT, "bindings"] });
    await onChanged();
  }

  const updateMutation = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      updateFeishuConversationBinding(id, projectId ? { type: "project", id: projectId } : { type: "workspace" }),
    onSuccess: refreshBindings,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteFeishuConversationBinding,
    onSuccess: refreshBindings,
  });
  const createMutation = useMutation({
    mutationFn: () => createFeishuConversationBinding({
      chatId: newChatId.trim(),
      threadKey: newThreadKey.trim() || "root",
      // The UI exposes names; only the stable internal project ID crosses the API boundary.
      scope: newProjectId ? { type: "project", id: newProjectId } : { type: "workspace" },
    }),
    onSuccess: async () => {
      setNewChatId("");
      setNewThreadKey("root");
      setNewProjectId("");
      await refreshBindings();
    },
  });

  const projects = projectsQuery.data?.projects ?? [];

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-muted-foreground" />
        <div className="font-medium">{t("settings.feishuBindings")}</div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("settings.feishuBindingsDescription")}</p>
      <div className="mt-3 grid gap-3 rounded-md border border-border/70 p-3 lg:grid-cols-[minmax(180px,1fr)_minmax(140px,220px)_minmax(180px,280px)_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="new-feishu-chat-id" className="text-xs">{t("settings.feishuBindingChatId")}</Label>
          <Input
            id="new-feishu-chat-id"
            value={newChatId}
            onChange={(event) => setNewChatId(event.target.value)}
            placeholder="oc_xxxxxxxxxxxxxxxx"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-feishu-thread-key" className="text-xs">{t("settings.feishuBindingThreadKey")}</Label>
          <Input
            id="new-feishu-thread-key"
            value={newThreadKey}
            onChange={(event) => setNewThreadKey(event.target.value)}
          />
        </div>
        <ProjectScopeSelect
          id="new-feishu-project"
          projects={projects}
          projectId={newProjectId}
          onChange={setNewProjectId}
        />
        <Button
          type="button"
          size="sm"
          disabled={!newChatId.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? t("settings.feishuAddingBinding") : t("settings.feishuAddBinding")}
        </Button>
        {createMutation.isError ? (
          <p className="text-xs text-destructive lg:col-span-4">{t("settings.feishuBindingAddFailed")}</p>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {bindings.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t("settings.feishuBindingsEmpty")}
          </p>
        ) : bindings.map((binding) => (
          <BindingRow
            key={binding.id}
            binding={binding}
            projects={projects}
            saving={updateMutation.isPending || deleteMutation.isPending}
            onSave={(projectId) => updateMutation.mutate({ id: binding.id, projectId })}
            onDelete={() => deleteMutation.mutate(binding.id)}
          />
        ))}
      </div>
    </div>
  );
}

function BindingRow({
  binding,
  projects,
  saving,
  onSave,
  onDelete,
}: {
  binding: FeishuConversationBinding;
  projects: Project[];
  saving: boolean;
  onSave: (projectId: string) => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [projectId, setProjectId] = useState(binding.scope.type === "project" ? binding.scope.id : "");

  return (
    <div className="grid gap-2 rounded-md border border-border/70 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,280px)_auto] lg:items-end">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{binding.chatId}</div>
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{binding.threadKey}</div>
      </div>
      <ProjectScopeSelect
        id={`binding-${binding.id}`}
        projects={projects}
        projectId={projectId}
        onChange={setProjectId}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => onSave(projectId.trim())}>
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onDelete}>
          {t("common.delete")}
        </Button>
      </div>
    </div>
  );
}

function ProjectScopeSelect({
  id,
  projects,
  projectId,
  onChange,
}: {
  id: string;
  projects: Project[];
  projectId: string;
  onChange: (projectId: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{t("settings.feishuBindingProject")}</Label>
      <select
        id={id}
        value={projectId}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <option value="">{t("settings.feishuWorkspaceScope")}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    </div>
  );
}

function StatusField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function sumCounts(counts?: Record<string, number>): number {
  return Object.values(counts ?? {}).reduce((total, count) => total + count, 0);
}

function formatTimestamp(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function splitIdentifiers(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}
