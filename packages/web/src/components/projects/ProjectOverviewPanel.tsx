"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  FileCode2,
  FolderGit2,
  GitBranch,
  Layers,
  ListChecks,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  Sparkles,
  Target,
  Terminal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/projects/markdown-renderer";
import { WorkspaceContextPanel } from "@/components/projects/WorkspaceContextPanel";
import { WORK_ITEM_LIMIT } from "@/components/projects/project-manager/types";
import { useLanguage } from "@/hooks/use-language";
import {
  getProjectGitChanges,
  getProjectGraphOverview,
  getProjectManagerGoal,
  getProjectWorkspaceFile,
  getProjectWorkspaceTree,
  listProjectManagerWorkItems,
  type Project,
  type Session,
} from "@/lib/api";
import { listGoals } from "@/lib/copilot-api";
import { listFleets } from "@/lib/fleet-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type ProjectOverviewTabTarget =
  | "overview"
  | "sessions"
  | "git"
  | "files"
  | "graph"
  | "project-manager"
  | "skills"
  | "config"
  | "activity";

interface ProjectOverviewPanelProps {
  project: Project;
  sessions: Session[];
  actorId?: string | null;
  templateName?: string | null;
  overrideSkillCount?: number;
  appliedProviderLabel?: string | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSelectTab: (tab: ProjectOverviewTabTarget) => void;
  onOpenFileInFiles: (filePath: string) => void;
  onEditMetadata: () => void;
  onStartSession?: () => void;
  onAskCopilot?: () => void;
}

const RULE_FILE_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "GEMINI.md",
  ".cursorrules",
];

function isSessionLive(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "running" || normalized === "active" || normalized === "busy" || normalized === "idle";
}

/**
 * Vibe Coding Command Center overview for a project: unifies active goal &
 * context, running AI CLI sessions, Copilot Goals & Fleets, task progress,
 * AI rules preview, and a collapsible workspace snapshot sidebar.
 */
export function ProjectOverviewPanel({
  project,
  sessions,
  actorId = null,
  templateName = null,
  overrideSkillCount = 0,
  appliedProviderLabel = null,
  sidebarOpen,
  onToggleSidebar,
  onSelectTab,
  onOpenFileInFiles,
  onEditMetadata,
  onStartSession,
  onAskCopilot,
}: ProjectOverviewPanelProps) {
  const { t } = useLanguage();
  const [copiedPath, setCopiedPath] = useState(false);
  const [selectedRuleFile, setSelectedRuleFile] = useState<string | null>(null);

  const goalQuery = useQuery({
    queryKey: ["project-manager", project.id, "goal", actorId],
    queryFn: () => getProjectManagerGoal(project.id),
    retry: false,
  });

  const workItemsQuery = useQuery({
    queryKey: ["project-manager", project.id, "work-items", { limit: WORK_ITEM_LIMIT }, actorId],
    queryFn: () => listProjectManagerWorkItems(project.id, { limit: WORK_ITEM_LIMIT }),
    retry: false,
  });

  const gitChangesQuery = useQuery({
    queryKey: ["project-git-changes", project.id],
    queryFn: () => getProjectGitChanges(project.id),
    retry: false,
  });

  const graphOverviewQuery = useQuery({
    queryKey: ["project-graph", "overview", project.id],
    queryFn: () => getProjectGraphOverview(project.id),
    retry: false,
  });

  const copilotGoalsQuery = useQuery({
    queryKey: ["copilot-goals"],
    queryFn: () => listGoals(),
    retry: false,
  });

  const fleetsQuery = useQuery({
    queryKey: ["fleets"],
    queryFn: () => listFleets(),
    retry: false,
  });

  const workspaceRootQuery = useQuery({
    queryKey: ["project-workspace-root", project.id],
    queryFn: () => getProjectWorkspaceTree(project.id, { depth: 1, limit: 100 }),
    retry: false,
  });

  const detectedRuleFiles = useMemo(() => {
    const entries = workspaceRootQuery.data?.entries ?? [];
    const byLower = new Map<string, string>();
    for (const entry of entries) {
      if (entry.kind === "file") {
        byLower.set(entry.name.toLowerCase(), entry.path);
      }
    }
    const found: string[] = [];
    for (const candidate of RULE_FILE_CANDIDATES) {
      const match = byLower.get(candidate.toLowerCase());
      if (match) found.push(match);
    }
    return found;
  }, [workspaceRootQuery.data?.entries]);

  const activeRulePath = useMemo(() => {
    if (selectedRuleFile && detectedRuleFiles.includes(selectedRuleFile)) {
      return selectedRuleFile;
    }
    return detectedRuleFiles[0] ?? null;
  }, [detectedRuleFiles, selectedRuleFile]);

  const ruleFileQuery = useQuery({
    queryKey: ["project-workspace-file", project.id, activeRulePath],
    queryFn: () => getProjectWorkspaceFile(project.id, activeRulePath!),
    enabled: Boolean(activeRulePath),
    retry: false,
  });

  const orderedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aLive = isSessionLive(a.status) ? 0 : 1;
      const bLive = isSessionLive(b.status) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      const aTs = a.lastActive ? Date.parse(a.lastActive) : 0;
      const bTs = b.lastActive ? Date.parse(b.lastActive) : 0;
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });
  }, [sessions]);

  const projectGoals = useMemo(
    () => (copilotGoalsQuery.data?.goals ?? []).filter((g) => g.projectId === project.id),
    [copilotGoalsQuery.data?.goals, project.id],
  );

  const projectFleets = useMemo(
    () => (fleetsQuery.data?.fleets ?? []).filter((f) => f.projectId === project.id),
    [fleetsQuery.data?.fleets, project.id],
  );

  const workItemCounts = useMemo(() => {
    const items = workItemsQuery.data?.workItems ?? [];
    const counts = {
      total: items.length,
      todo: 0,
      in_progress: 0,
      ready_for_review: 0,
      blocked: 0,
      done: 0,
    };
    for (const item of items) {
      if (item.status === "todo") counts.todo += 1;
      else if (item.status === "in_progress") counts.in_progress += 1;
      else if (item.status === "ready_for_review") counts.ready_for_review += 1;
      else if (item.status === "blocked") counts.blocked += 1;
      else if (item.status === "done") counts.done += 1;
    }
    return counts;
  }, [workItemsQuery.data?.workItems]);

  const goal = goalQuery.data?.goal ?? null;
  const gitData = gitChangesQuery.data;
  const graphAvailable = graphOverviewQuery.data?.available === true;
  const displayPath = project.rootPath ?? project.path;

  function handleAskCopilot() {
    if (onAskCopilot) {
      onAskCopilot();
      return;
    }
    window.dispatchEvent(
      new CustomEvent("forgebadger:open-copilot", {
        detail: { projectId: project.id },
      }),
    );
  }

  async function handleCopyPath() {
    try {
      await navigator.clipboard.writeText(displayPath);
      setCopiedPath(true);
      toast.success(t("projects.pathCopied"));
      setTimeout(() => setCopiedPath(false), 1800);
    } catch {
      // Clipboard API may be unavailable in restricted contexts.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleSidebar}
          className="text-xs text-muted-foreground"
        >
          {sidebarOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
          {t("projects.toggleSidebar")}
        </Button>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          {/* 1. Current Goal & Project Context */}
          <section className="rounded-lg border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">
                  {t("projects.overviewGoalTitle")}
                </h2>
                {goal?.status && (
                  <Badge variant="outline" className="rounded-full text-[11px]">
                    {goal.status}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onEditMetadata}
                >
                  <Pencil className="size-3.5" />
                  {t("projects.editMetadata")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAskCopilot}
                >
                  <Sparkles className="size-3.5" />
                  {t("projects.overviewAskCopilot")}
                </Button>
              </div>
            </div>

            {goal?.summary ? (
              <div className="space-y-2">
                <p className="text-sm leading-relaxed">{goal.summary}</p>
                {project.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {project.description}
                  </p>
                )}
                {(goal.constraints.length > 0 || goal.acceptanceCriteria.length > 0) && (
                  <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                    {goal.constraints.length > 0 && (
                      <Badge variant="secondary" className="rounded-full font-normal">
                        {t("projects.projectManagerConstraints")}: {goal.constraints.length}
                      </Badge>
                    )}
                    {goal.acceptanceCriteria.length > 0 && (
                      <Badge variant="secondary" className="rounded-full font-normal">
                        {t("projects.projectManagerAcceptanceCriteria")}: {goal.acceptanceCriteria.length}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ) : project.description ? (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {project.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("projects.overviewNoGoal")}
              </p>
            )}
          </section>

          {/* 2. Live AI CLI Sessions */}
          <section className="rounded-lg border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">
                  {t("projects.overviewActiveSessions")}
                </h2>
                <Badge variant="secondary" className="rounded-full text-[11px] tabular-nums">
                  {sessions.length}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                {onStartSession && (
                  <Button type="button" size="sm" variant="outline" onClick={onStartSession}>
                    <Play className="size-3.5" />
                    {t("projects.newSession")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectTab("sessions")}
                >
                  {t("nav.sessions")}
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>

            {orderedSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("projects.overviewNoSessions")}
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {orderedSessions.slice(0, 5).map((session) => {
                  const live = isSessionLive(session.status);
                  return (
                    <div
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              live ? "bg-emerald-500" : "bg-muted-foreground/40",
                            )}
                          />
                          <span className="truncate text-sm font-medium">
                            {session.name || session.id}
                          </span>
                          {session.aiTool && (
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              {session.aiTool}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="rounded-full text-[10px]">
                            {session.status}
                          </Badge>
                        </div>
                        {session.lastPrompt && (
                          <p className="truncate pl-4 text-xs text-muted-foreground">
                            {session.lastPrompt}
                          </p>
                        )}
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/sessions/${session.id}`}>
                          {t("projects.projectManagerOpenSession")}
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 3. Copilot Goals & Fleet */}
          <section className="rounded-lg border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">
                  {t("projects.overviewGoalsAndFleet")}
                </h2>
              </div>
            </div>

            {projectGoals.length === 0 && projectFleets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("projects.overviewNoGoalsOrFleet")}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {projectFleets.map((fleet) => (
                  <Link
                    key={fleet.id}
                    href={`/fleet/${fleet.id}`}
                    className="group rounded-md border p-3 transition-colors hover:border-primary/40 hover:bg-muted/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="rounded-full text-[10px]">
                        {t("projects.activeFleetBadge")
                          .replace("{running}", String(fleet.taskRunning))
                          .replace("{total}", String(fleet.taskTotal))}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {fleet.status}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium group-hover:underline">
                      {fleet.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {fleet.taskDone}/{fleet.taskTotal}
                    </p>
                  </Link>
                ))}
                {projectGoals.map((cGoal) => (
                  <Link
                    key={cGoal.id}
                    href={`/copilot/goals/${cGoal.id}`}
                    className="group rounded-md border p-3 transition-colors hover:border-primary/40 hover:bg-muted/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="rounded-full text-[10px]">
                        {t("projects.activeGoalBadge")
                          .replace("{passes}", String(cGoal.taskPasses))
                          .replace("{total}", String(cGoal.taskTotal))}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {cGoal.status}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium group-hover:underline">
                      {cGoal.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {cGoal.taskPasses}/{cGoal.taskTotal}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* 4. Task Pipeline Progress */}
          <section className="rounded-lg border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ListChecks className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">
                  {t("projects.overviewWorkProgress")}
                </h2>
                <Badge variant="secondary" className="rounded-full text-[11px] tabular-nums">
                  {workItemCounts.done}/{workItemCounts.total}
                </Badge>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSelectTab("project-manager")}
              >
                {t("projects.overviewOpenBoard")}
                <ArrowRight className="size-3.5" />
              </Button>
            </div>

            {workItemCounts.total > 0 ? (
              <div className="space-y-2.5">
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                  {workItemCounts.done > 0 && (
                    <div
                      className="bg-emerald-500 transition-all"
                      style={{
                        width: `${(workItemCounts.done / workItemCounts.total) * 100}%`,
                      }}
                    />
                  )}
                  {workItemCounts.ready_for_review > 0 && (
                    <div
                      className="bg-amber-500 transition-all"
                      style={{
                        width: `${(workItemCounts.ready_for_review / workItemCounts.total) * 100}%`,
                      }}
                    />
                  )}
                  {workItemCounts.in_progress > 0 && (
                    <div
                      className="bg-primary transition-all"
                      style={{
                        width: `${(workItemCounts.in_progress / workItemCounts.total) * 100}%`,
                      }}
                    />
                  )}
                  {workItemCounts.blocked > 0 && (
                    <div
                      className="bg-destructive transition-all"
                      style={{
                        width: `${(workItemCounts.blocked / workItemCounts.total) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground tabular-nums">
                  <span>{t("projects.projectManagerStatusTodo")}: {workItemCounts.todo}</span>
                  <span>{t("projects.projectManagerStatusInProgress")}: {workItemCounts.in_progress}</span>
                  <span>{t("projects.projectManagerStatusReadyForReview")}: {workItemCounts.ready_for_review}</span>
                  {workItemCounts.blocked > 0 && (
                    <span className="text-destructive">
                      {t("projects.projectManagerStatusBlocked")}: {workItemCounts.blocked}
                    </span>
                  )}
                  <span>{t("projects.projectManagerStatusDone")}: {workItemCounts.done}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("projects.projectManagerNoWorkItemsBody")}
              </p>
            )}
          </section>

          {/* 5. AI Rules & Context Preview */}
          <section className="rounded-lg border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileCode2 className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">
                  {t("projects.overviewRulesPreview")}
                </h2>
              </div>
              <div className="flex items-center gap-1.5">
                {activeRulePath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenFileInFiles(activeRulePath)}
                  >
                    {t("projects.overviewOpenInFiles")}
                    <ArrowRight className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {detectedRuleFiles.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {detectedRuleFiles.map((filePath) => (
                    <Button
                      key={filePath}
                      type="button"
                      size="sm"
                      variant={activeRulePath === filePath ? "secondary" : "outline"}
                      className="h-7 px-2.5 font-mono text-xs"
                      onClick={() => setSelectedRuleFile(filePath)}
                    >
                      {filePath}
                    </Button>
                  ))}
                </div>
                {ruleFileQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">{t("projects.workspaceLoading")}</p>
                ) : ruleFileQuery.data?.content ? (
                  <div className="max-h-72 overflow-y-auto rounded-md border bg-muted/20 p-3 text-sm">
                    <MarkdownRenderer content={ruleFileQuery.data.content} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("projects.workspaceFileEmpty")}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {t("projects.scanNoInstructionFiles")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onSelectTab("config")}
                >
                  {t("projects.overviewOpenConfig")}
                </Button>
              </div>
            )}
          </section>
        </div>

        {/* Collapsible Right Properties & Context Sidebar */}
        {sidebarOpen && (
          <aside className="w-full shrink-0 space-y-4 lg:w-[340px] xl:w-[360px]">
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="text-sm font-semibold">
                {t("projects.overviewProperties")}
              </h2>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <GitBranch className="size-3.5" />
                    <span>{t("projects.overviewGitBranch")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {gitData?.isGitRepo ? (
                      <button
                        type="button"
                        onClick={() => onSelectTab("git")}
                        className="font-medium hover:underline"
                      >
                        {gitData.branch || "HEAD"} ·{" "}
                        {gitData.changed.length === 0
                          ? t("projects.gitClean")
                          : t("projects.gitDirtyCount").replace("{count}", String(gitData.changed.length))}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("projects.scanNotGitRepo")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Layers className="size-3.5" />
                    <span>{t("projects.overviewConfigStatus")}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectTab("config")}
                    className="truncate font-medium hover:underline"
                  >
                    {templateName ?? t("projects.templateUnbound")}
                    {overrideSkillCount > 0 ? ` · ${overrideSkillCount}` : ""}
                  </button>
                </div>

                {appliedProviderLabel && (
                  <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Sparkles className="size-3.5" />
                      <span>{t("projects.model")}</span>
                    </div>
                    <span className="truncate font-medium">{appliedProviderLabel}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Network className="size-3.5" />
                    <span>{t("projects.overviewCodeGraphStatus")}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectTab("graph")}
                    className="font-medium hover:underline"
                  >
                    {graphAvailable
                      ? t("projects.scanCodeGraphReady")
                      : t("projects.scanCodeGraphMissing")}
                  </button>
                </div>

                <div className="rounded-md border px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <FolderGit2 className="size-3.5" />
                      {t("projects.directoryPath")}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyPath}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground hover:underline"
                    >
                      {copiedPath ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {t("projects.copyPath")}
                    </button>
                  </div>
                  <p className="break-all font-mono text-[11px] text-foreground/90">
                    {displayPath}
                  </p>
                </div>
              </div>
            </section>

            <WorkspaceContextPanel projectId={project.id} />
          </aside>
        )}
      </div>
    </div>
  );
}
