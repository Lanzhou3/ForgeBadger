"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GitBranch, GitBranchPlus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/use-language";
import {
  checkoutProjectGitBranch,
  getProjectGitBranches,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  enabled: boolean;
}

export function GitBranchesPanel({ projectId, enabled }: Props) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["project-git-branches", projectId],
    queryFn: () => getProjectGitBranches(projectId),
    enabled,
    retry: false,
  });

  const invalidateGitQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-git-branches", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-git-changes", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    ]);

  const switchMutation = useMutation({
    mutationFn: (branch: string) => checkoutProjectGitBranch(projectId, { branch }),
    onSuccess: async (result) => {
      toast.success(t("projects.gitSwitchSuccess").replace("{branch}", result.current));
      setSwitchTarget(null);
      await invalidateGitQueries();
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : t("projects.gitSwitchFailed"));
    },
  });

  const createMutation = useMutation({
    mutationFn: (branch: string) => checkoutProjectGitBranch(projectId, { branch, create: true }),
    onSuccess: async (result) => {
      toast.success(t("projects.gitCreateSuccess").replace("{branch}", result.current));
      setCreateDialogOpen(false);
      setNewBranchName("");
      await invalidateGitQueries();
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : t("projects.gitSwitchFailed"));
    },
  });

  const workingTree = data?.workingTree;
  const switchBlocked = workingTree !== undefined && !workingTree.clean;

  return (
    <section className="rounded-lg border border-border p-3" data-testid="git-branches-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0">{t("projects.gitBranches")}</span>
          {data?.current && (
            <span
              className="min-w-0 truncate rounded-full bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={data.current}
            >
              {data.current}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {data?.isGitRepo && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={() => setCreateDialogOpen(true)}
              aria-label={t("projects.gitNewBranch")}
              title={t("projects.gitNewBranch")}
            >
              <GitBranchPlus className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            onClick={() => void refetch()}
            aria-label={t("sessions.gitRefresh")}
            title={t("sessions.gitRefresh")}
          >
            <RefreshCw className={cn("size-3", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-destructive">{t("projects.gitLoadFailed")}</p>
      ) : !data ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : !data.isGitRepo ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("sessions.gitNotRepo")}</p>
      ) : data.branches.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("projects.gitNoBranches")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border/70 overflow-hidden rounded-md border border-border/70">
          {data.branches.map((branch) => (
            <li key={branch.name}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                  branch.isCurrent ? "bg-muted/40" : "hover:bg-muted/30"
                )}
                disabled={branch.isCurrent}
                onClick={() => setSwitchTarget(branch.name)}
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    branch.isCurrent ? "text-brand" : "text-transparent"
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{branch.name}</span>
                {branch.isCurrent && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t("projects.gitBranchCurrent")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={switchTarget !== null}
        onOpenChange={(open) => {
          if (!open && !switchMutation.isPending) setSwitchTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <GitBranch className="size-5 shrink-0" />
              {t("projects.gitSwitchConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("projects.gitSwitchConfirmDesc").replace("{branch}", switchTarget ?? "")}
            </DialogDescription>
          </DialogHeader>
          {switchBlocked && workingTree && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <p>{t("projects.gitWorkingTreeDirty").replace("{count}", String(workingTree.changedCount))}</p>
              {workingTree.sample.length > 0 && (
                <ul className="mt-1 list-inside list-disc font-mono text-[10px]">
                  {workingTree.sample.map((path) => (
                    <li key={path} className="truncate">{path}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={switchMutation.isPending}
              onClick={() => setSwitchTarget(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={switchBlocked || switchMutation.isPending || switchTarget === null}
              onClick={() => switchTarget && switchMutation.mutate(switchTarget)}
            >
              {t("projects.gitSwitchConfirmTitle")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending) {
            setCreateDialogOpen(false);
            setNewBranchName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <GitBranchPlus className="size-5 shrink-0" />
              {t("projects.gitNewBranchTitle")}
            </DialogTitle>
            <DialogDescription>{t("projects.gitNewBranchDesc")}</DialogDescription>
          </DialogHeader>
          <Input
            value={newBranchName}
            onChange={(event) => setNewBranchName(event.target.value)}
            placeholder={t("projects.gitBranchNamePlaceholder")}
            className="font-mono text-sm"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={createMutation.isPending}
              onClick={() => {
                setCreateDialogOpen(false);
                setNewBranchName("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={createMutation.isPending || newBranchName.trim().length === 0}
              onClick={() => createMutation.mutate(newBranchName.trim())}
            >
              {t("projects.gitNewBranch")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
