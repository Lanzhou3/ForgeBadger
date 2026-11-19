"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FolderTree, Pencil, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/hooks/use-language";
import {
  createProjectWorkspaceFile,
  renameProjectWorkspaceEntry,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";
import { WorkspaceTree } from "./WorkspaceTree";

interface WorkspaceExplorerProps {
  projectId?: string | null;
  enabled?: boolean;
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  className?: string;
}

export function WorkspaceExplorer({
  projectId,
  enabled = true,
  selectedPath: controlledPath,
  onSelectPath,
  className,
}: WorkspaceExplorerProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [uncontrolledPath, setUncontrolledPath] = useState<string | null>(null);
  const [viewerDirty, setViewerDirty] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null | undefined>(undefined);

  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const isControlled = controlledPath !== undefined;
  const selectedPath = isControlled ? controlledPath : uncontrolledPath;

  function applySelectedPath(nextPath: string | null) {
    if (!isControlled) {
      setUncontrolledPath(nextPath);
    }
    onSelectPath?.(nextPath);
  }

  function requestSelectPath(nextPath: string | null) {
    if (nextPath === selectedPath) return;
    if (viewerDirty) {
      setPendingPath(nextPath);
      return;
    }
    applySelectedPath(nextPath);
  }

  useEffect(() => {
    if (!isControlled) {
      setUncontrolledPath(null);
    }
    setViewerDirty(false);
    setPendingPath(undefined);
  }, [isControlled, projectId]);

  const createMutation = useMutation({
    mutationFn: (pathValue: string) =>
      createProjectWorkspaceFile(projectId!, pathValue, ""),
    onSuccess: (_data, pathValue) => {
      const normalized = pathValue.trim().replace(/^\/+/, "");
      toast.success(t("projects.workspaceFileCreated"));
      setNewFileOpen(false);
      setNewFilePath("");
      void queryClient.invalidateQueries({ queryKey: ["workspace-context", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-workspace-root", projectId] });
      applySelectedPath(normalized);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : t("projects.workspaceFileSaveFailed"),
      );
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      renameProjectWorkspaceEntry(projectId!, from, to),
    onSuccess: (res) => {
      toast.success(t("projects.workspaceRenamed"));
      setRenameOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["workspace-context", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-workspace-root", projectId] });
      applySelectedPath(res.toPath);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : t("projects.workspaceFileSaveFailed"),
      );
    },
  });

  if (!projectId) {
    return (
      <Card className={cn("forgebadger-animate-in", className)}>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("projects.workspaceNoProject")}
        </CardContent>
      </Card>
    );
  }

  const queryEnabled = enabled;

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newFilePath.trim();
    if (!trimmed) return;
    createMutation.mutate(trimmed);
  }

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed || !selectedPath || trimmed === selectedPath) return;
    renameMutation.mutate({ from: selectedPath, to: trimmed });
  }

  return (
    <div
      data-testid="workspace-explorer"
      className={cn("grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]", className)}
    >
      <Card className="forgebadger-animate-in gap-0 overflow-hidden py-0">
        <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold leading-none">
            <FolderTree className="size-4 text-brand" />
            {t("projects.workspace")}
          </h2>
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => {
                const parentDir = selectedPath && selectedPath.includes("/")
                  ? `${selectedPath.slice(0, selectedPath.lastIndexOf("/") + 1)}`
                  : "";
                setNewFilePath(parentDir);
                setNewFileOpen(true);
              }}
              aria-label={t("projects.workspaceNewFile")}
              title={t("projects.workspaceNewFile")}
            >
              <FilePlus2 className="size-4" />
            </Button>
            {selectedPath && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  setRenameValue(selectedPath);
                  setRenameOpen(true);
                }}
                aria-label={t("projects.workspaceRename")}
                title={t("projects.workspaceRename")}
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: ["workspace-context", projectId] })
              }
              aria-label={t("projects.workspaceRefresh")}
              title={t("projects.workspaceRefresh")}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-2 py-2">
          <div className="max-h-[320px] overflow-auto [scrollbar-width:thin] lg:max-h-[calc(100vh-15rem)]">
            <WorkspaceTree
              projectId={projectId}
              enabled={queryEnabled}
              selectedPath={selectedPath}
              onSelectFile={requestSelectPath}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="forgebadger-animate-in gap-0 overflow-hidden py-0" style={{ animationDelay: "50ms" }}>
        <CardContent className="p-2">
          <WorkspaceFileViewer
            variant="panel"
            projectId={projectId}
            path={selectedPath}
            enabled={queryEnabled}
            onDirtyChange={setViewerDirty}
            className="h-[420px] lg:h-[calc(100vh-15.5rem)]"
          />
        </CardContent>
      </Card>

      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.workspaceNewFileTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <Input
              value={newFilePath}
              onChange={(event) => setNewFilePath(event.target.value)}
              placeholder={t("projects.workspaceNewFilePlaceholder")}
              className="font-mono text-xs"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewFileOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!newFilePath.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? t("common.saving") : t("projects.workspaceNewFile")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projects.workspaceRenameTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-4">
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="font-mono text-xs"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  !renameValue.trim() ||
                  renameValue.trim() === selectedPath ||
                  renameMutation.isPending
                }
              >
                {renameMutation.isPending ? t("common.saving") : t("projects.workspaceRename")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingPath !== undefined}
        destructive
        title={t("projects.workspaceDirtyLeaveTitle")}
        description={t("projects.workspaceDirtyLeaveDescription")}
        confirmLabel={t("common.confirm")}
        onOpenChange={(open) => {
          if (!open) setPendingPath(undefined);
        }}
        onConfirm={() => {
          const target = pendingPath ?? null;
          setPendingPath(undefined);
          setViewerDirty(false);
          applySelectedPath(target);
        }}
      />
    </div>
  );
}
