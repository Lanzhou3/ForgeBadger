"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, FileCode2, FileText, Globe2, History, Play, Plus, Power, Save, ShieldCheck, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectManagerPanel } from "@/components/projects/ProjectManagerPanel";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import { WorkspaceContextPanel } from "@/components/projects/WorkspaceContextPanel";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getProject,
  getProjectAgentSequence,
  getGlobalAiConfig,
  getProjectAiConfig,
  getConfigCompliance,
  getDependencies,
  discoverAdapters,
  listSessions,
  createSession,
  createDefaultAgentPack,
  deleteAgent,
  listAgents,
  listActivities,
  deleteProject,
  listApiKeys,
  listModels,
  listProjectSkills,
  listSkills,
  listTemplates,
  applyConfigSync,
  previewConfigSync,
  setProjectSkill,
  updateAgent,
  updateProjectAiConfigFile,
  updateProjectAgentSequence,
  chooseDefaultRuntimeAdapter,
  defaultConfigConflictDecisions,
  defaultTemplateForAiTool,
  isAdapterLaunchable,
  type ConfigConflict,
  type ConfigDecision,
  type ConfigComplianceReport,
  type CredentialMode,
  type RuntimeAdapterId,
  type Agent,
  type AiConfigFile,
  type AiConfigFormField,
  type AiConfigForm,
  type AiConfigSnapshot,
  type SessionActivity,
} from "@/lib/api";
import {
  formValueToText,
  readAiConfigFieldValue,
  textToFormValue,
  updateAiConfigDraft,
  type AiConfigFormValue,
} from "@/lib/ai-config-forms";
import { useLanguage } from "@/hooks/use-language";
import { buildCopilotLaunchHref } from "@/lib/copilot";
import { activityFiltersForProject } from "@/lib/snapshot-filters";
import { highlightCode, supportsSyntaxHighlighting } from "@/lib/syntax-highlight";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { cn } from "@/lib/utils";

const builtinTemplateOptions = [
  { id: "builtin-claude-code", name: "Claude Code" },
  { id: "builtin-opencode", name: "OpenCode" },
  { id: "builtin-codex", name: "Codex CLI" },
];

const PROJECT_DETAIL_TABS = [
  "sessions",
  "project-manager",
  "agents",
  "orchestration",
  "skills",
  "config",
  "activity",
] as const;

type ProjectDetailTab = typeof PROJECT_DETAIL_TABS[number];

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const id = params.id as string;
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>(() =>
    readProjectDetailTab(searchParams.get("tab")) ?? "sessions"
  );
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("builtin-claude-code");
  const [selectedRuntimeAdapter, setSelectedRuntimeAdapter] = useState<RuntimeAdapterId | "">("");
  const [credentialMode, setCredentialMode] = useState<CredentialMode>("host_environment");
  const [selectedApiKeyId, setSelectedApiKeyId] = useState("");
  const [configConflicts, setConfigConflicts] = useState<ConfigConflict[]>([]);
  const [configDecisions, setConfigDecisions] = useState<Record<string, ConfigDecision>>({});
  const [selectedConfigPath, setSelectedConfigPath] = useState("");
  const [configDraft, setConfigDraft] = useState("");
  const [agentSequenceIds, setAgentSequenceIds] = useState<string[]>([]);
  const [activityAgentId, setActivityAgentId] = useState("");

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id),
    enabled: !!id,
  });

  const { data: sessionsData } = useQuery({
    queryKey: ["sessions", { projectId: id }],
    queryFn: () => listSessions({ projectId: id }),
    enabled: !!id,
  });

  const { data: activitiesData } = useQuery({
    queryKey: ["activities", { projectId: id, agentId: activityAgentId || undefined }],
    queryFn: () => listActivities(activityFiltersForProject(id, activityAgentId)),
    enabled: !!id && activeTab === "activity",
  });

  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
  });

  const { data: agentSequenceData } = useQuery({
    queryKey: ["project-agent-sequence", id],
    queryFn: () => getProjectAgentSequence(id),
    enabled: !!id,
  });

  const { data: skillsData } = useQuery({
    queryKey: ["skills"],
    queryFn: listSkills,
  });

  const { data: projectSkillsData } = useQuery({
    queryKey: ["project-skills", id],
    queryFn: () => listProjectSkills(id),
    enabled: !!id,
  });

  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: listModels,
  });

  const { data: apiKeysData } = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  });

  const { data: templatesData } = useQuery({
    queryKey: ["templates"],
    queryFn: listTemplates,
  });

  const { data: adapterDiscoveryData, isLoading: adapterDiscoveryLoading } = useQuery({
    queryKey: ["adapters", "discovery"],
    queryFn: discoverAdapters,
  });

  const { data: dependenciesData, isLoading: dependenciesLoading } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });

  const { data: projectAiConfigData, isLoading: projectAiConfigLoading } = useQuery({
    queryKey: ["project-ai-config", id],
    queryFn: () => getProjectAiConfig(id),
    enabled: !!id,
  });

  const { data: globalAiConfigData, isLoading: globalAiConfigLoading } = useQuery({
    queryKey: ["project-ai-config-global", id],
    queryFn: () => getGlobalAiConfig(id),
    enabled: !!id,
  });
  const previewConfigMutation = useMutation({
    mutationFn: () => previewConfigSync(id, selectedTemplateId, credentialMode),
    onSuccess: (preview) => {
      setConfigConflicts(preview.conflicts ?? []);
      setConfigDecisions(defaultConfigConflictDecisions(preview.conflicts ?? []));
    },
  });

  const applyConfigMutation = useMutation({
    mutationFn: () => {
      return applyConfigSync(id, configDecisions, selectedTemplateId, credentialMode);
    },
    onSuccess: () => {
      setConfigConflicts([]);
      setConfigDecisions({});
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });

  const complianceMutation = useMutation<ConfigComplianceReport>({
    mutationFn: () => getConfigCompliance(id, {
      templateId: selectedTemplateId,
      credentialMode,
    }),
  });

  const createSessionMutation = useMutation({
    mutationFn: () => {
      if (!selectedRuntimeAdapter) {
        throw new Error(t("projects.selectRuntimeCli"));
      }
      return createSession({
        projectId: id,
        credentialMode,
        aiTool: selectedRuntimeAdapter,
        ...(selectedModelId ? { modelId: selectedModelId } : {}),
        ...(credentialMode === "stored_encrypted_key" && selectedApiKeyId
          ? { apiKeyId: selectedApiKeyId }
          : {}),
      });
    },
    onSuccess: () => {
      router.push("/sessions");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/projects");
    },
  });

  const agentStatusMutation = useMutation({
    mutationFn: ({ agentId, status }: { agentId: string; status: string }) =>
      updateAgent(agentId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const agentDeleteMutation = useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["project-agent-sequence", id] });
    },
  });

  const agentSequenceMutation = useMutation({
    mutationFn: () => updateProjectAgentSequence(id, agentSequenceIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-agent-sequence", id] }),
  });

  const defaultAgentPackMutation = useMutation({
    mutationFn: () => createDefaultAgentPack(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["project-agent-sequence", id] });
      setAgentSequenceIds(result.sequence.map((item) => item.agentId));
    },
  });

  const projectSkillMutation = useMutation({
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      setProjectSkill(id, skillId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-skills", id] });
    },
  });

  const updateAiConfigMutation = useMutation({
    mutationFn: () => updateProjectAiConfigFile(id, selectedConfigPath, configDraft),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["project-ai-config", id], snapshot);
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });

  const project = projectData?.project;
  const projectCopilotHref = buildCopilotLaunchHref({
    source: "project",
    sourceRefId: id,
    intent: "project_readiness",
  });
  const projectSessions = useMemo(
    () => sessionsData?.sessions ?? [],
    [sessionsData?.sessions]
  );
  const projectActivities = useMemo(
    () => activitiesData?.activities ?? [],
    [activitiesData?.activities]
  );
  const projectAgents = useMemo(
    () => agentsData?.agents?.filter((a) => a.projectId === id) ?? [],
    [agentsData?.agents, id]
  );
  const projectAgentMap = useMemo(
    () => new Map(projectAgents.map((agent) => [agent.id, agent])),
    [projectAgents]
  );
  const orderedProjectAgents = agentSequenceIds
    .map((agentId) => projectAgentMap.get(agentId))
    .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
  const skills = skillsData?.skills ?? [];
  const projectSkills = projectSkillsData?.skills ?? [];
  const projectSkillById = useMemo(
    () => new Map(projectSkills.map((skill) => [skill.skillId, skill])),
    [projectSkills]
  );
  const enabledSkillIds = useMemo(
    () => new Set(projectSkills.filter((skill) => skill.isEnabled).map((skill) => skill.skillId)),
    [projectSkills]
  );
  const models = modelsData?.models ?? [];
  const apiKeys = apiKeysData?.apiKeys ?? [];
  const templates = templatesData?.templates ?? [];
  const runtimeAdapters = adapterDiscoveryData?.adapters ?? [];
  const terminalRuntime = dependenciesData?.terminalRuntime;
  const terminalSetupGuidance = getTerminalRuntimeSetupGuidance(
    terminalRuntime?.mode,
    terminalRuntime?.supported
  );
  const launchableRuntimeAdapters = useMemo(
    () => runtimeAdapters.filter(isAdapterLaunchable),
    [runtimeAdapters]
  );
  const selectedRuntimeOption = runtimeAdapters.find((adapter) => adapter.id === selectedRuntimeAdapter);
  const selectedRuntimeLaunchable = selectedRuntimeOption ? isAdapterLaunchable(selectedRuntimeOption) : false;
  const projectAiConfig = projectAiConfigData;
  const globalAiConfig = globalAiConfigData;
  const selectedConfigFile = projectAiConfig?.files.find((file) => file.relativePath === selectedConfigPath);
  const defaultModel = models.find((model) => model.isDefault);
  const selectedCredentialNeedsKey = credentialMode === "stored_encrypted_key";
  const cannotCreateSession =
    createSessionMutation.isPending ||
    adapterDiscoveryLoading ||
    !selectedRuntimeAdapter ||
    !selectedRuntimeLaunchable ||
    (selectedCredentialNeedsKey && !selectedApiKeyId);
  const configNeedsReview = ["failed", "needs_review"].includes(searchParams.get("configStatus") ?? "");
  const projectManagerWorkItemId = normalizeSearchParam(searchParams.get("workItemId"));
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const runningSessionCount = projectSessions.filter((session) => session.status === "running").length;
  const enabledSkillCount = enabledSkillIds.size;

  useEffect(() => {
    if (!selectedModelId && defaultModel) {
      setSelectedModelId(defaultModel.id);
    }
  }, [defaultModel, selectedModelId]);

  useEffect(() => {
    const nextTab = readProjectDetailTab(searchParams.get("tab"));
    if (nextTab && nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [activeTab, searchParams]);

  const handleTabChange = (value: string) => {
    const nextTab = readProjectDetailTab(value);
    if (!nextTab) return;
    setActiveTab(nextTab);
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    if (nextTab === "project-manager") {
      nextSearchParams.set("tab", "project-manager");
    } else {
      nextSearchParams.delete("tab");
      nextSearchParams.delete("workItemId");
    }
    const query = nextSearchParams.toString();
    router.replace(query ? `/projects/${encodeURIComponent(id)}?${query}` : `/projects/${encodeURIComponent(id)}`, {
      scroll: false,
    });
  };

  useEffect(() => {
    const nextTemplateId = project?.templateId ?? defaultTemplateForAiTool(project?.aiTool);
    setSelectedTemplateId((current) => current === nextTemplateId ? current : nextTemplateId);
  }, [project?.templateId, project?.aiTool]);

  useEffect(() => {
    if (!adapterDiscoveryData?.adapters) return;
    const nextAdapter = chooseDefaultRuntimeAdapter(adapterDiscoveryData.adapters, selectedRuntimeAdapter);
    setSelectedRuntimeAdapter((current) => current === (nextAdapter ?? "") ? current : (nextAdapter ?? ""));
  }, [adapterDiscoveryData?.adapters, selectedRuntimeAdapter]);

  useEffect(() => {
    if (credentialMode === "stored_encrypted_key" && !selectedApiKeyId && apiKeys[0]) {
      setSelectedApiKeyId((current) => current || apiKeys[0]?.id || "");
    }
  }, [apiKeys, credentialMode, selectedApiKeyId]);

  useEffect(() => {
    const projectAgentIds = new Set(projectAgents.map((agent) => agent.id));
    const savedIds = agentSequenceData?.sequence?.map((item) => item.agentId).filter((agentId) => projectAgentIds.has(agentId)) ?? [];
    const missingIds = projectAgents
      .map((agent) => agent.id)
      .filter((agentId) => !savedIds.includes(agentId));
    const nextIds = [...savedIds, ...missingIds];
    setAgentSequenceIds((current) => sameStringArray(current, nextIds) ? current : nextIds);
  }, [agentSequenceData?.sequence, projectAgents]);

  useEffect(() => {
    const files = projectAiConfig?.files ?? [];
    if (files.length === 0) return;
    const preferred = files.find((file) => file.exists && file.role === "instructions") ?? files[0];
    if (!selectedConfigPath || !files.some((file) => file.relativePath === selectedConfigPath)) {
      const nextPath = preferred?.relativePath ?? "";
      setSelectedConfigPath((current) => current === nextPath ? current : nextPath);
    }
  }, [projectAiConfig?.files, selectedConfigPath]);

  useEffect(() => {
    const nextDraft = selectedConfigFile?.content ?? "";
    setConfigDraft((current) => current === nextDraft ? current : nextDraft);
  }, [selectedConfigFile?.content, selectedConfigFile?.relativePath]);

  const moveAgentInSequence = (agentId: string, direction: "up" | "down") => {
    setAgentSequenceIds((current) => {
      const index = current.indexOf(agentId);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  return (
    <div className="min-h-full space-y-5 bg-[linear-gradient(180deg,rgba(15,23,42,0.24),transparent_22%)] p-4 lg:p-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/projects")}>
        <ArrowLeft className="mr-2 size-4" />
        {t("projects.back")}
      </Button>

      {projectLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("projects.loadingOne")}
          </CardContent>
        </Card>
      ) : !project ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("projects.notFound")}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden border-border/70 bg-card/80 shadow-sm">
            <CardContent className="p-0">
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5 p-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    <span>Project Control</span>
                    <span className="h-px w-8 bg-border" />
                    {project.status && <Badge variant="outline">{project.status}</Badge>}
                  </div>
                  <div className="space-y-2">
                    <h1 className="break-words text-2xl font-semibold tracking-tight">{project.name}</h1>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {project.path ?? project.rootPath}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <ProjectStat label={t("nav.sessions")} value={projectSessions.length} />
                    <ProjectStat label={t("nav.agents")} value={projectAgents.length} />
                    <ProjectStat label={t("nav.skills")} value={enabledSkillIds.size} />
                  </div>
                </div>
                <div className="border-t border-border/70 bg-muted/20 p-5 lg:border-l lg:border-t-0">
                  <div className="grid gap-2">
                    <Button
                      className="justify-start"
                      onClick={() => createSessionMutation.mutate()}
                      disabled={cannotCreateSession}
                    >
                      <Plus className="mr-2 size-4" />
                      {createSessionMutation.isPending ? t("projects.creating") : t("projects.newSession")}
                    </Button>
                    <Button asChild variant="outline" size="sm" className="justify-start">
                      <Link href={projectCopilotHref}>
                        <Sparkles className="mr-2 size-4" />
                        {t("copilot.askCopilot")}
                      </Link>
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/history?projectId=${project.id}`}>
                          <History className="mr-2 size-4" />
                          {t("nav.history")}
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => complianceMutation.mutate()}
                        disabled={complianceMutation.isPending}
                      >
                        <ShieldCheck className="mr-2 size-4" />
                        {complianceMutation.isPending ? t("projects.checkingCompliance") : t("projects.checkCompliance")}
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      onClick={() => previewConfigMutation.mutate()}
                      disabled={previewConfigMutation.isPending}
                    >
                      <FileCode2 className="mr-2 size-4" />
                      {previewConfigMutation.isPending ? t("projects.generating") : t("projects.previewConfig")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start text-destructive"
                      onClick={() => {
                        if (window.confirm(t("projects.deleteConfirm"))) {
                          deleteMutation.mutate();
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="mr-2 size-4" />
                      {deleteMutation.isPending ? t("projects.deleting") : t("projects.deleteRecord")}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {configNeedsReview && (
            <Card className="border-amber-500/50 bg-amber-500/10">
              <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t("projects.configNeedsReviewTitle")}</div>
                  <p className="text-sm text-muted-foreground">
                    {t("projects.configNeedsReviewDescription")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => previewConfigMutation.mutate()}
                  disabled={previewConfigMutation.isPending}
                >
                  <FileCode2 className="mr-2 size-4" />
                  {previewConfigMutation.isPending
                    ? t("projects.generating")
                    : t("projects.reviewConfig")}
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("projects.launchOptions")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="runtime-adapter">{t("projects.runtimeCli")}</Label>
                <select
                  id="runtime-adapter"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                  value={selectedRuntimeAdapter}
                  onChange={(event) => setSelectedRuntimeAdapter(event.target.value as RuntimeAdapterId)}
                  disabled={adapterDiscoveryLoading || runtimeAdapters.length === 0}
                >
                  <option value="">
                    {adapterDiscoveryLoading
                      ? t("projects.loadingRuntimeCli")
                      : t("projects.selectRuntimeCli")}
                  </option>
                  {runtimeAdapters.map((adapter) => (
                    <option
                      key={adapter.id}
                      value={adapter.id}
                      disabled={!isAdapterLaunchable(adapter)}
                    >
                      {adapter.label}
                      {!adapter.available
                        ? ` (${t("projects.runtimeUnavailable")})`
                        : !adapter.launchEnabled
                          ? ` (${t("projects.runtimeLaunchDisabled")})`
                          : ""}
                    </option>
                  ))}
                </select>
                {launchableRuntimeAdapters.length === 0 && !adapterDiscoveryLoading ? (
                  <div className="space-y-2">
                    <p className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="size-3.5" />
                      {!dependenciesLoading && terminalSetupGuidance.blocked
                        ? t(terminalSetupGuidance.titleKey)
                        : t("projects.noLaunchableRuntimeCli")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {!dependenciesLoading && terminalSetupGuidance.blocked
                        ? t(terminalSetupGuidance.descriptionKey)
                        : t("projects.runtimeCliRecoveryDescription")}
                    </p>
                    {!dependenciesLoading && terminalSetupGuidance.blocked && (
                      <RuntimeSetupCommands guidance={terminalSetupGuidance} />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href="/settings">{t("projects.openSettings")}</Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={projectCopilotHref}>{t("projects.askCopilotReadiness")}</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("projects.runtimeCliDescription")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="config-template">{t("projects.configTemplate")}</Label>
                <select
                  id="config-template"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={selectedTemplateId}
                  onChange={(event) => {
                    setSelectedTemplateId(event.target.value);
                    setConfigConflicts([]);
                    setConfigDecisions({});
                  }}
                >
                  {builtinTemplateOptions.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                  {templates.filter((template) => !builtinTemplateOptions.some((builtin) => builtin.id === template.id)).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {t("projects.configTemplateDescription")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="session-model">{t("projects.model")}</Label>
                <select
                  id="session-model"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={selectedModelId}
                  onChange={(event) => setSelectedModelId(event.target.value)}
                >
                  <option value="">{t("projects.noModel")}</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}{model.isDefault ? ` (${t("models.default")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="credential-mode">{t("projects.authenticationMethod")}</Label>
                <select
                  id="credential-mode"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={credentialMode}
                  onChange={(event) => setCredentialMode(event.target.value as CredentialMode)}
                >
                  <option value="host_environment">{t("projects.hostEnvironment")}</option>
                  <option value="stored_encrypted_key">{t("projects.storedCredential")}</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {credentialMode === "host_environment"
                    ? t("projects.hostEnvironmentDescription")
                    : t("projects.storedCredentialDescription")}
                </p>
              </div>
              {credentialMode === "stored_encrypted_key" && (
                <div className="space-y-2">
                  <Label htmlFor="session-api-key">{t("projects.apiKey")}</Label>
                  <select
                    id="session-api-key"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    value={selectedApiKeyId}
                    onChange={(event) => setSelectedApiKeyId(event.target.value)}
                  >
                    <option value="">{t("projects.noApiKey")}</option>
                    {apiKeys.map((apiKey) => (
                      <option key={apiKey.id} value={apiKey.id}>
                        {apiKey.label ?? apiKey.provider}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </CardContent>
          </Card>

          {(previewConfigMutation.data || configConflicts.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("projects.configPreview")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div>{t("projects.previewFiles")}: {previewConfigMutation.data?.plan.files.length ?? 0}</div>
                  <p>{t("projects.configPreviewDescription")}</p>
                </div>
                {configConflicts.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t("projects.conflicts")}</div>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {configConflicts.map((conflict) => (
                        <li
                          key={conflict.relativePath}
                          className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-foreground">{conflict.relativePath}</span>
                              <Badge variant={conflict.conflictType === "modified" ? "destructive" : "secondary"}>
                                {conflict.conflictType}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs">
                              {conflict.existingSha256 && (
                                <span>{t("projects.existingHash")}: {shortHash(conflict.existingSha256)}</span>
                              )}
                              {conflict.incomingSha256 && (
                                <span>{t("projects.incomingHash")}: {shortHash(conflict.incomingSha256)}</span>
                              )}
                            </div>
                            {conflict.diffPreview && conflict.diffPreview.length > 0 && (
                              <div className="overflow-hidden rounded-md border border-border bg-muted/40">
                                {conflict.diffPreview.map((line) => (
                                  <div key={line.line} className="grid gap-0 border-b border-border/60 last:border-b-0 md:grid-cols-[72px_1fr_1fr]">
                                    <div className="bg-background/70 px-2 py-1 font-mono text-[11px] text-muted-foreground">L{line.line}</div>
                                    <div className="min-w-0 border-border px-2 py-1 font-mono text-[11px] text-destructive md:border-l">
                                      <span className="mr-1 select-none">-</span>{line.existing}
                                    </div>
                                    <div className="min-w-0 border-border px-2 py-1 font-mono text-[11px] text-emerald-600 md:border-l dark:text-emerald-400">
                                      <span className="mr-1 select-none">+</span>{line.incoming}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {conflict.allowedActions.length > 0 ? (
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              value={configDecisions[conflict.relativePath] ?? "skip"}
                              onChange={(event) =>
                                setConfigDecisions((current) => ({
                                  ...current,
                                  [conflict.relativePath]: event.target.value as ConfigDecision,
                                }))
                              }
                              aria-label={`${t("projects.conflictDecision")} ${conflict.relativePath}`}
                            >
                              {conflict.allowedActions.map((action) => (
                                <option key={action} value={action}>
                                  {action === "overwrite"
                                    ? t("projects.overwrite")
                                    : t("projects.skip")}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Badge variant="destructive">{t("projects.blocked")}</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">{t("projects.noConflicts")}</div>
                )}
                <Button
                  onClick={() => applyConfigMutation.mutate()}
                  disabled={
                    applyConfigMutation.isPending ||
                    configConflicts.some((conflict) => conflict.allowedActions.length === 0)
                  }
                >
                  <FileCode2 className="mr-2 size-4" />
                  {applyConfigMutation.isPending ? t("projects.generating") : t("projects.applyConfig")}
                </Button>
              </CardContent>
            </Card>
          )}

          {complianceMutation.data && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3 text-base">
                  <span>{t("projects.configCompliance")}</span>
                  <Badge
                    variant={
                      complianceMutation.data.compliance.status === "compliant"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {complianceMutation.data.compliance.status === "compliant"
                      ? t("projects.compliant")
                      : t("projects.needsAttention")}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 text-sm md:grid-cols-5">
                  <ComplianceMetric
                    label={t("projects.totalFiles")}
                    value={complianceMutation.data.compliance.totalFiles}
                  />
                  <ComplianceMetric
                    label={t("projects.missingFiles")}
                    value={complianceMutation.data.compliance.missingFiles.length}
                  />
                  <ComplianceMetric
                    label={t("projects.identicalFiles")}
                    value={complianceMutation.data.compliance.identicalFiles.length}
                  />
                  <ComplianceMetric
                    label={t("projects.staleFiles")}
                    value={complianceMutation.data.compliance.staleFiles.length}
                  />
                  <ComplianceMetric
                    label={t("projects.unsafeFiles")}
                    value={complianceMutation.data.compliance.unsafeFiles.length}
                  />
                </div>
                {complianceMutation.data.compliance.requiresDecision.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t("projects.requiresDecision")}</div>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {complianceMutation.data.compliance.requiresDecision.map((relativePath) => (
                        <li key={relativePath}>{relativePath}</li>
                      ))}
                    </ul>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => previewConfigMutation.mutate()}
                      disabled={previewConfigMutation.isPending}
                    >
                      <FileCode2 className="mr-2 size-4" />
                      {t("projects.reviewConfig")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {previewConfigMutation.isError && (
            <p className="text-sm text-destructive">
              {previewConfigMutation.error instanceof Error
                ? previewConfigMutation.error.message
                : t("projects.failedGenerateConfig")}
            </p>
          )}

          {complianceMutation.isError && (
            <p className="text-sm text-destructive">
              {complianceMutation.error instanceof Error
                ? complianceMutation.error.message
                : t("projects.failedCompliance")}
            </p>
          )}

          {applyConfigMutation.isError && (
            <p className="text-sm text-destructive">
              {applyConfigMutation.error instanceof Error
                ? applyConfigMutation.error.message
                : t("projects.failedGenerateConfig")}
            </p>
          )}

          {createSessionMutation.isError && (
            <p className="text-sm text-destructive">
              {createSessionMutation.error instanceof Error
                ? createSessionMutation.error.message
                : t("projects.failedCreateSession")}
            </p>
          )}

          {deleteMutation.isError && (
            <p className="text-sm text-destructive">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("projects.deleteFailed")}
            </p>
          )}

          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:thin]">
            <TabsList className="min-w-max">
              <TabsTrigger value="sessions">{t("nav.sessions")}</TabsTrigger>
              <TabsTrigger value="project-manager">{t("projects.projectManager")}</TabsTrigger>
              <TabsTrigger value="agents">{t("nav.agents")}</TabsTrigger>
              <TabsTrigger value="orchestration">{t("projects.orchestration")}</TabsTrigger>
              <TabsTrigger value="skills">{t("nav.skills")}</TabsTrigger>
              <TabsTrigger value="config">{t("projects.aiConfig")}</TabsTrigger>
              <TabsTrigger value="activity">{t("sessions.activity")}</TabsTrigger>
            </TabsList>
            </div>

            <TabsContent value="sessions" className="mt-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                {projectSessions.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      {t("projects.noSessions")}
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("common.name")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                          <TableHead className="text-right">{t("projects.action")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {projectSessions.map((session) => (
                          <TableRow key={session.id}>
                            <TableCell className="font-medium">
                              {session.name || session.tmuxName || session.id}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  session.status === "running"
                                    ? "default"
                                    : session.status === "error"
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {session.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Link href={`/sessions/${session.id}`}>
                                <Button variant="ghost" size="sm">
                                  <Play className="mr-2 size-3" />
                                  {t("common.connect")}
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                )}
                <WorkspaceContextPanel projectId={id} enabled={activeTab === "sessions"} />
              </div>
            </TabsContent>

            <TabsContent value="project-manager" className="mt-4">
              <ProjectManagerPanel
                projectId={id}
                enabled={activeTab === "project-manager"}
                selectedWorkItemId={projectManagerWorkItemId}
              />
            </TabsContent>

            <TabsContent value="agents" className="mt-4">
              <div className="mb-3 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => defaultAgentPackMutation.mutate()}
                  disabled={defaultAgentPackMutation.isPending}
                >
                  <Sparkles className="mr-2 size-4" />
                  {defaultAgentPackMutation.isPending
                    ? t("projects.creatingAgentPack")
                    : t("projects.createAgentPack")}
                </Button>
              </div>
              {projectAgents.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    {t("projects.noAgents")}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("common.name")}</TableHead>
                        <TableHead>{t("projects.model")}</TableHead>
                        <TableHead>{t("common.status")}</TableHead>
                        <TableHead className="text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projectAgents.map((agent) => (
                        <TableRow key={agent.id}>
                          <TableCell className="font-medium">
                            {agent.name}
                          </TableCell>
                          <TableCell>{agent.model ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {agent.status ?? "idle"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  agentStatusMutation.mutate({
                                    agentId: agent.id,
                                    status: agent.status === "disabled" ? "active" : "disabled",
                                  })
                                }
                              >
                                <Power className="size-4" />
                                <span className="sr-only">{t("agents.toggleStatus")}</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                onClick={() => {
                                  if (window.confirm(t("agents.deleteConfirm"))) {
                                    agentDeleteMutation.mutate(agent.id);
                                  }
                                }}
                              >
                                <Trash2 className="size-4" />
                                <span className="sr-only">{t("common.delete")}</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
              {defaultAgentPackMutation.isError && (
                <p className="mt-3 text-sm text-destructive">
                  {defaultAgentPackMutation.error instanceof Error
                    ? defaultAgentPackMutation.error.message
                    : t("projects.failedAgentPack")}
                </p>
              )}
            </TabsContent>

            <TabsContent value="orchestration" className="mt-4">
              {orderedProjectAgents.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    {t("projects.noOrchestrationAgents")}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-3 text-base">
                      <span>{t("projects.agentSequence")}</span>
                      <Button
                        size="sm"
                        onClick={() => agentSequenceMutation.mutate()}
                        disabled={agentSequenceMutation.isPending}
                      >
                        <Save className="mr-2 size-4" />
                        {agentSequenceMutation.isPending
                          ? t("projects.savingSequence")
                          : t("projects.saveSequence")}
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("projects.order")}</TableHead>
                        <TableHead>{t("common.name")}</TableHead>
                        <TableHead>{t("common.status")}</TableHead>
                        <TableHead className="text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderedProjectAgents.map((agent, index) => (
                        <TableRow key={agent.id}>
                          <TableCell className="font-mono text-xs">{index + 1}</TableCell>
                          <TableCell className="font-medium">{agent.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{agent.status ?? "active"}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => moveAgentInSequence(agent.id, "up")}
                                disabled={index === 0}
                              >
                                <ArrowUp className="size-4" />
                                <span className="sr-only">{t("projects.moveAgentUp")}</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => moveAgentInSequence(agent.id, "down")}
                                disabled={index === orderedProjectAgents.length - 1}
                              >
                                <ArrowDown className="size-4" />
                                <span className="sr-only">{t("projects.moveAgentDown")}</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
              {agentSequenceMutation.isError && (
                <p className="mt-3 text-sm text-destructive">
                  {agentSequenceMutation.error instanceof Error
                    ? agentSequenceMutation.error.message
                    : t("projects.failedSaveSequence")}
                </p>
              )}
            </TabsContent>

            <TabsContent value="skills" className="mt-4">
              {skills.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    {t("skills.emptyTitle")}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("common.name")}</TableHead>
                        <TableHead>{t("skills.source")}</TableHead>
                        <TableHead>{t("skills.enabledForProject")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {skills.map((skill) => {
                        const projectSkill = projectSkillById.get(skill.id);
                        return (
                          <TableRow key={skill.id}>
                            <TableCell className="font-medium">
                              <div>{skill.name}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {projectSkillStateLabel(projectSkill?.selectionState, t)}
                              </div>
                            </TableCell>
                            <TableCell>{skill.source}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Switch
                                  checked={enabledSkillIds.has(skill.id)}
                                  onCheckedChange={(enabled) =>
                                    projectSkillMutation.mutate({ skillId: skill.id, enabled })
                                  }
                                  disabled={projectSkillMutation.isPending}
                                />
                                <Badge variant={enabledSkillIds.has(skill.id) ? "default" : "secondary"}>
                                  {enabledSkillIds.has(skill.id) ? t("common.enabled") : t("common.disabled")}
                                </Badge>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="config" className="mt-4">
              <ProjectConfigPanel
                projectConfig={projectAiConfig}
                globalConfig={globalAiConfig}
                selectedPath={selectedConfigPath}
                draft={configDraft}
                projectLoading={projectAiConfigLoading}
                globalLoading={globalAiConfigLoading}
                isSaving={updateAiConfigMutation.isPending}
                error={updateAiConfigMutation.error}
                onSelectedPathChange={setSelectedConfigPath}
                onDraftChange={setConfigDraft}
                onSave={() => updateAiConfigMutation.mutate()}
              />
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <ProjectActivityList
                activities={projectActivities}
                agents={projectAgents}
                selectedAgentId={activityAgentId}
                onSelectedAgentIdChange={setActivityAgentId}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function shortHash(value: string): string {
  return value.slice(0, 10);
}

function ProjectStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function projectSkillStateLabel(
  state: string | undefined,
  t: (key: "projects.skillProjectEnabled" | "projects.skillProjectDisabled" | "projects.skillInheritedDisabled" | "projects.skillInheritedEnabled") => string
): string {
  if (state === "project_enabled") return t("projects.skillProjectEnabled");
  if (state === "project_disabled") return t("projects.skillProjectDisabled");
  if (state === "inherited_disabled") return t("projects.skillInheritedDisabled");
  return t("projects.skillInheritedEnabled");
}

function ProjectConfigPanel({
  projectConfig,
  globalConfig,
  selectedPath,
  draft,
  projectLoading,
  globalLoading,
  isSaving,
  error,
  onSelectedPathChange,
  onDraftChange,
  onSave
}: {
  projectConfig?: AiConfigSnapshot;
  globalConfig?: AiConfigSnapshot;
  selectedPath: string;
  draft: string;
  projectLoading: boolean;
  globalLoading: boolean;
  isSaving: boolean;
  error: unknown;
  onSelectedPathChange: (path: string) => void;
  onDraftChange: (content: string) => void;
  onSave: () => void;
}) {
  const { t } = useLanguage();
  const [formEditError, setFormEditError] = useState("");
  const projectFiles = projectConfig?.files ?? [];
  const globalFiles = globalConfig?.files ?? [];
  const selectedFile = projectFiles.find((file) => file.relativePath === selectedPath);
  const matchingForms = formsForFile(projectConfig?.forms ?? [], selectedPath);

  useEffect(() => {
    setFormEditError("");
  }, [selectedPath]);

  function updateDraftFromForm(field: AiConfigFormField, value: AiConfigFormValue) {
    if (!selectedFile) return;
    const result = updateAiConfigDraft(draft, selectedFile.fileType, field, value);
    if (result.error) {
      setFormEditError(result.error);
      return;
    }
    setFormEditError("");
    onDraftChange(result.content);
  }

  if (projectLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" />
            {t("projects.projectConfigFiles")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {projectFiles.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t("projects.noConfigFiles")}</div>
          ) : (
            projectFiles.map((file) => (
              <button
                key={file.relativePath}
                type="button"
                className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  file.relativePath === selectedPath
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background hover:bg-muted"
                }`}
                onClick={() => onSelectedPathChange(file.relativePath)}
              >
                <span className="min-w-0 truncate font-mono text-xs">{file.relativePath}</span>
                <Badge variant={file.exists ? "secondary" : "outline"}>
                  {file.exists ? t("projects.configExists") : t("projects.configMissing")}
                </Badge>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span className="min-w-0 truncate font-mono text-sm">
              {selectedFile?.relativePath ?? t("projects.selectConfigFile")}
            </span>
            <Button
              size="sm"
              onClick={onSave}
              disabled={!selectedFile || isSaving}
            >
              <Save className="mr-2 size-4" />
              {isSaving ? t("projects.savingConfig") : t("common.save")}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {matchingForms.length > 0 && (
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
              <div className="text-sm font-medium">{t("projects.formFields")}</div>
              {matchingForms.map((form) => (
                <div key={form.filePath} className="space-y-2">
                  <div className="text-xs text-muted-foreground">{form.title}</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {form.fields.map((field) => (
                      <AiConfigFieldControl
                        key={field.key}
                        field={field}
                        fileType={selectedFile?.fileType ?? "text"}
                        draft={draft}
                        disabled={!selectedFile}
                        onChange={(value) => updateDraftFromForm(field, value)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {formEditError && (
                <p className="text-xs text-destructive">{formEditError}</p>
              )}
            </div>
          )}
          <SyntaxHighlightedEditor
            content={draft}
            fileType={selectedFile?.fileType ?? "text"}
            disabled={!selectedFile}
            ariaLabel={selectedFile?.relativePath ?? t("projects.selectConfigFile")}
            onChange={onDraftChange}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {selectedFile && (
              <>
                <Badge variant="outline">{selectedFile.fileType}</Badge>
                <Badge variant="outline">{selectedFile.role}</Badge>
                <span>{selectedFile.sizeBytes} bytes</span>
              </>
            )}
          </div>
          {Boolean(error) && (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : t("projects.failedSaveConfig")}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="size-4" />
              {t("projects.globalConfigReadOnly")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {globalLoading ? (
              <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
            ) : globalFiles.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t("projects.noGlobalConfig")}</div>
            ) : (
              globalFiles.map((file) => (
                <GlobalConfigPreview key={file.relativePath} file={file} />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AiConfigFieldControl({
  field,
  fileType,
  draft,
  disabled,
  onChange
}: {
  field: AiConfigFormField;
  fileType: string;
  draft: string;
  disabled: boolean;
  onChange: (value: AiConfigFormValue) => void;
}) {
  const value = readAiConfigFieldValue(draft, fileType, field);
  const textValue = formValueToText(value);
  const controlClass =
    "w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

  if (field.inputType === "boolean") {
    return (
      <div className="rounded-md border border-border px-2 py-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span>{field.label}</span>
          <Switch
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
            aria-label={field.label}
          />
        </div>
      </div>
    );
  }

  if (field.inputType === "select") {
    return (
      <label className="block space-y-1 rounded-md border border-border px-2 py-2 text-xs">
        <span>{field.label}</span>
        <select
          className={controlClass}
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          <option value="" />
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.inputType === "textarea" || field.inputType === "list") {
    return (
      <label className="block space-y-1 rounded-md border border-border px-2 py-2 text-xs">
        <span>{field.label}</span>
        <textarea
          className={`${controlClass} min-h-24 resize-y font-mono`}
          value={textValue}
          onChange={(event) => onChange(textToFormValue(event.target.value, field))}
          disabled={disabled}
          spellCheck={false}
        />
      </label>
    );
  }

  return (
    <label className="block space-y-1 rounded-md border border-border px-2 py-2 text-xs">
      <span>{field.label}</span>
      <input
        className={controlClass}
        type={field.inputType === "number" ? "number" : "text"}
        value={textValue}
        onChange={(event) => onChange(textToFormValue(event.target.value, field))}
        disabled={disabled}
      />
    </label>
  );
}

function SyntaxHighlightedEditor({
  content,
  fileType,
  disabled,
  ariaLabel,
  onChange,
  readOnly = false,
  minHeightClassName = "min-h-[560px]"
}: {
  content: string;
  fileType: string;
  disabled: boolean;
  ariaLabel: string;
  onChange?: (content: string) => void;
  readOnly?: boolean;
  minHeightClassName?: string;
}) {
  const previewRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const hasHighlighting = supportsSyntaxHighlighting(fileType);
  const highlightedParts = useMemo(
    () => hasHighlighting ? highlightCode(content, fileType) : [{ text: content }],
    [content, fileType, hasHighlighting]
  );
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(content.split("\n").length, 1) }, (_, index) => index + 1),
    [content]
  );

  function syncPreviewScroll(event: UIEvent<HTMLTextAreaElement>) {
    const preview = previewRef.current;
    const gutter = gutterRef.current;
    if (preview) {
      preview.scrollTop = event.currentTarget.scrollTop;
      preview.scrollLeft = event.currentTarget.scrollLeft;
    }
    if (gutter) {
      gutter.scrollTop = event.currentTarget.scrollTop;
    }
  }

  function syncGutterScroll(event: UIEvent<HTMLPreElement>) {
    const gutter = gutterRef.current;
    if (gutter) {
      gutter.scrollTop = event.currentTarget.scrollTop;
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-[#05070a] shadow-inner shadow-black/30">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/80 px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {readOnly ? "Readonly config" : "Live syntax editor"}
        </span>
        <Badge variant="outline" className="border-slate-700 bg-slate-900/80 text-[10px] text-slate-300">
          {hasHighlighting ? fileType : "plain"}
        </Badge>
      </div>
      <div className={cn("grid grid-cols-[3.5rem_minmax(0,1fr)]", minHeightClassName)}>
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="overflow-hidden border-r border-slate-800 bg-slate-950/70 px-2 py-4 text-right font-mono text-[11px] leading-6 text-slate-600 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {lineNumbers.map((lineNumber) => (
            <div key={lineNumber}>{lineNumber}</div>
          ))}
        </div>
        <div className="relative min-w-0">
          <pre
            ref={previewRef}
            aria-hidden={!readOnly}
            onScroll={readOnly ? syncGutterScroll : undefined}
            className={cn(
              "inset-0 whitespace-pre p-4 font-mono text-[13px] leading-6 text-slate-200",
              readOnly
                ? "h-full max-h-[420px] overflow-auto"
                : "pointer-events-none absolute overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            )}
          >
            {highlightedParts.map((part, index) => (
              <span key={`${index}-${part.text}`} className={part.className}>
                {part.text}
              </span>
            ))}
          </pre>
          {!readOnly && (
            <textarea
              className="absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent p-4 font-mono text-[13px] leading-6 text-transparent caret-sky-300 outline-none selection:bg-sky-500/30 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
              value={content}
              onChange={(event) => onChange?.(event.target.value)}
              onScroll={syncPreviewScroll}
              spellCheck={false}
              disabled={disabled}
              aria-label={ariaLabel}
              wrap="off"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GlobalConfigPreview({ file }: { file: AiConfigFile }) {
  const { t } = useLanguage();
  return (
    <details className="rounded-md border border-border bg-background px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-xs">{file.relativePath}</span>
        <Badge variant={file.exists ? "secondary" : "outline"}>
          {file.exists ? t("projects.configExists") : t("projects.configMissing")}
        </Badge>
      </summary>
      {file.content ? (
        <div className="mt-2">
          <SyntaxHighlightedEditor
            content={file.content}
            fileType={file.fileType}
            disabled
            readOnly
            ariaLabel={file.relativePath}
            minHeightClassName="min-h-[260px]"
          />
        </div>
      ) : (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs leading-5 text-muted-foreground">
          {t("projects.noGlobalConfigContent")}
        </pre>
      )}
    </details>
  );
}

function formsForFile(forms: AiConfigForm[], filePath: string): AiConfigForm[] {
  return forms.filter((form) => form.filePath === filePath);
}

function ProjectActivityList({
  activities,
  agents,
  selectedAgentId,
  onSelectedAgentIdChange
}: {
  activities: SessionActivity[];
  agents: Agent[];
  selectedAgentId: string;
  onSelectedAgentIdChange: (agentId: string) => void;
}) {
  const { t } = useLanguage();

  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <ProjectActivityFilter
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectedAgentIdChange={onSelectedAgentIdChange}
          />
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
          <Activity className="size-5" />
          {t("sessions.noActivity")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-muted-foreground" />
            {t("sessions.activity")}
          </CardTitle>
          <ProjectActivityFilter
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectedAgentIdChange={onSelectedAgentIdChange}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {activities.map((activity) => (
            <div key={activity.id} className="grid gap-2 py-3 md:grid-cols-[160px_1fr_120px] md:items-center">
              <Badge variant={activity.status === "error" ? "destructive" : "secondary"} className="w-fit">
                {activity.type}
              </Badge>
              <div className="min-w-0">
                <p className="break-words text-sm text-foreground">{activity.message}</p>
                {activity.sessionId && (
                  <Link href={`/sessions/${activity.sessionId}`} className="text-xs text-muted-foreground hover:text-foreground">
                    {activity.sessionId}
                  </Link>
                )}
              </div>
              <span className="text-xs text-muted-foreground md:text-right">
                {formatProjectActivityTime(activity.createdAt)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectActivityFilter({
  agents,
  selectedAgentId,
  onSelectedAgentIdChange
}: {
  agents: Agent[];
  selectedAgentId: string;
  onSelectedAgentIdChange: (agentId: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <select
      className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      value={selectedAgentId}
      onChange={(event) => onSelectedAgentIdChange(event.target.value)}
      aria-label={t("sessions.filterByAgent")}
    >
      <option value="">{t("sessions.allAgents")}</option>
      {agents.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </select>
  );
}

function ComplianceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readProjectDetailTab(value: string | null): ProjectDetailTab | null {
  const normalized = normalizeSearchParam(value);
  if (!normalized) return null;
  return PROJECT_DETAIL_TABS.includes(normalized as ProjectDetailTab) ? normalized as ProjectDetailTab : null;
}

function normalizeSearchParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatProjectActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
