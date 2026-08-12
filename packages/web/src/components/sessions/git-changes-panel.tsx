"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDiff, GitBranch, GitCommitHorizontal, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GitDiffSheet, type GitDiffTarget } from "@/components/sessions/git-diff-sheet";
import { useLanguage } from "@/hooks/use-language";
import { getProjectGitChanges, type GitWorkingTreeEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
}

const REFRESH_INTERVAL_MS = 15_000;

export function GitChangesPanel({ projectId }: Props) {
  const { t } = useLanguage();
  const [diffTarget, setDiffTarget] = useState<GitDiffTarget | null>(null);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["project-git-changes", projectId],
    queryFn: () => getProjectGitChanges(projectId),
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });

  return (
    <section className="rounded-lg border border-border p-3" data-testid="git-changes-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{t("sessions.gitChanges")}</span>
          {data?.branch && (
            <span className="shrink-0 rounded-full bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
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
      ) : data && !data.isGitRepo ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("sessions.gitNotRepo")}</p>
      ) : (
        <>
          <div className="mt-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileDiff className="size-3.5" />
              {t("sessions.gitWorkingTree")}
              {data && data.changed.length > 0 && (
                <span className="text-muted-foreground/60">({data.changed.length})</span>
              )}
            </div>
            {!data || data.changed.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground">{t("sessions.gitNoChanges")}</p>
            ) : (
              <ul className="mt-1.5 space-y-0.5">
                {data.changed.map((entry) => (
                  <GitChangeRow
                    key={`${entry.status}-${entry.path}`}
                    entry={entry}
                    onOpen={(target) => setDiffTarget(target)}
                  />
                ))}
              </ul>
            )}
          </div>

          {data && data.commits.length > 0 && (
            <div className="mt-3 border-t border-border/70 pt-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitCommitHorizontal className="size-3.5" />
                {t("sessions.gitCommits")}
              </div>
              <ul className="mt-1.5 space-y-1">
                {data.commits.map((commit) => (
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

function GitChangeRow({
  entry,
  onOpen,
}: {
  entry: GitWorkingTreeEntry;
  onOpen: (target: GitDiffTarget) => void;
}) {
  const meta = gitStatusMeta(entry.status);
  const untracked = entry.status === "??";
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
        onClick={() => onOpen({ path: entry.path, untracked })}
      >
        <span
          className={cn("w-3 shrink-0 text-center font-mono text-[10px] font-semibold", meta.className)}
          title={entry.status.trim() || entry.status}
        >
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.path}>
          {entry.path}
        </span>
        {entry.staged && (
          <span className="size-1 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

function gitStatusMeta(status: string): { label: string; className: string } {
  if (status === "??") return { label: "U", className: "text-emerald-400" };
  const code = status.trim().charAt(0) || status.charAt(1) || status.charAt(0);
  switch (code) {
    case "M":
      return { label: "M", className: "text-amber-400" };
    case "A":
      return { label: "A", className: "text-emerald-400" };
    case "D":
      return { label: "D", className: "text-red-400" };
    case "R":
      return { label: "R", className: "text-sky-400" };
    case "C":
      return { label: "C", className: "text-sky-400" };
    default:
      return { label: code || "?", className: "text-muted-foreground" };
  }
}
