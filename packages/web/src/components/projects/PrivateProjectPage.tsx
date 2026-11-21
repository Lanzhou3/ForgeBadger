"use client";

import type { TaskAuthority } from "./project-manager/TaskAuthority";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  FileCode2,
  FolderTree,
  GitBranch,
  MoreHorizontal,
  Network,
  Package,
  Pencil,
  Plus,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { ConfigSyncPanel, type ConfigSyncPanelHandle } from "@/components/projects/ConfigSyncPanel";
import { ExtractTemplateDialog } from "@/components/projects/ExtractTemplateDialog";
import { ProjectConfigPanel } from "@/components/projects/ProjectConfigPanel";
import { ProjectEditMetadataDialog } from "@/components/projects/ProjectEditMetadataDialog";
import {
  ProjectOverviewPanel,
  type ProjectOverviewTarget,
} from "@/components/projects/ProjectOverviewPanel";
import { RuntimeSetupCommands } from "@/components/runtime-setup-commands";
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
  getProjectGitChanges,
  discoverAdapters,
  listSessions,
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
} from "@/lib/api";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import type { GatewayEvent } from "@/lib/notifications";
import { projectStatusLabel, useProjectCopy } from "@/components/projects/project-copy";
import { useLanguage } from "@/hooks/use-language";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { TeamHubLink } from "@/components/hub/TeamHubLink";

const ProjectGraphPanel = dynamic(
  () =>
    import("@/components/projects/graph/ProjectGraphPanel").then((mod) => mod.ProjectGraphPanel),
  { ssr: false },
);
const ProjectManagerPanel = dynamic(
  () => import("@/components/projects/ProjectManagerPanel").then((mod) => mod.ProjectManagerPanel),
  { ssr: false },
);

const PROJECT_DETAIL_TABS = ["overview", "project-manager", "code", "config"] as const;
type ProjectDetailTab = (typeof PROJECT_DETAIL_TABS)[number];
type CodeSubView = "files" | "git" | "graph";
type ConfigSubView = "rules" | "skills";

interface ResolvedProjectRoute {
  tab: ProjectDetailTab;
  codeView: CodeSubView;
  configView: ConfigSubView;
}

function resolveProjectRoute(searchParams: URLSearchParams): ResolvedProjectRoute {
  const rawTab = normalizeSearchParam(searchParams.get("tab"));
  const rawView = normalizeSearchParam(searchParams.get("view"));
  const hasWorkItem = Boolean(
    normalizeSearchParam(searchParams.get("workItemId") ?? searchParams.get("task")),
  );

  if (rawTab === "project-manager" || rawTab === "collaboration-settings") {
    return { tab: "project-manager", codeView: "files", configView: "rules" };
  }
  if (rawTab === "files") {
    return { tab: "code", codeView: "files", configView: "rules" };
  }
  if (rawTab === "git") {
    return { tab: "code", codeView: "git", configView: "rules" };
  }
  if (rawTab === "graph") {
    return { tab: "code", codeView: "graph", configView: "rules" };
  }
  if (rawTab === "code") {
    const codeView: CodeSubView =
      rawView === "git" || rawView === "graph" ? rawView : "files";
    return { tab: "code", codeView, configView: "rules" };
  }
  if (rawTab === "skills") {
    return { tab: "config", codeView: "files", configView: "skills" };
  }
  if (rawTab === "config") {
    const configView: ConfigSubView = rawView === "skills" ? "skills" : "rules";
    return { tab: "config", codeView: "files", configView };
  }
  if (!rawTab && hasWorkItem) {
    return { tab: "project-manager", codeView: "files", configView: "rules" };
  }
  // Legacy "sessions" / "activity" / "overview" / missing tab all land on Overview.
  return { tab: "overview", codeView: "files", configView: "rules" };
}

export default function ProjectDetailPage({
  taskAuthority,
}: {
  taskAuthority: TaskAuthority;
}) {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const projectCopy = useProjectCopy();

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const id = params.id as string;
  const initialRoute = resolveProjectRoute(new URLSearchParams(searchParams.toString()));
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>(initialRoute.tab);
  const [codeView, setCodeView] = useState<CodeSubView>(initialRoute.codeView);
  const [configView, setConfigView] = useState<ConfigSubView>(initialRoute.configView);

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
  const [copiedPath, setCopiedPath] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const configSyncRef = useRef<ConfigSyncPanelHandle>(null);

  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id),
    enabled: !!id,
    staleTime: 30_000,
  });

  const { data: sessionsData } = useQuery({
    queryKey: ["sessions", { projectId: id }, taskAuthority.actorId],
    queryFn: () => listSessions({ projectId: id }),
    enabled: !!id,
    staleTime: 30_000,
  });

  const { data: taskPacketsData } = useQuery({
    queryKey: ["project-manager", id, "task-packets", { limit: 50 }, taskAuthority.actorId],
    queryFn: () => listProjectManagerTaskPackets(id, { limit: 50 }),
    enabled: !!id && taskAuthority.legacySessions && activeTab === "overview",
    retry: false,
  });

  const { data: gitChangesData } = useQuery({
    queryKey: ["project-git-changes", id],
    queryFn: () => getProjectGitChanges(id),
    enabled: !!id,
    retry: false,
    staleTime: 15_000,
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
    enabled: !!id && !!selectedRuntimeAdapter && activeTab === "config",
  });

  const { data: globalAiConfigData, isLoading: globalAiConfigLoading } = useQuery({
    queryKey: ["project-ai-config-global", id, selectedRuntimeAdapter],
    queryFn: () => getGlobalAiConfig(id, selectedRuntimeAdapter || undefined),
    enabled: !!id && !!selectedRuntimeAdapter && activeTab === "config",
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

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/projects");
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: () =>
      createSession({ projectId: id, aiTool: selectedRuntimeAdapter as RuntimeAdapterId }),
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
      updateProjectAiConfigFile(
        id,
        selectedConfigPath,
        configDraft,
        selectedRuntimeAdapter || undefined,
      ),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["project-ai-config", id, selectedRuntimeAdapter], snapshot);
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
    [sessionsData?.sessions],
  );
  const skills = skillsData?.skills ?? [];
  const projectSkills = projectSkillsData?.skills ?? [];
  const projectSkillById = useMemo(
    () => new Map(projectSkills.map((skill) => [skill.skillId, skill])),
    [projectSkills],
  );
  const enabledSkillIds = useMemo(
    () => new Set(projectSkills.filter((skill) => skill.isEnabled).map((skill) => skill.skillId)),
    [projectSkills],
  );
  const resolvedTemplateId = project?.templateId ?? null;
  const isUntrackedTemplate = !!project && project.templateId === null;
  const runtimeAdapters = adapterDiscoveryData?.adapters ?? [];
  const terminalRuntime = dependenciesData?.terminalRuntime;
  const terminalSetupGuidance = getTerminalRuntimeSetupGuidance(
    terminalRuntime?.mode,
    terminalRuntime?.supported,
  );
  const launchableRuntimeAdapters = useMemo(
    () => runtimeAdapters.filter(isAdapterLaunchable),
    [runtimeAdapters],
  );
  const selectedRuntimeOption = runtimeAdapters.find(
    (adapter) => adapter.id === selectedRuntimeAdapter,
  );
  const selectedRuntimeLaunchable = selectedRuntimeOption
    ? isAdapterLaunchable(selectedRuntimeOption)
    : false;
  const selectedConfigFile = projectAiConfigData?.files.find(
    (file) => file.relativePath === selectedConfigPath,
  );
  const cannotCreateSession =
    adapterDiscoveryLoading || !selectedRuntimeAdapter || !selectedRuntimeLaunchable;
  const configNeedsReview = ["failed", "needs_review"].includes(
    searchParams.get("configStatus") ?? "",
  );
  const projectManagerWorkItemId = normalizeSearchParam(
    searchParams.get("workItemId") ?? searchParams.get("task"),
  );
  const selectedWorkspaceFile = normalizeSearchParam(searchParams.get("file"));
  const gitChangedCount = gitChangesData?.isGitRepo ? gitChangesData.changed.length : 0;
  const enabledSkillCount = enabledSkillIds.size;

  // Sync local tab/sub-view state whenever URL query params change (Cmd+K, Back/Forward, deep links).
  useEffect(() => {
    const resolved = resolveProjectRoute(new URLSearchParams(searchParams.toString()));
    setActiveTab((current) => (current === resolved.tab ? current : resolved.tab));
    if (resolved.tab === "code") {
      setCodeView((current) => (current === resolved.codeView ? current : resolved.codeView));
    }
    if (resolved.tab === "config") {
      setConfigView((current) =>
        current === resolved.configView ? current : resolved.configView,
      );
    }
  }, [searchParams]);

  const replaceUrl = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      const query = next.toString();
      router.replace(
        query
          ? `/projects/${encodeURIComponent(id)}?${query}`
          : `/projects/${encodeURIComponent(id)}`,
        { scroll: false },
      );
    },
    [id, router, searchParams],
  );

  const handleTabChange = useCallback(
    (value: string) => {
      if (!PROJECT_DETAIL_TABS.includes(value as ProjectDetailTab)) return;
      const nextTab = value as ProjectDetailTab;
      setActiveTab(nextTab);
      replaceUrl((next) => {
        next.delete("view");
        if (nextTab === "overview") {
          next.delete("tab");
        } else {
          next.set("tab", nextTab);
        }
        if (nextTab !== "project-manager") {
          next.delete("workItemId");
          next.delete("task");
        }
        if (nextTab !== "code") {
          next.delete("file");
        } else if (codeView !== "files") {
          next.set("view", codeView);
        }
        if (nextTab === "config" && configView !== "rules") {
          next.set("view", configView);
        }
      });
    },
    [codeView, configView, replaceUrl],
  );

  const handleCodeViewChange = useCallback(
    (nextView: CodeSubView) => {
      setActiveTab("code");
      setCodeView(nextView);
      replaceUrl((next) => {
        next.set("tab", "code");
        if (nextView === "files") {
          next.delete("view");
        } else {
          next.set("view", nextView);
          next.delete("file");
        }
        next.delete("workItemId");
        next.delete("task");
      });
    },
    [replaceUrl],
  );

  const handleConfigViewChange = useCallback(
    (nextView: ConfigSubView) => {
      setActiveTab("config");
      setConfigView(nextView);
      replaceUrl((next) => {
        next.set("tab", "config");
        if (nextView === "rules") {
          next.delete("view");
        } else {
          next.set("view", nextView);
        }
        next.delete("file");
        next.delete("workItemId");
        next.delete("task");
      });
    },
    [replaceUrl],
  );

  const handleWorkspaceFileChange = useCallback(
    (filePath: string | null) => {
      setActiveTab("code");
      setCodeView("files");
      replaceUrl((next) => {
        next.set("tab", "code");
        next.delete("view");
        if (filePath) next.set("file", filePath);
        else next.delete("file");
        next.delete("workItemId");
        next.delete("task");
      });
    },
    [replaceUrl],
  );

  const handleOpenFileInFiles = useCallback(
    (filePath: string) => {
      handleWorkspaceFileChange(filePath);
    },
    [handleWorkspaceFileChange],
  );

  const handleOverviewNavigate = useCallback(
    (target: ProjectOverviewTarget) => {
      if (target.tab === "project-manager") {
        setActiveTab("project-manager");
        replaceUrl((next) => {
          next.set("tab", "project-manager");
          next.delete("view");
          next.delete("file");
          if (target.workItemId) next.set("workItemId", target.workItemId);
          else next.delete("workItemId");
        });
        return;
      }
      if (target.tab === "code") {
        setActiveTab("code");
        setCodeView(target.view);
        replaceUrl((next) => {
          next.set("tab", "code");
          next.delete("workItemId");
          next.delete("task");
          if (target.view === "files") {
            next.delete("view");
            if (target.file) next.set("file", target.file);
            else next.delete("file");
          } else {
            next.set("view", target.view);
            next.delete("file");
          }
        });
        return;
      }
      handleConfigViewChange(target.view ?? "rules");
    },
    [handleConfigViewChange, replaceUrl],
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
    const files = projectAiConfigData?.files ?? [];
    if (files.length === 0) return;
    const preferred =
      files.find((file) => file.exists && file.role === "instructions") ?? files[0];
    if (!selectedConfigPath || !files.some((file) => file.relativePath === selectedConfigPath)) {
      const nextPath = preferred?.relativePath ?? "";
      setSelectedConfigPath((current) => (current === nextPath ? current : nextPath));
    }
  }, [projectAiConfigData?.files, selectedConfigPath]);

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
          skill.selectionState === "project_enabled" ||
          skill.selectionState === "project_disabled",
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

  // 1-4 keyboard shortcuts switch the 4 primary tabs when no input or modal is open.
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
        if (nextTab) handleTabChange(nextTab);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTabChange]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      {projectLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("projects.loadingOne")}
          </CardContent>
        </Card>
      ) : !project ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("projects.notFound")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
              {project.status && (
                <Badge variant="outline" className="shrink-0">
                  {projectStatusLabel(projectCopy, project.status)}
                </Badge>
              )}
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
                  {copiedPath ? (
                    <Check className="size-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
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
                <Badge
                  variant="secondary"
                  className="hidden h-7 rounded-full px-2.5 text-[11px] font-normal lg:inline-flex"
                >
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
                {createSessionMutation.isPending
                  ? t("projects.creating")
                  : t("projects.newSession")}
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
                    {deleteMutation.isPending
                      ? t("projects.deleting")
                      : t("projects.deleteRecord")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {launchableRuntimeAdapters.length === 0 && !adapterDiscoveryLoading && (
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
          )}

          {configNeedsReview && !isUntrackedTemplate && (
            <Card className="border-warning/40 bg-warning/10">
              <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning">
                    <AlertTriangle className="size-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">
                      {t("projects.configNeedsReviewTitle")}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("projects.configNeedsReviewDescription")}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    handleConfigViewChange("rules");
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

          {/* 4 Focused Top-Level Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="overview">{t("projects.tabOverview")}</TabsTrigger>
              <TabsTrigger value="project-manager">{t("projects.devTasks")}</TabsTrigger>
              <TabsTrigger value="code">
                {t("projects.tabCode")}
                {gitChangedCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] leading-none text-amber-600 tabular-nums dark:text-amber-400">
                    {gitChangedCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="config">{t("projects.aiConfig")}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <ProjectOverviewPanel
                project={project}
                sessions={projectSessions}
                taskPackets={taskPacketsData?.taskPackets ?? []}
                now={now}
                actorId={taskAuthority.actorId}
                canManageGoal={taskAuthority.canManage === true}
                templateName={boundTemplateName}
                overrideSkillCount={overrideSkillCount}
                appliedProviderLabel={appliedProviderLabel}
                onNavigate={handleOverviewNavigate}
                onEditMetadata={() => setEditMetadataOpen(true)}
                onStartSession={
                  cannotCreateSession ? undefined : () => createSessionMutation.mutate()
                }
                onStartShell={() => createShellSessionMutation.mutate()}
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
                onOpenFile={handleOpenFileInFiles}
              />
            </TabsContent>

            <TabsContent value="code" className="mt-4 space-y-4">
              <div
                role="tablist"
                aria-label={t("projects.tabCode")}
                className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border/70 bg-muted/25 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={codeView === "files"}
                  onClick={() => handleCodeViewChange("files")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                    codeView === "files"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <FolderTree className="size-3.5" />
                  {t("projects.filesTab")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={codeView === "git"}
                  onClick={() => handleCodeViewChange("git")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                    codeView === "git"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <GitBranch className="size-3.5" />
                  {t("projects.gitTab")}
                  {gitChangedCount > 0 && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] leading-none text-amber-600 tabular-nums dark:text-amber-400">
                      {gitChangedCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={codeView === "graph"}
                  onClick={() => handleCodeViewChange("graph")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                    codeView === "graph"
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Network className="size-3.5" />
                  {t("projects.graphTab")}
                </button>
              </div>

              {codeView === "files" && (
                <WorkspaceExplorer
                  projectId={id}
                  enabled={activeTab === "code" && codeView === "files"}
                  selectedPath={selectedWorkspaceFile}
                  onSelectPath={handleWorkspaceFileChange}
                />
              )}

              {codeView === "git" && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <GitBranchesPanel
                    projectId={id}
                    enabled={activeTab === "code" && codeView === "git"}
                  />
                  <GitChangesPanel projectId={id} onOpenInFiles={handleOpenFileInFiles} />
                </div>
              )}

              {codeView === "graph" && (
                <ProjectGraphPanel
                  projectId={id}
                  enabled={activeTab === "code" && codeView === "graph"}
                  onOpenInFiles={handleOpenFileInFiles}
                />
              )}
            </TabsContent>

            <TabsContent value="config" className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  role="tablist"
                  aria-label={t("projects.aiConfig")}
                  className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/25 p-1"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={configView === "rules"}
                    onClick={() => handleConfigViewChange("rules")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                      configView === "rules"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <FileCode2 className="size-3.5" />
                    {t("projects.configTabRules")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={configView === "skills"}
                    onClick={() => handleConfigViewChange("skills")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                      configView === "skills"
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Wrench className="size-3.5" />
                    {t("projects.configTabSkills")}
                    {enabledSkillCount > 0 && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground tabular-nums">
                        {enabledSkillCount}
                      </span>
                    )}
                  </button>
                </div>

                {configView === "rules" && (
                  <div className="flex flex-wrap items-center gap-2">
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
                    <Button variant="outline" size="sm" onClick={() => setExtractDialogOpen(true)}>
                      <Package className="mr-2 size-4" />
                      {t("templates.extract")}
                    </Button>
                  </div>
                )}
              </div>

              {configView === "rules" ? (
                <div className="space-y-4">
                  <ConfigSyncPanel
                    ref={configSyncRef}
                    projectId={id}
                    templateId={resolvedTemplateId}
                    credentialMode="host_environment"
                    pendingAction={pendingConfigAction}
                    onPendingActionConsumed={() => setPendingConfigAction(null)}
                  />
                  <ProjectConfigPanel
                    projectConfig={projectAiConfigData}
                    globalConfig={globalAiConfigData}
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
                </div>
              ) : skills.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                    <IconTile size="lg" tone="brand">
                      <Wrench strokeWidth={1.75} />
                    </IconTile>
                    <div className="text-sm font-medium">{t("skills.emptyTitle")}</div>
                  </CardContent>
                </Card>
              ) : (
                <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card shadow-card">
                  {skills.map((skill) => {
                    const projectSkill = projectSkillById.get(skill.id);
                    const isEnabled = enabledSkillIds.has(skill.id);
                    return (
                      <div
                        key={skill.id}
                        role="group"
                        aria-label={skill.name}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{skill.name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {projectSkillStateLabel(projectSkill?.selectionState, t)}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {skill.source}
                        </Badge>
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
                              isEnabled ? "text-success" : "text-muted-foreground",
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

function projectSkillStateLabel(
  state: string | undefined,
  t: (
    key:
      | "projects.skillProjectEnabled"
      | "projects.skillProjectDisabled"
      | "projects.skillInheritedDisabled"
      | "projects.skillInheritedEnabled",
  ) => string,
): string {
  if (state === "project_enabled") return t("projects.skillProjectEnabled");
  if (state === "project_disabled") return t("projects.skillProjectDisabled");
  if (state === "inherited_disabled") return t("projects.skillInheritedDisabled");
  return t("projects.skillInheritedEnabled");
}

function normalizeSearchParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
