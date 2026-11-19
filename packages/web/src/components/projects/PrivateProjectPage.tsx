"use client";

import type { TaskAuthority } from "./project-manager/TaskAuthority";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowLeft, ArrowUpRight, Check, Copy, Eye, FileCode2, FileText, Globe2, Link2, MoreHorizontal, Package, Pencil, Plus, Save, Terminal, TerminalSquare, Trash2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconTile } from "@/components/ui/icon-tile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdapterSelect, ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { ConfigSyncPanel, type ConfigSyncPanelHandle } from "@/components/projects/ConfigSyncPanel";
import { ExtractTemplateDialog } from "@/components/projects/ExtractTemplateDialog";
import { ProjectEditMetadataDialog } from "@/components/projects/ProjectEditMetadataDialog";
import { ProjectOverviewPanel } from "@/components/projects/ProjectOverviewPanel";
import { buildEdgeFadeMask } from "@/components/sessions/SessionBoard";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
import { WorkspaceContextPanel } from "@/components/projects/WorkspaceContextPanel";
import { WorkspaceExplorer } from "@/components/projects/workspace";
import { GitBranchesPanel } from "@/components/projects/git-branches-panel";
import { GitChangesPanel } from "@/components/sessions/git-changes-panel";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getProject,
  getGlobalAiConfig,
  getProjectAiConfig,
  getAppliedProviderForAdapter,
  getDependencies,
  discoverAdapters,
  listSessions,
  listActivities,
  listTemplates,
  createSession,
  deleteProject,
  listProjectSkills,
  listSkills,
  setProjectSkill,
  updateProjectAiConfigFile,
  chooseDefaultRuntimeAdapter,
  isAdapterLaunchable,
  listProjectManagerTaskPackets,
  type RuntimeAdapterId,
  type AiConfigFile,
  type AiConfigSnapshot,
  type ProjectManagerTaskPacket,
  type SessionActivity,
} from "@/lib/api";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import type { GatewayEvent } from "@/lib/notifications";
import { findSessionTaskPacket, sessionTaskPacketProjectManagerHref } from "@/components/sessions/session-task-packet";
import { formatSessionRelativeTime } from "@/components/sessions/session-board-utils";
import { activityTypeLabel, projectStatusLabel, useProjectCopy } from "@/components/projects/project-copy";
import { useLanguage, useUiLocale } from "@/hooks/use-language";
import { normalizeSessionStatus } from "@/lib/session-status";
import { highlightWorkspaceCode, tokenFontStyle } from "@/components/projects/workspace/highlight";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/projects/markdown-renderer";
import { toast } from "@/lib/toast";
import { TeamHubLink } from "@/components/hub/TeamHubLink";

// Heavy tab panels are code-split so their dependencies (@xyflow/react for the
// graph, @dnd-kit for the project manager) load on first use of their tab,
// keeping the project-detail page itself fast to open on low-end machines.
const ProjectGraphPanel = dynamic(
  () => import("@/components/projects/graph/ProjectGraphPanel").then((mod) => mod.ProjectGraphPanel),
  { ssr: false }
);
const ProjectManagerPanel = dynamic(
  () => import("@/components/projects/ProjectManagerPanel").then((mod) => mod.ProjectManagerPanel),
  { ssr: false }
);

const PROJECT_DETAIL_TABS = [
  "overview",
  "sessions",
  "git",
  "files",
  "graph",
  "project-manager",
  "skills",
  "config",
  "activity",
] as const;

type ProjectDetailTab = typeof PROJECT_DETAIL_TABS[number];

export default function ProjectDetailPage({taskAuthority}: {taskAuthority: TaskAuthority}) {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t, language } = useLanguage();
  const projectCopy = useProjectCopy();
  // Client-only clock for relative session times (same SSR-avoidance pattern
  // as the sessions board).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const id = params.id as string;
  const urlTabParam = searchParams.get("tab");
  const initialWorkItemParam = normalizeSearchParam(searchParams.get("workItemId") ?? searchParams.get("task"));
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>(() => {
    if (urlTabParam === "collaboration-settings") return "project-manager";
    const parsed = readProjectDetailTab(urlTabParam);
    if (parsed) return parsed;
    return initialWorkItemParam ? "project-manager" : "overview";
  });
  const [selectedRuntimeAdapter, setSelectedRuntimeAdapter] = useState<RuntimeAdapterId | "">("");
  const [selectedConfigPath, setSelectedConfigPath] = useState("");
  const [configDraft, setConfigDraft] = useState("");
  const [configSavedFlash, setConfigSavedFlash] = useState(false);
  const [pendingConfigSwitch, setPendingConfigSwitch] = useState<
    | { kind: "file"; path: string }
    | { kind: "adapter"; adapter: RuntimeAdapterId }
    | null
  >(null);
  const [pendingConfigAction, setPendingConfigAction] = useState<"preview" | null>(null);
  const [extractDialogOpen, setExtractDialogOpen] = useState(false);
  const [editMetadataOpen, setEditMetadataOpen] = useState(false);
  const [overviewSidebarOpen, setOverviewSidebarOpen] = useState(true);
  const [copiedPath, setCopiedPath] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tabFade, setTabFade] = useState({ left: false, right: false });
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const configSyncRef = useRef<ConfigSyncPanelHandle>(null);

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id),
    enabled: !!id,
    staleTime: 30_000,
  });

  const { data: sessionsData } = useQuery({
    // Key includes actorId to match ProjectManagerPanel's sessions query, so
    // both surfaces share one cache entry instead of fetching twice.
    queryKey: ["sessions", { projectId: id }, taskAuthority.actorId],
    queryFn: () => listSessions({ projectId: id }),
    enabled: !!id,
    staleTime: 30_000,
  });
  const { data: taskPacketsData } = useQuery({
    queryKey: ["project-manager", id, "task-packets", { limit: 50 }],
    queryFn: () => listProjectManagerTaskPackets(id, { limit: 50 }),
    enabled: !!id && activeTab === "sessions",
    retry: false,
  });
  const { data: activitiesData } = useQuery({
    queryKey: ["activities", { projectId: id }],
    queryFn: () => listActivities({ projectId: id }),
    enabled: !!id && activeTab === "activity",
  });

  const { data: skillsData } = useQuery({
    queryKey: ["skills"],
    queryFn: listSkills,
    staleTime: 60_000,
  });

  const { data: projectSkillsData } = useQuery({
    queryKey: ["project-skills", id],
    queryFn: () => listProjectSkills(id),
    enabled: !!id,
    staleTime: 60_000,
  });

  const { data: adapterDiscoveryData, isLoading: adapterDiscoveryLoading } = useQuery({
    queryKey: ADAPTER_DISCOVERY_QUERY_KEY,
    queryFn: discoverAdapters,
    staleTime: 60_000,
  });

  const { data: dependenciesData, isLoading: dependenciesLoading } = useQuery({
    queryKey: ["dependencies"],
    queryFn: getDependencies,
    staleTime: 60_000,
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

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/projects");
    },
  });

  const { data: appliedProviderData } = useQuery({
    queryKey: ["model-providers-applied", selectedRuntimeAdapter],
    queryFn: () => getAppliedProviderForAdapter(selectedRuntimeAdapter as RuntimeAdapterId),
    enabled: Boolean(selectedRuntimeAdapter),
    retry: false,
    staleTime: 60_000,
  });

  const { data: templatesData } = useQuery({
    queryKey: ["templates"],
    queryFn: listTemplates,
    staleTime: 60_000,
    retry: false,
  });

  const createSessionMutation = useMutation({
    mutationFn: () => createSession({ projectId: id, aiTool: selectedRuntimeAdapter as RuntimeAdapterId }),
    onSuccess: ({ session }) => {
      queryClient.invalidateQueries({ queryKey: ["sessions", { projectId: id }] });
      router.push(`/sessions/${session.id}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("projects.failedCreateSession"));
    },
  });

  const createShellSessionMutation = useMutation({
    mutationFn: () => createSession({ projectId: id, aiTool: "terminal" }),
    onSuccess: ({ session }) => {
      queryClient.invalidateQueries({ queryKey: ["sessions", { projectId: id }] });
      router.push(`/sessions/${session.id}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("projects.failedCreateSession"));
    },
  });

  const projectSkillMutation = useMutation({
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      setProjectSkill(id, skillId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-skills", id] });
      toast.success(t("projects.skillOverrideSaved"));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("projects.failedSaveConfig"));
    },
  });

  const updateAiConfigMutation = useMutation({
    mutationFn: () =>
      updateProjectAiConfigFile(id, selectedConfigPath, configDraft, selectedRuntimeAdapter || undefined),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["project-ai-config", id, selectedRuntimeAdapter], snapshot);
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      setConfigSavedFlash(true);
      toast.success(t("projects.workspaceFileSaved"));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("projects.failedSaveConfig"));
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
    adapterDiscoveryLoading ||
    !selectedRuntimeAdapter ||
    !selectedRuntimeLaunchable;
  const configNeedsReview = ["failed", "needs_review"].includes(searchParams.get("configStatus") ?? "");
  const projectManagerWorkItemId = normalizeSearchParam(searchParams.get("workItemId"));
  const runningSessionCount = projectSessions.filter((session) => session.status === "running").length;
  const enabledSkillCount = enabledSkillIds.size;

  useEffect(() => {
    const rawTab = searchParams.get("tab");
    const nextTab = readProjectDetailTab(
      rawTab === "collaboration-settings" ? "project-manager" : rawTab,
    );
    if (nextTab) {
      setActiveTab((current) => (current === nextTab ? current : nextTab));
      return;
    }
    if (!rawTab) {
      const fallbackTab: ProjectDetailTab =
        searchParams.get("workItemId") || searchParams.get("task")
          ? "project-manager"
          : "overview";
      setActiveTab((current) => (current === fallbackTab ? current : fallbackTab));
    }
  }, [searchParams]);

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = readProjectDetailTab(value);
      if (!nextTab) return;
      setActiveTab(nextTab);
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      if (nextTab === "overview") {
        nextSearchParams.delete("tab");
      } else {
        nextSearchParams.set("tab", nextTab);
      }
      if (nextTab !== "project-manager") {
        nextSearchParams.delete("workItemId");
      }
      if (nextTab !== "files") {
        nextSearchParams.delete("file");
      }
      const query = nextSearchParams.toString();
      router.replace(
        query
          ? `/projects/${encodeURIComponent(id)}?${query}`
          : `/projects/${encodeURIComponent(id)}`,
        { scroll: false },
      );
    },
    [id, router, searchParams],
  );

  const selectedWorkspaceFile = normalizeSearchParam(searchParams.get("file"));

  const handleWorkspaceFileChange = useCallback(
    (filePath: string | null) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.set("tab", "files");
      if (filePath) {
        nextSearchParams.set("file", filePath);
      } else {
        nextSearchParams.delete("file");
      }
      const query = nextSearchParams.toString();
      router.replace(`/projects/${encodeURIComponent(id)}?${query}`, { scroll: false });
    },
    [id, router, searchParams],
  );

  const handleOpenFileInFiles = useCallback(
    (filePath: string) => {
      setActiveTab("files");
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.set("tab", "files");
      nextSearchParams.set("file", filePath);
      nextSearchParams.delete("workItemId");
      router.replace(
        `/projects/${encodeURIComponent(id)}?${nextSearchParams.toString()}`,
        { scroll: false },
      );
    },
    [id, router, searchParams],
  );

  useEffect(() => {
    if (!adapterDiscoveryData?.adapters) return;
    const nextAdapter = chooseDefaultRuntimeAdapter(
      adapterDiscoveryData.adapters,
      selectedRuntimeAdapter,
    );
    setSelectedRuntimeAdapter((current) =>
      current === (nextAdapter ?? "") ? current : (nextAdapter ?? ""),
    );
  }, [adapterDiscoveryData?.adapters, selectedRuntimeAdapter]);

  useEffect(() => {
    const files = projectAiConfig?.files ?? [];
    if (files.length === 0) return;
    const preferred =
      files.find((file) => file.exists && file.role === "instructions") ?? files[0];
    if (!selectedConfigPath || !files.some((file) => file.relativePath === selectedConfigPath)) {
      const nextPath = preferred?.relativePath ?? "";
      setSelectedConfigPath((current) => (current === nextPath ? current : nextPath));
    }
  }, [projectAiConfig?.files, selectedConfigPath]);

  useEffect(() => {
    const nextDraft = selectedConfigFile?.content ?? "";
    setConfigDraft((current) => (current === nextDraft ? current : nextDraft));
  }, [selectedConfigFile?.content, selectedConfigFile?.relativePath]);

  useEffect(() => {
    if (!configSavedFlash) return;
    const timer = window.setTimeout(() => setConfigSavedFlash(false), 2200);
    return () => window.clearTimeout(timer);
  }, [configSavedFlash]);

  const configDirty =
    Boolean(selectedConfigFile) && configDraft !== (selectedConfigFile?.content ?? "");

  const requestConfigPathChange = (nextPath: string) => {
    if (nextPath === selectedConfigPath) return;
    if (configDirty) {
      setPendingConfigSwitch({ kind: "file", path: nextPath });
      return;
    }
    setSelectedConfigPath(nextPath);
  };

  const requestConfigAdapterChange = (nextAdapter: string) => {
    const adapter = nextAdapter as RuntimeAdapterId;
    if (!adapter || adapter === selectedRuntimeAdapter) return;
    if (configDirty) {
      setPendingConfigSwitch({ kind: "adapter", adapter });
      return;
    }
    setSelectedRuntimeAdapter(adapter);
  };

  const boundTemplateName = useMemo(() => {
    if (!resolvedTemplateId) return null;
    return (
      templatesData?.templates.find((tpl) => tpl.id === resolvedTemplateId)?.name ??
      resolvedTemplateId
    );
  }, [resolvedTemplateId, templatesData?.templates]);

  const overrideSkillCount = useMemo(
    () =>
      projectSkills.filter(
        (skill) =>
          skill.selectionState === "project_enabled" || skill.selectionState === "project_disabled",
      ).length,
    [projectSkills],
  );

  const appliedProviderLabel = useMemo(() => {
    const info = appliedProviderData?.appliedProvider;
    if (!info) return null;
    return info.modelProfileId
      ? `${info.providerName} · ${info.modelProfileId}`
      : info.providerName;
  }, [appliedProviderData?.appliedProvider]);

  useEffect(() => {
    if (!id) return;
    const onGatewayEvent = (event: Event) => {
      const detail = (event as CustomEvent<GatewayEvent>).detail;
      if (!detail || typeof detail !== "object") return;
      const type = detail.type ?? "";
      const payload = (detail.payload ?? {}) as Record<string, unknown>;
      const eventProjectId =
        typeof payload.projectId === "string"
          ? payload.projectId
          : typeof payload.project_id === "string"
            ? payload.project_id
            : null;
      if (eventProjectId && eventProjectId !== id) return;
      if (type.startsWith("session")) {
        void queryClient.invalidateQueries({ queryKey: ["sessions", { projectId: id }] });
        void queryClient.invalidateQueries({ queryKey: ["project-git-changes", id] });
        void queryClient.invalidateQueries({ queryKey: ["activities", { projectId: id }] });
      } else if (type.includes("project_manager") || type.includes("work_item")) {
        void queryClient.invalidateQueries({ queryKey: ["project-manager", id] });
      } else if (type.includes("goal")) {
        void queryClient.invalidateQueries({ queryKey: ["copilot-goals"] });
        void queryClient.invalidateQueries({ queryKey: ["project-manager", id] });
      } else if (type.includes("fleet")) {
        void queryClient.invalidateQueries({ queryKey: ["fleets"] });
      }
    };
    window.addEventListener(FORGEBADGER_GATEWAY_EVENT, onGatewayEvent);
    return () => window.removeEventListener(FORGEBADGER_GATEWAY_EVENT, onGatewayEvent);
  }, [id, queryClient]);

  useEffect(() => {
    const updateFade = () => {
      const el = tabsScrollRef.current;
      if (!el) return;
      const left = el.scrollLeft > 4;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setTabFade((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    updateFade();
    const el = tabsScrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateFade, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(updateFade);
      observer.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", updateFade);
      observer?.disconnect();
    };
  }, [project?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (digit >= 1 && digit <= PROJECT_DETAIL_TABS.length) {
        const nextTab = PROJECT_DETAIL_TABS[digit - 1];
        if (nextTab) {
          handleTabChange(nextTab);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTabChange]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      {projectLoading ? (
        <Card className="forgebadger-animate-in">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("projects.loadingOne")}
          </CardContent>
        </Card>
      ) : !project ? (
        <Card className="forgebadger-animate-in">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("projects.notFound")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 forgebadger-animate-in">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 size-8 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("projects.back")}
              onClick={() => router.push("/projects")}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">{project.name}</h1>
              {project.status && <Badge variant="outline" className="shrink-0">{projectStatusLabel(projectCopy, project.status)}</Badge>}
              <span
                className="hidden min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground sm:inline"
                title={project.path ?? project.rootPath}
              >
                {project.path ?? project.rootPath}
              </span>
              {(project.path ?? project.rootPath) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden size-7 shrink-0 text-muted-foreground hover:text-foreground sm:inline-flex"
                  aria-label={t("projects.copyPath")}
                  title={t("projects.copyPath")}
                  onClick={async () => {
                    const targetPath = project.path ?? project.rootPath;
                    if (!targetPath) return;
                    try {
                      await navigator.clipboard.writeText(targetPath);
                      setCopiedPath(true);
                      toast.success(t("projects.pathCopied"));
                      window.setTimeout(() => setCopiedPath(false), 1800);
                    } catch {
                      // Clipboard unavailable.
                    }
                  }}
                >
                  {copiedPath ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AdapterSelect
                id="runtime-adapter"
                ariaLabel={t("projects.selectRuntimeCli")}
                value={selectedRuntimeAdapter || ""}
                onValueChange={setSelectedRuntimeAdapter}
                disabled={adapterDiscoveryLoading || runtimeAdapters.length === 0}
                size="sm"
                className="h-8 w-52"
                placeholder={
                  adapterDiscoveryLoading
                    ? t("projects.loadingRuntimeCli")
                    : t("projects.selectRuntimeCli")
                }
              />
              {appliedProviderLabel && (
                <Badge variant="secondary" className="hidden h-7 rounded-full px-2.5 text-[11px] font-normal lg:inline-flex">
                  {t("projects.appliedModelBadge").replace("{provider}", appliedProviderLabel)}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => createShellSessionMutation.mutate()}
                disabled={createShellSessionMutation.isPending}
              >
                <Terminal className="size-4" />
                {t("projects.startShell")}
              </Button>
              <Button
                size="sm"
                variant="brand"
                onClick={() => createSessionMutation.mutate()}
                disabled={cannotCreateSession || createSessionMutation.isPending}
              >
                <Plus className="size-4" />
                {createSessionMutation.isPending ? t("projects.creating") : t("projects.newSession")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    aria-label={t("projects.moreActions")}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditMetadataOpen(true)}>
                    <Pencil className="size-4" />
                    {t("projects.editMetadata")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={deleteMutation.isPending}
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="size-4" />
                    {deleteMutation.isPending ? t("projects.deleting") : t("projects.deleteRecord")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {launchableRuntimeAdapters.length === 0 && !adapterDiscoveryLoading && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 forgebadger-animate-in">
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
          )}

          {configNeedsReview && !isUntrackedTemplate && (
            <Card className="forgebadger-animate-in border-warning/40 bg-warning/10">
              <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning">
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
                  onClick={() => {
                    handleTabChange("config");
                    setPendingConfigAction("preview");
                  }}
                >
                  <FileCode2 className="size-4" />
                  {t("projects.reviewConfig")}
                </Button>
              </CardContent>
            </Card>
          )}

          {deleteMutation.isError && (
            <p className="text-sm text-destructive">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("projects.deleteFailed")}
            </p>
          )}

          <ConfirmDialog
            open={confirmDelete}
            destructive
            pending={deleteMutation.isPending}
            title={t("projects.deleteConfirmTitle")}
            description={t("projects.deleteConfirmNamed").replace("{name}", project.name)}
            confirmLabel={t("common.delete")}
            onOpenChange={setConfirmDelete}
            onConfirm={() => deleteMutation.mutate()}
          />

          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div
              ref={tabsScrollRef}
              className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              style={(() => {
                const mask = buildEdgeFadeMask(tabFade.left, tabFade.right);
                return mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined;
              })()}
            >
            <TabsList className="min-w-max">
              <TabsTrigger value="overview">
                {t("projects.tabOverview")}
              </TabsTrigger>
              <TabsTrigger value="sessions">
                {t("nav.sessions")}
                {projectSessions.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground tabular-nums">
                    {projectSessions.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="git">{t("projects.gitTab")}</TabsTrigger>
              <TabsTrigger value="files">{t("projects.filesTab")}</TabsTrigger>
              <TabsTrigger value="graph">{t("projects.graphTab")}</TabsTrigger>
              <TabsTrigger value="project-manager">{t("projects.devTasks")}</TabsTrigger>
              <TabsTrigger value="skills">
                {t("nav.skills")}
                {enabledSkillCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground tabular-nums">
                    {enabledSkillCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="config">{t("projects.aiConfig")}</TabsTrigger>
              <TabsTrigger value="activity">{t("sessions.activity")}</TabsTrigger>
            </TabsList>
            </div>

            <TabsContent value="overview" className="mt-4">
              <ProjectOverviewPanel
                project={project}
                sessions={projectSessions}
                actorId={taskAuthority.actorId}
                templateName={boundTemplateName}
                overrideSkillCount={overrideSkillCount}
                appliedProviderLabel={appliedProviderLabel}
                sidebarOpen={overviewSidebarOpen}
                onToggleSidebar={() => setOverviewSidebarOpen((prev) => !prev)}
                onSelectTab={(tab) => handleTabChange(tab)}
                onOpenFileInFiles={handleOpenFileInFiles}
                onEditMetadata={() => setEditMetadataOpen(true)}
                onStartSession={cannotCreateSession ? undefined : () => createSessionMutation.mutate()}
              />
            </TabsContent>

            <TabsContent value="sessions" className="mt-4">
              <p className="mb-3 text-xs text-muted-foreground">
                {t("projects.sessionsSummary")
                  .replace("{total}", String(projectSessions.length))
                  .replace("{running}", String(runningSessionCount))}
              </p>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                {projectSessions.length === 0 ? (
                  <Card className="forgebadger-animate-in">
                    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                      <IconTile size="lg" tone="brand">
                        <TerminalSquare strokeWidth={1.75} />
                      </IconTile>
                      <div className="text-sm font-medium">{t("projects.noSessions")}</div>
                      <Button
                        size="sm"
                        variant="brand"
                        onClick={() => createSessionMutation.mutate()}
                        disabled={cannotCreateSession || createSessionMutation.isPending}
                      >
                        <Plus className="size-4" />
                        {createSessionMutation.isPending ? t("projects.creating") : t("projects.newSession")}
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card shadow-card">
                    {projectSessions.map((session, index) => {
                      const linkedTaskPacket = findSessionTaskPacket(taskPacketsData?.taskPackets ?? [], session.id);
                      const relativeTime = now === null ? null : formatSessionRelativeTime(session, now, language);
                      return (
                      <Link
                        key={session.id}
                        href={`/sessions/${session.id}`}
                        className="group flex items-center gap-3 px-4 py-3 transition-colors forgebadger-animate-in hover:bg-muted/40"
                        style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                      >
                        <SessionStatusDot status={session.status} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {session.name || session.runtimeSessionName || session.id}
                          </div>
                          {/* The relative time tells same-named sessions apart. */}
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {relativeTime ?? t("sessions.noActivity")}
                          </div>
                        </div>
                        {linkedTaskPacket && <LinkedWorkItemChip packet={linkedTaskPacket} />}
                        <CliBrandChip aiTool={session.aiTool} />
                        <SessionStatusText status={session.status} />
                        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-brand" />
                      </Link>
                      );
                    })}
                  </div>
                )}
                <WorkspaceContextPanel projectId={id} enabled={activeTab === "sessions"} />
              </div>
            </TabsContent>

            <TabsContent value="git" className="mt-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <GitBranchesPanel projectId={id} enabled={activeTab === "git"} />
                <GitChangesPanel projectId={id} onOpenInFiles={handleOpenFileInFiles} />
              </div>
            </TabsContent>

            <TabsContent value="files" className="mt-4">
              <WorkspaceExplorer
                projectId={id}
                enabled={activeTab === "files"}
                selectedPath={selectedWorkspaceFile}
                onSelectPath={handleWorkspaceFileChange}
              />
            </TabsContent>

            <TabsContent value="graph" className="mt-4">
              <ProjectGraphPanel
                projectId={id}
                enabled={activeTab === "graph"}
                onOpenInFiles={handleOpenFileInFiles}
              />
            </TabsContent>

            <TabsContent value="project-manager" className="mt-4 space-y-4">
              <TeamHubLink projectId={id} enabled={activeTab === "project-manager"} />
              <ProjectManagerPanel
                projectId={id}
                authority={taskAuthority}
                enabled={activeTab === "project-manager"}
                selectedWorkItemId={projectManagerWorkItemId}
                embedded
                onNavigateToSession={(href) => router.push(href)}
              />
            </TabsContent>

            <TabsContent value="skills" className="mt-4">
              {skills.length === 0 ? (
                <Card className="forgebadger-animate-in">
                  <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                    <IconTile size="lg" tone="brand">
                      <Wrench strokeWidth={1.75} />
                    </IconTile>
                    <div className="text-sm font-medium">{t("skills.emptyTitle")}</div>
                  </CardContent>
                </Card>
              ) : (
                <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card shadow-card">
                  {skills.map((skill, index) => {
                    const projectSkill = projectSkillById.get(skill.id);
                    const isEnabled = enabledSkillIds.has(skill.id);
                    return (
                      <div
                        key={skill.id}
                        role="group"
                        aria-label={skill.name}
                        className="flex items-center gap-3 px-4 py-3 transition-colors forgebadger-animate-in hover:bg-muted/40"
                        style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
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
                              isEnabled ? "text-success" : "text-muted-foreground"
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

            <TabsContent value="config" className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("projects.configEditorCliLabel")}
                  </span>
                  <AdapterSelect
                    id="config-tab-adapter"
                    ariaLabel={t("projects.configEditorCliLabel")}
                    value={selectedRuntimeAdapter || ""}
                    onValueChange={requestConfigAdapterChange}
                    disabled={adapterDiscoveryLoading || runtimeAdapters.length === 0}
                    size="sm"
                    className="h-8 w-52"
                    placeholder={
                      adapterDiscoveryLoading
                        ? t("projects.loadingRuntimeCli")
                        : t("projects.selectRuntimeCli")
                    }
                  />
                  {appliedProviderLabel && (
                    <Badge variant="secondary" className="rounded-full text-[11px] font-normal">
                      {t("projects.appliedModelBadge").replace("{provider}", appliedProviderLabel)}
                    </Badge>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => setExtractDialogOpen(true)}>
                  <Package className="mr-2 size-4" />
                  {t("templates.extract")}
                </Button>
              </div>
              <ConfigSyncPanel
                ref={configSyncRef}
                projectId={id}
                templateId={resolvedTemplateId}
                credentialMode="host_environment"
                pendingAction={pendingConfigAction}
                onPendingActionConsumed={() => setPendingConfigAction(null)}
              />
              <ProjectConfigPanel
                projectConfig={projectAiConfig}
                globalConfig={globalAiConfig}
                selectedPath={selectedConfigPath}
                draft={configDraft}
                dirty={configDirty}
                savedFlash={configSavedFlash}
                projectLoading={projectAiConfigLoading}
                globalLoading={globalAiConfigLoading}
                isSaving={updateAiConfigMutation.isPending}
                error={updateAiConfigMutation.error}
                onSelectedPathChange={requestConfigPathChange}
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
      {project && (
        <ProjectEditMetadataDialog
          open={editMetadataOpen}
          onOpenChange={setEditMetadataOpen}
          project={project}
        />
      )}
      <ConfirmDialog
        open={pendingConfigSwitch !== null}
        destructive
        title={t("cliConfig.unsavedChangesTitle")}
        description={t("cliConfig.unsavedChangesDescription")}
        confirmLabel={t("common.confirm")}
        onOpenChange={(open) => {
          if (!open) setPendingConfigSwitch(null);
        }}
        onConfirm={() => {
          const target = pendingConfigSwitch;
          setPendingConfigSwitch(null);
          if (!target) return;
          if (target.kind === "file") {
            setSelectedConfigPath(target.path);
          } else {
            setSelectedRuntimeAdapter(target.adapter);
          }
        }}
      />
      <ExtractTemplateDialog
        projectId={id}
        open={extractDialogOpen}
        onOpenChange={setExtractDialogOpen}
        onExtracted={() => {
          queryClient.invalidateQueries({ queryKey: ["project", id] });
          queryClient.invalidateQueries({ queryKey: ["templates"] });
        }}
      />
    </div>
  );
}

function LinkedWorkItemChip({ packet }: { packet: ProjectManagerTaskPacket }) {
  const router = useRouter();
  const { t } = useLanguage();
  const href = sessionTaskPacketProjectManagerHref(packet);
  const open = (event: { preventDefault(): void; stopPropagation(): void }) => {
    event.preventDefault();
    event.stopPropagation();
    router.push(href);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t("projects.projectManagerLinkedSession")}
      title={packet.title}
      className="hidden max-w-44 items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-xs text-brand hover:underline sm:inline-flex"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
    >
      <Link2 className="size-3 shrink-0" />
      <span className="truncate">{packet.title}</span>
    </span>
  );
}

function SessionStatusDot({ status }: { status: string }) {
  const normalized = normalizeSessionStatus(status);
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        normalized === "running"
          ? "forgebadger-pulse-dot bg-success"
          : normalized === "error"
            ? "bg-destructive"
            : normalized === "lost"
              ? "bg-warning"
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
          ? "text-success"
          : normalized === "error"
            ? "text-destructive"
            : normalized === "lost"
              ? "text-warning"
              : "text-muted-foreground"
      )}
    >
      {normalized === "running"
        ? t("sessions.running")
        : normalized === "error"
          ? t("sessions.error")
          : normalized === "lost"
            ? t("sessions.lost")
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
  dirty,
  savedFlash,
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
  dirty: boolean;
  savedFlash: boolean;
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
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [selectedPath]);

  if (projectLoading) {
    return (
      <Card className="forgebadger-animate-in">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="forgebadger-animate-in">
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

      <Card className="forgebadger-animate-in" style={{ animationDelay: "50ms" }}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="min-w-0 truncate font-mono text-sm font-semibold">
              {selectedFile?.relativePath ?? t("projects.selectConfigFile")}
            </CardTitle>
            {savedFlash && !dirty && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="size-3" />
                {t("projects.workspaceFileSaved")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedFile && !editing && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
                disabled={!selectedFile}
              >
                <Pencil className="size-4" />
                {t("projects.editFile")}
              </Button>
            )}
            {selectedFile && editing && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(false)}
                  disabled={isSaving}
                >
                  <Eye className="size-4" />
                  {t("projects.previewFile")}
                </Button>
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  {t("projects.configEditorShortcutHint")}
                </span>
                <Button
                  size="sm"
                  variant="brand"
                  onClick={onSave}
                  disabled={!selectedFile || !dirty || isSaving}
                >
                  <Save className="size-4" />
                  {isSaving ? t("projects.savingConfig") : t("common.save")}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedFile && !editing ? (
            isMarkdown ? (
              <MarkdownRenderer
                content={draft}
                className="max-h-[560px] min-h-[200px] space-y-3 overflow-y-auto rounded-md border border-border/70 bg-background p-4 text-sm leading-relaxed text-foreground/90"
              />
            ) : (
              <SyntaxHighlightedEditor
                content={draft}
                fileType={selectedFile.fileType ?? "text"}
                relativePath={selectedFile.relativePath}
                disabled
                readOnly
                ariaLabel={selectedFile.relativePath}
              />
            )
          ) : (
            <SyntaxHighlightedEditor
              content={draft}
              fileType={selectedFile?.fileType ?? "text"}
              relativePath={selectedFile?.relativePath}
              disabled={!selectedFile || isSaving}
              ariaLabel={selectedFile?.relativePath ?? t("projects.selectConfigFile")}
              onChange={onDraftChange}
              onSave={() => {
                if (dirty && !isSaving) onSave();
              }}
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
        <Card className="forgebadger-animate-in" style={{ animationDelay: "100ms" }}>
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
  relativePath,
  disabled,
  ariaLabel,
  onChange,
  onSave,
  readOnly = false,
  minHeightClassName = "min-h-[560px]"
}: {
  content: string;
  fileType: string;
  relativePath?: string;
  disabled: boolean;
  ariaLabel: string;
  onChange?: (content: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  minHeightClassName?: string;
}) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => content.split("\n"), [content]);
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(lines.length, 1) }, (_, index) => index + 1),
    [lines.length]
  );
  const [tokenLines, setTokenLines] = useState<Awaited<ReturnType<typeof highlightWorkspaceCode>>>(null);

  useEffect(() => {
    if (!readOnly) {
      setTokenLines(null);
      return;
    }
    let cancelled = false;
    const hintName = relativePath || `config.${fileType === "markdown" ? "md" : fileType || "txt"}`;
    void highlightWorkspaceCode(content, hintName).then((result) => {
      if (!cancelled) {
        setTokenLines(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [content, fileType, readOnly, relativePath]);

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-muted/40 shadow-inner shadow-black/20">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {readOnly ? "Readonly preview" : "Editor"}
        </span>
        <Badge variant="outline" className="border-border bg-background text-[10px] text-muted-foreground">
          {fileType || "plain"}
        </Badge>
      </div>
      <div className={cn("grid grid-cols-[3.5rem_minmax(0,1fr)]", minHeightClassName)}>
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="overflow-hidden border-r border-border bg-muted/40 px-2 py-4 text-right font-mono text-[11px] leading-6 text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {lineNumbers.map((lineNumber) => (
            <div key={lineNumber}>{lineNumber}</div>
          ))}
        </div>
        <div className="min-w-0">
          {readOnly ? (
            <pre
              onScroll={(event) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              className="h-full max-h-[560px] overflow-auto whitespace-pre p-4 font-mono text-[13px] leading-6 text-foreground/95"
            >
              {tokenLines
                ? tokenLines.map((line, lineIdx) => (
                    <div key={lineIdx}>
                      {line.length === 0 ? "\u200B" : line.map((token, tokenIdx) => {
                        const styleFlags = tokenFontStyle(token.fontStyle);
                        return (
                          <span
                            key={tokenIdx}
                            style={token.color ? { color: token.color } : undefined}
                            className={cn(
                              styleFlags.italic && "italic",
                              styleFlags.bold && "font-semibold",
                              styleFlags.underline && "underline",
                            )}
                          >
                            {token.content}
                          </span>
                        );
                      })}
                    </div>
                  ))
                : content}
            </pre>
          ) : (
            <textarea
              className="h-full min-h-[520px] w-full resize-none overflow-auto border-0 bg-background/60 p-4 font-mono text-[13px] leading-6 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
              value={content}
              onChange={(event) => onChange?.(event.target.value)}
              onScroll={(event) => {
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  onSave?.();
                }
              }}
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
            relativePath={file.relativePath}
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
  const locale = useUiLocale();
  const activityCopy = useProjectCopy();

  return (
    <Card className="forgebadger-animate-in overflow-hidden">
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
                  activity.status === "error" ? "bg-destructive" : "bg-success"
                )}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={activity.status === "error" ? "destructive" : "outline"}
                    className="w-fit"
                  >
                    {activityTypeLabel(activityCopy, activity.type)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatProjectActivityTime(activity.createdAt, locale)}
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

function formatProjectActivityTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(locale);
}
