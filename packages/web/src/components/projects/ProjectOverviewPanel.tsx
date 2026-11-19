"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  Copy,
  FileCode2,
  FolderGit2,
  GitBranch,
  Layers,
  Link2,
  ListChecks,
  Network,
  Pencil,
  Play,
  Sparkles,
  Target,
  Terminal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CliBrandChip } from "@/components/cli-brand-chip";
import { WORK_ITEM_LIMIT } from "@/components/projects/project-manager/types";
import { findSessionTaskPacket } from "@/components/sessions/session-task-packet";
import { formatSessionRelativeTime } from "@/components/sessions/session-board-utils";
import { useLanguage } from "@/hooks/use-language";
import {
  getProjectGitChanges,
  getProjectGraphOverview,
  getProjectManagerGoal,
  getProjectWorkspaceTree,
  listProjectManagerWorkItems,
  type Project,
  type ProjectManagerTaskPacket,
  type Session,
} from "@/lib/api";
import { listGoals } from "@/lib/copilot-api";
import { listFleets } from "@/lib/fleet-api";
import { normalizeSessionStatus } from "@/lib/session-status";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type ProjectOverviewTarget =
  | { tab: "project-manager"; workItemId?: string }
  | { tab: "code"; view: "files" | "git" | "graph"; file?: string }
  | { tab: "config"; view?: "rules" | "skills" };

interface ProjectOverviewPanelProps {
  project: Project;
  sessions: Session[];
  taskPackets?: ProjectManagerTaskPacket[];
  now?: number | null;
  actorId?: string | null;
  templateName?: string | null;
  overrideSkillCount?: number;
  appliedProviderLabel?: string | null;
  onNavigate: (target: ProjectOverviewTarget) => void;
  onEditMetadata: () => void;
  onStartSession?: () => void;
  onStartShell?: () => void;
  onAskCopilot?: () => void;
}

const RULE_FILE_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "GEMINI.md",
  ".cursorrules",
];

const INITIAL_SESSION_LIMIT = 6;

function isSessionLive(status: string): boolean {
  const normalized = normalizeSessionStatus(status);
  return normalized === "running";
}

/**
 * Focused Vibe Coding Command Center overview for a project:
 * unifies project goal/context, live & recent CLI sessions, active Copilot
 * Goals & Fleets, task progress, and a compact engineering snapshot sidebar.
 */
export function ProjectOverviewPanel({
  project,
  sessions,
  taskPackets = [],
  now = null,
  actorId = null,
  templateName = null,
  overrideSkillCount = 0,
  appliedProviderLabel = null,
  onNavigate,
  onEditMetadata,
  onStartSession,
  onStartShell,
  onAskCopilot,
}: ProjectOverviewPanelProps) {
  const { t, language } = useLanguage();
  const [copiedPath, setCopiedPath] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);

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

  const runningCount = useMemo(
    () => sessions.filter((s) => isSessionLive(s.status)).length,
    [sessions],
  );

  const visibleSessions = showAllSessions
    ? orderedSessions
    : orderedSessions.slice(0, INITIAL_SESSION_LIMIT);

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
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 space-y-4">
        {/* 1. Project Goal & Context */}
        <section className="space-y-3 rounded-lg border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Target className="size-4 text-brand" />
              <h2 className="text-sm font-semibold">{t("projects.overviewGoalTitle")}</h2>
              {goal?.status && (
                <Badge variant="outline" className="rounded-full text-[11px]">
                  {goal.status}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={onEditMetadata}>
                <Pencil className="size-3.5" />
                {t("projects.editMetadata")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleAskCopilot}>
                <Sparkles className="size-3.5 text-brand" />
                {t("projects.overviewAskCopilot")}
              </Button>
            </div>
          </div>

          {goal?.summary ? (
            <div className="space-y-1.5">
              <p className="text-sm leading-relaxed">{goal.summary}</p>
              {project.description && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {project.description}
                </p>
              )}
            </div>
          ) : project.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {project.description}
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("projects.overviewNoGoal")}
            </p>
          )}
        </section>

        {/* 2. Project AI CLI & Shell Sessions */}
        <section className="space-y-3 rounded-lg border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-brand" />
              <h2 className="text-sm font-semibold">{t("nav.sessions")}</h2>
              <Badge variant="secondary" className="rounded-full text-[11px] tabular-nums">
                {t("projects.sessionsSummary")
                  .replace("{total}", String(sessions.length))
                  .replace("{running}", String(runningCount))}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5">
              {onStartShell && (
                <Button type="button" size="sm" variant="ghost" onClick={onStartShell}>
                  <Terminal className="size-3.5" />
                  {t("projects.startShell")}
                </Button>
              )}
              {onStartSession && (
                <Button type="button" size="sm" variant="outline" onClick={onStartSession}>
                  <Play className="size-3.5" />
                  {t("projects.newSession")}
                </Button>
              )}
            </div>
          </div>

          {orderedSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("projects.overviewNoSessions")}</p>
          ) : (
            <div className="space-y-2">
              <div className="divide-y divide-border/70 rounded-md border border-border/70">
                {visibleSessions.map((session) => {
                  const normalized = normalizeSessionStatus(session.status);
                  const live = normalized === "running";
                  const linkedPacket = findSessionTaskPacket(taskPackets, session.id);
                  const relativeTime =
                    now === null ? null : formatSessionRelativeTime(session, now, language);

                  return (
                    <div
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/30"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              live
                                ? "forgebadger-pulse-dot bg-success"
                                : normalized === "error"
                                  ? "bg-destructive"
                                  : normalized === "lost"
                                    ? "bg-warning"
                                    : "bg-muted-foreground/40",
                            )}
                          />
                          <Link
                            href={`/sessions/${session.id}`}
                            className="truncate text-sm font-medium hover:text-brand hover:underline"
                          >
                            {session.name || session.runtimeSessionName || session.id}
                          </Link>
                          {session.aiTool && <CliBrandChip aiTool={session.aiTool} />}
                          {linkedPacket && (
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate({
                                  tab: "project-manager",
                                  workItemId: linkedPacket.workItemId,
                                })
                              }
                              className="inline-flex max-w-44 items-center gap-1 rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] text-brand hover:underline"
                              title={linkedPacket.title}
                            >
                              <Link2 className="size-3 shrink-0" />
                              <span className="truncate">{linkedPacket.title}</span>
                            </button>
                          )}
                          {relativeTime && (
                            <span className="text-[11px] text-muted-foreground">
                              {relativeTime}
                            </span>
                          )}
                        </div>
                        {session.lastPrompt && (
                          <p className="truncate pl-4 text-xs text-muted-foreground">
                            {session.lastPrompt}
                          </p>
                        )}
                      </div>
                      <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-xs">
                        <Link href={`/sessions/${session.id}`}>
                          {t("projects.projectManagerOpenSession")}
                          <ArrowUpRight className="size-3.5" />
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </div>

              {orderedSessions.length > INITIAL_SESSION_LIMIT && (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setShowAllSessions((prev) => !prev)}
                  >
                    {showAllSessions
                      ? t("projects.overviewCollapseSessions")
                      : t("projects.overviewShowAllSessions").replace(
                          "{count}",
                          String(orderedSessions.length),
                        )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 3. Autonomous Copilot Goals & Fleet */}
        {(projectGoals.length > 0 || projectFleets.length > 0) && (
          <section className="space-y-3 rounded-lg border bg-card p-5 shadow-card">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-brand" />
              <h2 className="text-sm font-semibold">{t("projects.overviewGoalsAndFleet")}</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {projectFleets.map((fleet) => (
                <Link
                  key={fleet.id}
                  href={`/fleet/${fleet.id}`}
                  className="group rounded-md border border-border/70 p-3 transition-colors hover:border-brand/40 hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary" className="rounded-full text-[10px]">
                      {t("projects.activeFleetBadge")
                        .replace("{running}", String(fleet.taskRunning))
                        .replace("{total}", String(fleet.taskTotal))}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{fleet.status}</span>
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
                  className="group rounded-md border border-border/70 p-3 transition-colors hover:border-brand/40 hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {t("projects.activeGoalBadge")
                        .replace("{passes}", String(cGoal.taskPasses))
                        .replace("{total}", String(cGoal.taskTotal))}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{cGoal.status}</span>
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
          </section>
        )}

        {/* 4. Compact Task Progress Strip */}
        <section className="space-y-3 rounded-lg border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-brand" />
              <h2 className="text-sm font-semibold">{t("projects.overviewWorkProgress")}</h2>
              {workItemCounts.total > 0 && (
                <Badge variant="secondary" className="rounded-full text-[11px] tabular-nums">
                  {workItemCounts.done}/{workItemCounts.total}
                </Badge>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onNavigate({ tab: "project-manager" })}
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
                    style={{ width: `${(workItemCounts.done / workItemCounts.total) * 100}%` }}
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
                    className="bg-brand transition-all"
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
                <span>
                  {t("projects.projectManagerStatusTodo")}: {workItemCounts.todo}
                </span>
                <span>
                  {t("projects.projectManagerStatusInProgress")}: {workItemCounts.in_progress}
                </span>
                <span>
                  {t("projects.projectManagerStatusReadyForReview")}:{" "}
                  {workItemCounts.ready_for_review}
                </span>
                {workItemCounts.blocked > 0 && (
                  <span className="text-destructive">
                    {t("projects.projectManagerStatusBlocked")}: {workItemCounts.blocked}
                  </span>
                )}
                <span>
                  {t("projects.projectManagerStatusDone")}: {workItemCounts.done}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("projects.tasksNoGoalYet")}</p>
          )}
        </section>
      </div>

      {/* Focused Engineering Snapshot Sidebar (no duplicate file tree) */}
      <aside className="w-full shrink-0 lg:w-[320px] xl:w-[340px]">
        <section className="space-y-3 rounded-lg border bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold">{t("projects.overviewProperties")}</h2>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <GitBranch className="size-3.5" />
                <span>{t("projects.overviewGitBranch")}</span>
              </div>
              {gitData?.isGitRepo ? (
                <button
                  type="button"
                  onClick={() => onNavigate({ tab: "code", view: "git" })}
                  className="font-medium hover:text-brand hover:underline"
                >
                  {gitData.branch || "HEAD"} ·{" "}
                  {gitData.changed.length === 0
                    ? t("projects.gitClean")
                    : t("projects.gitDirtyCount").replace("{count}", String(gitData.changed.length))}
                </button>
              ) : (
                <span className="text-muted-foreground">{t("projects.scanNotGitRepo")}</span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Layers className="size-3.5" />
                <span>{t("projects.overviewConfigStatus")}</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate({ tab: "config" })}
                className="truncate font-medium hover:text-brand hover:underline"
              >
                {templateName ?? t("projects.templateUnbound")}
                {overrideSkillCount > 0 ? ` · ${overrideSkillCount}` : ""}
              </button>
            </div>

            {appliedProviderLabel && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Sparkles className="size-3.5" />
                  <span>{t("projects.model")}</span>
                </div>
                <span className="truncate font-medium">{appliedProviderLabel}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Network className="size-3.5" />
                <span>{t("projects.overviewCodeGraphStatus")}</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate({ tab: "code", view: "graph" })}
                className="font-medium hover:text-brand hover:underline"
              >
                {graphAvailable
                  ? t("projects.scanCodeGraphReady")
                  : t("projects.scanCodeGraphMissing")}
              </button>
            </div>

            <div className="space-y-1.5 rounded-md border border-border/70 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <FileCode2 className="size-3.5" />
                  {t("projects.overviewRuleFiles")}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate({ tab: "config", view: "rules" })}
                  className="text-[11px] font-medium text-foreground hover:text-brand hover:underline"
                >
                  {t("projects.overviewOpenConfig")}
                </button>
              </div>
              {detectedRuleFiles.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {detectedRuleFiles.map((filePath) => (
                    <button
                      key={filePath}
                      type="button"
                      onClick={() => onNavigate({ tab: "code", view: "files", file: filePath })}
                      className="rounded border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:border-brand/50 hover:text-brand"
                    >
                      {filePath}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {t("projects.scanNoInstructionFiles")}
                </p>
              )}
            </div>

            <div className="space-y-1.5 rounded-md border border-border/70 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <FolderGit2 className="size-3.5" />
                  {t("projects.directoryPath")}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyPath()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground hover:underline"
                >
                  {copiedPath ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {t("projects.copyPath")}
                </button>
              </div>
              <p className="break-all font-mono text-[11px] text-foreground/90">{displayPath}</p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
