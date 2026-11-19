"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  RotateCcw,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { GitDiffSheet, type GitDiffTarget } from "@/components/sessions/git-diff-sheet";
import { useLanguage } from "@/hooks/use-language";
import {
  commitProjectGitChanges,
  discardProjectGitFile,
  getProjectGitChanges,
  stageProjectGitFiles,
  unstageProjectGitFiles,
  type GitWorkingTreeEntry,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  /** Render borderless inside a tabbed inspector pane (avoids nested scrollbars). */
  embedded?: boolean;
  /** Reports the working-tree change count for the inspector tab badge. */
  onChangedCount?: (count: number | null) => void;
  /** Optional jump handler from GitDiffSheet to the project Files tab. */
  onOpenInFiles?: (path: string) => void;
}

const REFRESH_INTERVAL_MS = 15_000;
const FILES_PER_PAGE = 100;

type GitStageFilter = "all" | "staged" | "unstaged";

export function GitChangesPanel({
  projectId,
  embedded = false,
  onChangedCount,
  onOpenInFiles,
}: Props) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [diffTarget, setDiffTarget] = useState<GitDiffTarget | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [discardTarget, setDiscardTarget] = useState<{
    path: string;
    untracked: boolean;
  } | null>(null);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["project-git-changes", projectId],
    queryFn: () => getProjectGitChanges(projectId),
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });

  // The payload is validated defensively: a Gateway version skew or a partial
  // response must degrade to "no changes", never crash the inspector pane.
  const changed = Array.isArray(data?.changed) ? data.changed : [];
  const commits = Array.isArray(data?.commits) ? data.commits : [];

  useEffect(() => {
    if (!onChangedCount) return;
    onChangedCount(data ? changed.length : null);
  }, [changed.length, data, onChangedCount]);

  function applyGitResult(nextGit: { isGitRepo: boolean; changed: GitWorkingTreeEntry[] }) {
    queryClient.setQueryData(["project-git-changes", projectId], (prev: typeof data) =>
      prev ? { ...prev, ...nextGit } : nextGit,
    );
    void queryClient.invalidateQueries({ queryKey: ["project-git-changes", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["project-git-branches", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["project-git-summaries"] });
  }

  const stageMutation = useMutation({
    mutationFn: (input: { all?: boolean; paths?: string[] }) => stageProjectGitFiles(projectId, input),
    onSuccess: (res) => {
      applyGitResult(res.git);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("sessions.gitLoadFailed"));
    },
  });

  const unstageMutation = useMutation({
    mutationFn: (input: { all?: boolean; paths?: string[] }) => unstageProjectGitFiles(projectId, input),
    onSuccess: (res) => {
      applyGitResult(res.git);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("sessions.gitLoadFailed"));
    },
  });

  const commitMutation = useMutation({
    mutationFn: (message: string) => commitProjectGitChanges(projectId, message),
    onSuccess: (res) => {
      const committedCount = stagedCount;
      setCommitMessage("");
      applyGitResult(res.git);
      toast.success(t("projects.gitCommitSuccess").replace("{count}", String(committedCount)));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("sessions.gitLoadFailed"));
    },
  });

  const discardMutation = useMutation({
    mutationFn: (target: { path: string; untracked: boolean }) =>
      discardProjectGitFile(projectId, target.path, { untracked: target.untracked }),
    onSuccess: (res) => {
      applyGitResult(res.git);
      if (diffTarget && discardTarget && diffTarget.path === discardTarget.path) {
        setDiffTarget(null);
      }
      setDiscardTarget(null);
      toast.success(t("projects.gitDiscardSuccess"));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("sessions.gitLoadFailed"));
    },
  });

  const stagedEntries = useMemo(() => changed.filter((entry) => entry.staged), [changed]);
  const stagedCount = stagedEntries.length;
  const hasUnstaged = useMemo(
    () => changed.some((entry) => entry.status === "??" || (entry.status.length >= 2 && entry.status[1] !== " ")),
    [changed],
  );
  const gitBusy =
    stageMutation.isPending ||
    unstageMutation.isPending ||
    commitMutation.isPending ||
    discardMutation.isPending;

  return (
    <section
      className={embedded ? "space-y-3" : "rounded-lg border border-border p-3"}
      data-testid="git-changes-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          {/* The inspector tab already names this pane, so the embedded variant
              leads with the branch instead of repeating the heading. */}
          {embedded ? null : <span className="shrink-0">{t("sessions.gitChanges")}</span>}
          {data?.branch && (
            <span
              className="min-w-0 truncate rounded-full bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={data.branch}
            >
              {data.branch}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t("sessions.gitRefresh")}
          title={t("sessions.gitRefresh")}
          disabled={isFetching}
          onClick={() => refetch()}
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
        </Button>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-destructive">{t("sessions.gitLoadFailed")}</p>
      ) : !data ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : !data.isGitRepo ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("sessions.gitNotRepo")}</p>
      ) : (
        <>
          <div className={embedded ? "space-y-3" : "mt-3 border-t border-border/70 pt-3"}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <FileDiff className="size-3.5" />
                <span>{t("sessions.gitWorkingTree")}</span>
                <span className="tabular-nums">({changed.length})</span>
              </div>

              {changed.length > 0 && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={gitBusy || !hasUnstaged}
                    onClick={() => stageMutation.mutate({ all: true })}
                  >
                    <CheckSquare className="size-3" />
                    {t("projects.gitStageAll")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={gitBusy || stagedCount === 0}
                    onClick={() => unstageMutation.mutate({ all: true })}
                  >
                    <Square className="size-3" />
                    {t("projects.gitUnstageAll")}
                  </Button>
                </div>
              )}
            </div>

            {changed.length > 0 && (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (stagedCount === 0 || !commitMessage.trim() || gitBusy) return;
                  commitMutation.mutate(commitMessage.trim());
                }}
              >
                <Input
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder={t("projects.gitCommitPlaceholder")}
                  className="h-7 flex-1 text-xs md:text-xs"
                  disabled={commitMutation.isPending}
                />
                <Button
                  type="submit"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={stagedCount === 0 || !commitMessage.trim() || gitBusy}
                >
                  {t("projects.gitCommitSubmit").replace("{count}", String(stagedCount))}
                </Button>
              </form>
            )}

            {changed.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{t("sessions.gitNoChanges")}</p>
            ) : (
              <GitWorkingTreeList
                key={projectId}
                entries={changed}
                embedded={embedded}
                busy={gitBusy}
                onOpen={setDiffTarget}
                onToggleStage={(entry) => {
                  if (entry.staged) unstageMutation.mutate({ paths: [entry.path] });
                  else stageMutation.mutate({ paths: [entry.path] });
                }}
                onDiscard={(entry) =>
                  setDiscardTarget({ path: entry.path, untracked: entry.status === "??" })
                }
              />
            )}
          </div>

          {commits.length > 0 && (
            <div className="mt-3 border-t border-border/70 pt-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitCommitHorizontal className="size-3.5" />
                {t("sessions.gitCommits")}
              </div>
              <ul className="mt-1.5 space-y-1">
                {commits.map((commit) => (
                  <li key={commit.hash} className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <code className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {commit.hash}
                      </code>
                      <span className="truncate text-xs">{commit.subject}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {commit.author} · {commit.relativeDate}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <GitDiffSheet
        projectId={projectId}
        target={diffTarget}
        onClose={() => setDiffTarget(null)}
        onOpenInFiles={onOpenInFiles}
        actionBusy={gitBusy}
        onToggleStage={(target) => {
          const syncTarget = (nextChanged: GitWorkingTreeEntry[]) => {
            const refreshed = nextChanged.find((entry) => entry.path === target.path);
            if (!refreshed) {
              setDiffTarget(null);
              return;
            }
            setDiffTarget({
              path: refreshed.path,
              staged: refreshed.staged,
              untracked: refreshed.status === "??",
            });
          };
          if (target.staged) {
            unstageMutation.mutate(
              { paths: [target.path] },
              { onSuccess: (res) => syncTarget(res.git.changed) },
            );
          } else {
            stageMutation.mutate(
              { paths: [target.path] },
              { onSuccess: (res) => syncTarget(res.git.changed) },
            );
          }
        }}
        onDiscard={(target) =>
          setDiscardTarget({ path: target.path, untracked: target.untracked })
        }
      />

      <ConfirmDialog
        open={discardTarget !== null}
        destructive
        pending={discardMutation.isPending}
        title={t("projects.gitDiscardConfirmTitle")}
        description={
          discardTarget
            ? t("projects.gitDiscardConfirmDescription").replace("{path}", discardTarget.path)
            : ""
        }
        confirmLabel={t("projects.gitDiscardFile")}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
        onConfirm={() => {
          if (discardTarget) discardMutation.mutate(discardTarget);
        }}
      />
    </section>
  );
}

interface GitWorkingTreeListProps {
  entries: GitWorkingTreeEntry[];
  embedded?: boolean;
  busy?: boolean;
  onOpen: (target: GitDiffTarget) => void;
  onToggleStage: (entry: GitWorkingTreeEntry) => void;
  onDiscard: (entry: GitWorkingTreeEntry) => void;
}

function GitWorkingTreeList({
  entries,
  embedded = false,
  busy = false,
  onOpen,
  onToggleStage,
  onDiscard,
}: GitWorkingTreeListProps) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState("");
  const [stageFilter, setStageFilter] = useState<GitStageFilter>("all");
  const [page, setPage] = useState(0);

  const stagedCount = useMemo(() => entries.filter((e) => e.staged).length, [entries]);
  const unstagedCount = useMemo(() => entries.length - stagedCount, [entries.length, stagedCount]);

  const query = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      if (stageFilter === "staged" && !entry.staged) return false;
      if (stageFilter === "unstaged" && entry.staged) return false;
      if (query && !entry.path.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [entries, query, stageFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / FILES_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * FILES_PER_PAGE;
  const visible = filtered.slice(start, start + FILES_PER_PAGE);

  const stageLabel = t("projects.gitStageFile");
  const unstageLabel = t("projects.gitUnstageFile");
  const discardLabel = t("projects.gitDiscardFile");

  // A refresh can remove the last page. Keep the user on the last available page.
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);

  return (
    <div className="mt-1.5 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          type="search"
          className="h-7 min-w-[140px] flex-1 px-2 text-xs md:text-xs"
          value={filter}
          placeholder={t("sessions.gitFilterFiles")}
          aria-label={t("sessions.gitFilterFiles")}
          onChange={(event) => {
            setFilter(event.target.value);
            setPage(0);
          }}
        />
        {stagedCount > 0 && unstagedCount > 0 && (
          <div className="flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5 text-[11px]">
            <button
              type="button"
              className={cn(
                "rounded px-1.5 py-0.5",
                stageFilter === "all" && "bg-background font-medium shadow-xs",
              )}
              onClick={() => {
                setStageFilter("all");
                setPage(0);
              }}
            >
              {t("projects.filterAll")} ({entries.length})
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-1.5 py-0.5",
                stageFilter === "staged" && "bg-background font-medium shadow-xs",
              )}
              onClick={() => {
                setStageFilter("staged");
                setPage(0);
              }}
            >
              {t("projects.gitStagedGroup").replace("{count}", String(stagedCount))}
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-1.5 py-0.5",
                stageFilter === "unstaged" && "bg-background font-medium shadow-xs",
              )}
              onClick={() => {
                setStageFilter("unstaged");
                setPage(0);
              }}
            >
              {t("projects.gitUnstagedGroup").replace("{count}", String(unstagedCount))}
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("sessions.gitNoMatchingFiles")}</p>
      ) : (
        <>
          <ul
            key={`${query}-${stageFilter}-${currentPage}`}
            className={cn("space-y-0.5", !embedded && "max-h-80 overflow-y-auto")}
          >
            {visible.map((entry) => (
              <GitChangeRow
                key={`${entry.status}-${entry.path}`}
                entry={entry}
                busy={busy}
                stageLabel={stageLabel}
                unstageLabel={unstageLabel}
                discardLabel={discardLabel}
                onOpen={onOpen}
                onToggleStage={onToggleStage}
                onDiscard={onDiscard}
              />
            ))}
          </ul>
          {(entries.length > FILES_PER_PAGE || query || stageFilter !== "all") && (
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span aria-live="polite">
                {t("sessions.gitFileRange")
                  .replace("{start}", String(start + 1))
                  .replace("{end}", String(start + visible.length))
                  .replace("{total}", String(filtered.length))}
              </span>
              {pageCount > 1 && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={t("sessions.gitPreviousPage")}
                    title={t("sessions.gitPreviousPage")}
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    <ChevronLeft className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={t("sessions.gitNextPage")}
                    title={t("sessions.gitNextPage")}
                    disabled={currentPage === pageCount - 1}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    <ChevronRight className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function splitPath(path: string): { dir: string; base: string } {
  const index = path.lastIndexOf("/");
  if (index < 0) return { dir: "", base: path };
  return { dir: path.slice(0, index + 1), base: path.slice(index + 1) };
}

function GitChangeRow({
  entry,
  busy = false,
  stageLabel,
  unstageLabel,
  discardLabel,
  onOpen,
  onToggleStage,
  onDiscard,
}: {
  entry: GitWorkingTreeEntry;
  busy?: boolean;
  stageLabel: string;
  unstageLabel: string;
  discardLabel: string;
  onOpen: (target: GitDiffTarget) => void;
  onToggleStage: (entry: GitWorkingTreeEntry) => void;
  onDiscard: (entry: GitWorkingTreeEntry) => void;
}) {
  const meta = gitStatusMeta(entry.status);
  const untracked = entry.status === "??";
  const { dir, base } = splitPath(entry.path);
  return (
    <li className="group flex items-center gap-1 rounded px-1 hover:bg-accent/50">
      <input
        type="checkbox"
        checked={entry.staged}
        disabled={busy}
        aria-label={`${entry.staged ? unstageLabel : stageLabel}: ${entry.path}`}
        onChange={() => onToggleStage(entry)}
        className="size-3.5 shrink-0 cursor-pointer rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="button"
        data-testid="git-change-file-button"
        onClick={() => onOpen({ path: entry.path, untracked, staged: entry.staged })}
        className="flex min-w-0 flex-1 items-center gap-2 rounded py-1 pl-1 pr-1 text-left transition-colors"
      >
        <span
          className={cn(
            "flex min-w-0 flex-1 font-mono text-[11px]",
            entry.staged && "text-emerald-700 dark:text-emerald-300",
          )}
          title={entry.path}
        >
          {dir ? (
            <span className="min-w-0 truncate text-muted-foreground">{dir}</span>
          ) : null}
          <span className="shrink-0">{base}</span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-1 py-0.5 font-mono text-[10px]",
            meta.className,
          )}
        >
          {meta.label}
        </span>
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label={discardLabel}
        title={`${discardLabel}: ${entry.path}`}
        onClick={() => onDiscard(entry)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive focus:opacity-100 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-50"
      >
        <RotateCcw className="size-3" />
      </button>
    </li>
  );
}

function gitStatusMeta(status: string): { label: string; className: string } {
  if (status === "??") return { label: "U", className: "bg-success/12 text-success" };
  const code = status.trim().charAt(0) || status.charAt(1) || status.charAt(0);
  switch (code) {
    case "M":
      return { label: "M", className: "bg-warning/12 text-warning" };
    case "A":
      return { label: "A", className: "bg-success/12 text-success" };
    case "D":
      return { label: "D", className: "bg-destructive/12 text-destructive" };
    case "R":
    case "C":
      return { label: "R", className: "bg-primary/12 text-primary" };
    default:
      return { label: code || "?", className: "bg-muted text-muted-foreground" };
  }
}
