"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Eye, FileCode2, FileText, Globe2, History, Pencil, Plus, Save, ShieldCheck, TerminalSquare, Trash2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { ProjectManagerPanel } from "@/components/projects/ProjectManagerPanel";
import { ConfigSyncPanel, type ConfigSyncPanelHandle } from "@/components/projects/ConfigSyncPanel";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import { WorkspaceContextPanel } from "@/components/projects/WorkspaceContextPanel";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getProject,
  getGlobalAiConfig,
  getProjectAiConfig,
  getDependencies,
  discoverAdapters,
  listSessions,
  createSession,
  listActivities,
  deleteProject,
  listProjectSkills,
  listSkills,
  setProjectSkill,
  updateProjectAiConfigFile,
  chooseDefaultRuntimeAdapter,
  isAdapterLaunchable,
  type RuntimeAdapterId,
  type AiConfigFile,
  type AiConfigSnapshot,
  type SessionActivity,
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";
import { normalizeSessionStatus } from "@/lib/session-status";
import { highlightCode, supportsSyntaxHighlighting } from "@/lib/syntax-highlight";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/projects/markdown-renderer";

const PROJECT_DETAIL_TABS = [
  "sessions",
  "project-manager",
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
  const [selectedRuntimeAdapter, setSelectedRuntimeAdapter] = useState<RuntimeAdapterId | "">("");
  const [selectedConfigPath, setSelectedConfigPath] = useState("");
  const [configDraft, setConfigDraft] = useState("");
  const [syncPending, setSyncPending] = useState({ preview: false, compliance: false });
  const configSyncRef = useRef<ConfigSyncPanelHandle>(null);

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
    queryKey: ["activities", { projectId: id }],
    queryFn: () => listActivities({ projectId: id }),
    enabled: !!id && activeTab === "activity",
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

  const { data: adapterDiscoveryData, isLoading: adapterDiscoveryLoading } = useQuery({
    queryKey: ["adapters", "discovery"],
    queryFn: discoverAdapters,
  });

  const { data: dependenciesData, isLoading: dependenciesLoading } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
  });

  const { data: projectAiConfigData, isLoading: projectAiConfigLoading } = useQuery({
    queryKey: ["project-ai-config", id, selectedRuntimeAdapter],
    queryFn: () => getProjectAiConfig(id, selectedRuntimeAdapter || undefined),
    enabled: !!id && !!selectedRuntimeAdapter,
  });

  const { data: globalAiConfigData, isLoading: globalAiConfigLoading } = useQuery({
    queryKey: ["project-ai-config-global", id, selectedRuntimeAdapter],
    queryFn: () => getGlobalAiConfig(id, selectedRuntimeAdapter || undefined),
    enabled: !!id && !!selectedRuntimeAdapter,
  });

  const createSessionMutation = useMutation({
    mutationFn: () => {
      if (!selectedRuntimeAdapter) {
        throw new Error(t("projects.selectRuntimeCli"));
      }
      return createSession({
        projectId: id,
        credentialMode: "host_environment",
        aiTool: selectedRuntimeAdapter,
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

  const projectSkillMutation = useMutation({
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      setProjectSkill(id, skillId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-skills", id] });
    },
  });

  const updateAiConfigMutation = useMutation({
    mutationFn: () =>
      updateProjectAiConfigFile(id, selectedConfigPath, configDraft, selectedRuntimeAdapter || undefined),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["project-ai-config", id, selectedRuntimeAdapter], snapshot);
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });

  const project = projectData?.project;
  const projectSessions = useMemo(
    () => sessionsData?.sessions ?? [],
    [sessionsData?.sessions]
  );
  const projectActivities = useMemo(
    () => activitiesData?.activities ?? [],
    [activitiesData?.activities]
  );
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
  const resolvedTemplateId = project?.templateId ?? null;
  const isUntrackedTemplate = !!project && project.templateId === null;
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
  const cannotCreateSession =
    createSessionMutation.isPending ||
    adapterDiscoveryLoading ||
    !selectedRuntimeAdapter ||
    !selectedRuntimeLaunchable;
  const configNeedsReview = ["failed", "needs_review"].includes(searchParams.get("configStatus") ?? "");
  const projectManagerWorkItemId = normalizeSearchParam(searchParams.get("workItemId"));
  const runningSessionCount = projectSessions.filter((session) => session.status === "running").length;
  const enabledSkillCount = enabledSkillIds.size;

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
    if (!adapterDiscoveryData?.adapters) return;
    const nextAdapter = chooseDefaultRuntimeAdapter(adapterDiscoveryData.adapters, selectedRuntimeAdapter);
    setSelectedRuntimeAdapter((current) => current === (nextAdapter ?? "") ? current : (nextAdapter ?? ""));
  }, [adapterDiscoveryData?.adapters, selectedRuntimeAdapter]);

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

  const projectStats = [
    {
      label: t("nav.sessions"),
      value: projectSessions.length,
      sub: t("dashboard.runningNow").replace("{count}", String(runningSessionCount)),
      icon: TerminalSquare,
    },
    {
      label: t("nav.skills"),
      value: enabledSkillCount,
      icon: Wrench,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="of-animate-in">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => router.push("/projects")}
        >
          <ArrowLeft className="size-4" />
          {t("projects.back")}
        </Button>
      </div>

      {projectLoading ? (
        <Card className="of-animate-in">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("projects.loadingOne")}
          </CardContent>
        </Card>
      ) : !project ? (
        <Card className="of-animate-in">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("projects.notFound")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3 of-animate-in">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-xl font-semibold tracking-tight">{project.name}</h1>
                {project.status && <Badge variant="outline">{project.status}</Badge>}
              </div>
              <p className="mt-1 break-all font-mono text-sm text-muted-foreground">
                {project.path ?? project.rootPath}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={() => createSessionMutation.mutate()}
                disabled={cannotCreateSession}
              >
                <Plus className="size-4" />
                {createSessionMutation.isPending ? t("projects.creating") : t("projects.newSession")}
              </Button>
              {!isUntrackedTemplate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => configSyncRef.current?.checkCompliance()}
                  disabled={syncPending.compliance}
                >
                  <ShieldCheck className="size-4" />
                  {syncPending.compliance ? t("projects.checkingCompliance") : t("projects.checkCompliance")}
                </Button>
              )}
              {!isUntrackedTemplate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => configSyncRef.current?.preview()}
                  disabled={syncPending.preview}
                >
                  <FileCode2 className="size-4" />
                  {syncPending.preview ? t("projects.generating") : t("projects.previewConfig")}
                </Button>
              )}
              <Button asChild size="sm" variant="ghost">
                <Link href={`/history?projectId=${project.id}`}>
                  <History className="size-4" />
                  {t("nav.history")}
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (window.confirm(t("projects.deleteConfirm"))) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="size-4" />
                {deleteMutation.isPending ? t("projects.deleting") : t("projects.deleteRecord")}
              </Button>
            </div>
          </div>

          {/* Project stats */}
          <div className="grid grid-cols-3 gap-3">
            {projectStats.map((stat, index) => (
              <Card
                key={stat.label}
                className="of-animate-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                    <stat.icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-semibold leading-none tabular-nums">{stat.value}</div>
                    <div className="mt-1.5 truncate text-xs text-muted-foreground">
                      {stat.label}
                      {stat.sub ? <span className="text-muted-foreground/70"> · {stat.sub}</span> : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Launch options */}
          <Card className="of-animate-in" style={{ animationDelay: "150ms" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                <Label htmlFor="runtime-adapter" className="cursor-pointer">
                  {t("projects.launchOptions")}
                </Label>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <select
                id="runtime-adapter"
                className="h-9 w-full max-w-xl rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
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
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
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
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("projects.runtimeCliDescription")}
                </p>
              )}
            </CardContent>
          </Card>

          {configNeedsReview && !isUntrackedTemplate && (
            <Card className="of-animate-in border-amber-500/40 bg-amber-500/10">
              <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-400">
                    <AlertTriangle className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{t("projects.configNeedsReviewTitle")}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("projects.configNeedsReviewDescription")}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => configSyncRef.current?.preview()}
                  disabled={syncPending.preview}
                >
                  <FileCode2 className="size-4" />
                  {syncPending.preview
                    ? t("projects.generating")
                    : t("projects.reviewConfig")}
                </Button>
              </CardContent>
            </Card>
          )}

          <ConfigSyncPanel
            ref={configSyncRef}
            projectId={id}
            templateId={resolvedTemplateId}
            credentialMode="host_environment"
            onPendingChange={setSyncPending}
          />

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
              <TabsTrigger value="skills">{t("nav.skills")}</TabsTrigger>
              <TabsTrigger value="config">{t("projects.aiConfig")}</TabsTrigger>
              <TabsTrigger value="activity">{t("sessions.activity")}</TabsTrigger>
            </TabsList>
            </div>

            <TabsContent value="sessions" className="mt-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                {projectSessions.length === 0 ? (
                  <Card className="of-animate-in">
                    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                      <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                        <TerminalSquare className="size-5" />
                      </div>
                      <div className="text-sm font-medium">{t("projects.noSessions")}</div>
                      <Button
                        size="sm"
                        className="bg-brand text-brand-foreground hover:bg-brand/90"
                        onClick={() => createSessionMutation.mutate()}
                        disabled={cannotCreateSession}
                      >
                        <Plus className="size-4" />
                        {t("projects.newSession")}
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
                    {projectSessions.map((session, index) => (
                      <Link
                        key={session.id}
                        href={`/sessions/${session.id}`}
                        className="group flex items-center gap-3 px-4 py-3 transition-colors of-animate-in hover:bg-muted/40"
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <SessionStatusDot status={session.status} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {session.name || session.tmuxName || session.id}
                          </div>
                        </div>
                        <CliBrandChip aiTool={session.aiTool} />
                        <SessionStatusText status={session.status} />
                        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-brand" />
                      </Link>
                    ))}
                  </div>
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

            <TabsContent value="skills" className="mt-4">
              {skills.length === 0 ? (
                <Card className="of-animate-in">
                  <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                    <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                      <Wrench className="size-5" />
                    </div>
                    <div className="text-sm font-medium">{t("skills.emptyTitle")}</div>
                  </CardContent>
                </Card>
              ) : (
                <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
                  {skills.map((skill, index) => {
                    const projectSkill = projectSkillById.get(skill.id);
                    const isEnabled = enabledSkillIds.has(skill.id);
                    return (
                      <div
                        key={skill.id}
                        className="flex items-center gap-3 px-4 py-3 transition-colors of-animate-in hover:bg-muted/40"
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{skill.name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {projectSkillStateLabel(projectSkill?.selectionState, t)}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">{skill.source}</Badge>
                        <div className="flex shrink-0 items-center gap-2">
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(enabled) =>
                              projectSkillMutation.mutate({ skillId: skill.id, enabled })
                            }
                            disabled={projectSkillMutation.isPending}
                          />
                          <span
                            className={cn(
                              "w-10 shrink-0 text-xs",
                              isEnabled ? "text-emerald-400" : "text-muted-foreground"
                            )}
                          >
                            {isEnabled ? t("common.enabled") : t("common.disabled")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              <ProjectActivityList activities={projectActivities} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function SessionStatusDot({ status }: { status: string }) {
  const normalized = normalizeSessionStatus(status);
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        normalized === "running"
          ? "animate-pulse bg-emerald-400"
          : normalized === "error"
            ? "bg-red-400"
            : "bg-muted-foreground/40"
      )}
    />
  );
}

function SessionStatusText({ status }: { status: string }) {
  const { t } = useLanguage();
  const normalized = normalizeSessionStatus(status);
  return (
    <span
      className={cn(
        "shrink-0 text-xs",
        normalized === "running"
          ? "text-emerald-400"
          : normalized === "error"
            ? "text-red-400"
            : "text-muted-foreground"
      )}
    >
      {normalized === "running"
        ? t("sessions.running")
        : normalized === "error"
          ? t("sessions.error")
          : t("sessions.stopped")}
    </span>
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
  const projectFiles = projectConfig?.files ?? [];
  const globalFiles = globalConfig?.files ?? [];
  const selectedFile = projectFiles.find((file) => file.relativePath === selectedPath);
  const isMarkdown = selectedFile?.fileType === "markdown";
  const [editingMarkdown, setEditingMarkdown] = useState(false);

  useEffect(() => {
    setEditingMarkdown(false);
  }, [selectedPath, isMarkdown]);

  if (projectLoading) {
    return (
      <Card className="of-animate-in">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="of-animate-in">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="size-4 text-brand" />
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
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  file.relativePath === selectedPath
                    ? "border-brand/50 bg-brand/10 text-foreground"
                    : "border-border/70 bg-background hover:bg-muted/40"
                )}
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

      <Card className="of-animate-in" style={{ animationDelay: "50ms" }}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="min-w-0 truncate font-mono text-sm font-semibold">
            {selectedFile?.relativePath ?? t("projects.selectConfigFile")}
          </CardTitle>
          {selectedFile && isMarkdown && !editingMarkdown ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditingMarkdown(true)}
              disabled={!selectedFile}
            >
              <Pencil className="size-4" />
              {t("projects.editFile")}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              {selectedFile && isMarkdown && editingMarkdown && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingMarkdown(false)}
                  disabled={!selectedFile}
                >
                  <Eye className="size-4" />
                  {t("projects.previewFile")}
                </Button>
              )}
              <Button
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90"
                onClick={onSave}
                disabled={!selectedFile || isSaving}
              >
                <Save className="size-4" />
                {isSaving ? t("projects.savingConfig") : t("common.save")}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedFile && isMarkdown && !editingMarkdown ? (
            <MarkdownRenderer
              content={draft}
              className="max-h-[560px] min-h-[200px] space-y-3 overflow-y-auto rounded-md border border-border/70 bg-background p-4 text-sm leading-relaxed text-foreground/90"
            />
          ) : (
            <SyntaxHighlightedEditor
              content={draft}
              fileType={selectedFile?.fileType ?? "text"}
              disabled={!selectedFile}
              ariaLabel={selectedFile?.relativePath ?? t("projects.selectConfigFile")}
              onChange={onDraftChange}
            />
          )}
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
        <Card className="of-animate-in" style={{ animationDelay: "100ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Globe2 className="size-4 text-brand" />
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
    <details className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
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

function ProjectActivityList({ activities }: { activities: SessionActivity[] }) {
  const { t } = useLanguage();

  return (
    <Card className="of-animate-in overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-brand" />
          {t("sessions.activity")}
        </CardTitle>
      </CardHeader>
      {activities.length === 0 ? (
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Activity className="size-5" />
          </div>
          <div className="text-sm font-medium">{t("sessions.noActivity")}</div>
        </CardContent>
      ) : (
        <div className="divide-y divide-border/70 border-t border-border/70">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  activity.status === "error" ? "bg-red-400" : "bg-emerald-400"
                )}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={activity.status === "error" ? "destructive" : "outline"}
                    className="w-fit"
                  >
                    {activity.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatProjectActivityTime(activity.createdAt)}
                  </span>
                </div>
                <p className="break-words text-sm text-foreground">{activity.message}</p>
                {activity.sessionId && (
                  <Link
                    href={`/sessions/${activity.sessionId}`}
                    className="inline-block break-all font-mono text-xs text-muted-foreground transition-colors hover:text-brand"
                  >
                    {activity.sessionId}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
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
