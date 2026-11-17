"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileDiff, GitBranch, GitCommitHorizontal, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitDiffSheet, type GitDiffTarget } from "@/components/sessions/git-diff-sheet";
import { useLanguage } from "@/hooks/use-language";
import { getProjectGitChanges, type GitWorkingTreeEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  /** Render borderless inside a tabbed inspector pane (avoids nested scrollbars). */
  embedded?: boolean;
  /** Reports the working-tree change count for the inspector tab badge. */
  onChangedCount?: (count: number | null) => void;
}

const REFRESH_INTERVAL_MS = 15_000;
const FILES_PER_PAGE = 100;

export function GitChangesPanel({ projectId, embedded = false, onChangedCount }: Props) {
  const { t } = useLanguage();
  const [diffTarget, setDiffTarget] = useState<GitDiffTarget | null>(null);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["project-git-changes", projectId],
    queryFn: () => getProjectGitChanges(projectId),
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });

  // The inspector tab badge needs the working-tree size without duplicating
  // the query; report it whenever a settled payload arrives.
  // The payload is validated defensively: a Gateway version skew or a partial
  // response must degrade to "no changes", never crash the inspector pane.
  const changed = Array.isArray(data?.changed) ? data.changed : [];
  const commits = Array.isArray(data?.commits) ? data.commits : [];
  useEffect(() => {
    if (!onChangedCount) return;
    onChangedCount(data ? changed.length : null);
  }, [changed.length, data, onChangedCount]);

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
          className="size-6 shrink-0 text-muted-foreground"
          onClick={() => void refetch()}
          aria-label={t("sessions.gitRefresh")}
          title={t("sessions.gitRefresh")}
        >
          <RefreshCw className={cn("size-3", isFetching && "animate-spin")} />
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
          <div className="mt-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileDiff className="size-3.5" />
              {t("sessions.gitWorkingTree")}
              {changed.length > 0 && !embedded && (
                <span className="text-muted-foreground/60">({changed.length})</span>
              )}
            </div>
            {changed.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{t("sessions.gitNoChanges")}</p>
            ) : (
              <GitWorkingTreeList
                key={projectId}
                entries={changed}
                embedded={embedded}
                onOpen={setDiffTarget}
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
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                        {commit.hash}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs" title={commit.subject}>
                        {commit.subject}
                      </span>
                    </div>
                    <div className="pl-11 text-[10px] text-muted-foreground/60">
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
      />
    </section>
  );
}

interface GitWorkingTreeListProps {
  entries: GitWorkingTreeEntry[];
  embedded?: boolean;
  onOpen: (target: GitDiffTarget) => void;
}

function GitWorkingTreeList({ entries, embedded = false, onOpen }: GitWorkingTreeListProps) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const query = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => query ? entries.filter((entry) => entry.path.toLowerCase().includes(query)) : entries,
    [entries, query]
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / FILES_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * FILES_PER_PAGE;
  const visible = filtered.slice(start, start + FILES_PER_PAGE);

  // A refresh can remove the last page. Keep the user on the last available page.
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [page, currentPage]);

  return (
    <div className="mt-1.5 space-y-2">
      <Input
        type="search"
        className="h-7 px-2 text-xs md:text-xs"
        value={filter}
        placeholder={t("sessions.gitFilterFiles")}
        aria-label={t("sessions.gitFilterFiles")}
        onChange={(event) => { setFilter(event.target.value); setPage(0); }}
      />
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("sessions.gitNoMatchingFiles")}</p>
      ) : (
        <>
          <ul
            key={`${query}-${currentPage}`}
            className={cn("space-y-0.5", !embedded && "max-h-80 overflow-y-auto")}
          >
            {visible.map((entry) => (
              <GitChangeRow key={`${entry.status}-${entry.path}`} entry={entry} onOpen={onOpen} />
            ))}
          </ul>
          {(entries.length > FILES_PER_PAGE || query) && (
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
  onOpen,
}: {
  entry: GitWorkingTreeEntry;
  onOpen: (target: GitDiffTarget) => void;
}) {
  const meta = gitStatusMeta(entry.status);
  const untracked = entry.status === "??";
  const { dir, base } = splitPath(entry.path);
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
        onClick={() => onOpen({ path: entry.path, untracked })}
        title={entry.path}
      >
        <span
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold",
            meta.className
          )}
          aria-hidden="true"
        >
          {meta.label}
        </span>
        {/* The directory truncates first so the file name always stays
            readable, which is what a changed-file list is scanned for. */}
        <span className="flex min-w-0 flex-1 items-baseline font-mono text-xs">
          <span className="min-w-0 truncate text-muted-foreground/55">{dir}</span>
          <span className="shrink-0">{base}</span>
        </span>
        {entry.staged && (
          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
        )}
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
      return { label: "R", className: "bg-hue-sky/12 text-hue-sky" };
    case "C":
      return { label: "C", className: "bg-hue-sky/12 text-hue-sky" };
    default:
      return { label: code || "?", className: "bg-muted text-muted-foreground" };
  }
}
