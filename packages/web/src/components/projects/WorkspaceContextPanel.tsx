"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, Folder, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  getProjectWorkspaceFile,
  getProjectWorkspaceTree,
  type WorkspaceTreeEntry,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";

interface WorkspaceContextPanelProps {
  projectId?: string | null;
  className?: string;
  enabled?: boolean;
}

interface WorkspaceTreeRow {
  entry: WorkspaceTreeEntry;
  depth: number;
}

export function WorkspaceContextPanel({
  projectId,
  className,
  enabled = true,
}: WorkspaceContextPanelProps) {
  const { t } = useLanguage();
  const [selectedPath, setSelectedPath] = useState("");
  const queryEnabled = Boolean(projectId) && enabled;

  useEffect(() => {
    setSelectedPath("");
  }, [projectId]);

  const treeQuery = useQuery({
    queryKey: ["workspace-context", projectId, "tree"],
    queryFn: () => getProjectWorkspaceTree(projectId!, { depth: 2, limit: 200 }),
    enabled: queryEnabled,
    retry: false,
  });

  const rows = useMemo(
    () => flattenWorkspaceTree(treeQuery.data?.entries ?? []),
    [treeQuery.data?.entries]
  );

  const fileQuery = useQuery({
    queryKey: ["workspace-context", projectId, "file", selectedPath],
    queryFn: () => getProjectWorkspaceFile(projectId!, selectedPath),
    enabled: queryEnabled && selectedPath.length > 0,
    retry: false,
  });

  const selectedFile = fileQuery.data;

  return (
    <Card
      data-testid="workspace-context-panel"
      className={cn("of-animate-in overflow-hidden", className)}
    >
      <CardHeader className="space-y-3 px-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold leading-none">
              {t("projects.workspace")}
            </h2>
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              {treeQuery.data?.rootPath ?? t("projects.workspaceRootPending")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              treeQuery.refetch();
              if (selectedPath) {
                fileQuery.refetch();
              }
            }}
            disabled={!queryEnabled || treeQuery.isFetching || fileQuery.isFetching}
            aria-label={t("projects.workspaceRefresh")}
            title={t("projects.workspaceRefresh")}
          >
            <RefreshCw className={cn("size-4", treeQuery.isFetching && "animate-spin")} />
          </Button>
        </div>
        {treeQuery.data?.truncated ? (
          <Badge variant="secondary" className="w-fit">
            {t("projects.workspaceTruncated")}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 px-4 pt-4">
        {!projectId ? (
          <WorkspaceNotice message={t("projects.workspaceNoProject")} />
        ) : treeQuery.isLoading ? (
          <WorkspaceNotice message={t("projects.workspaceLoading")} />
        ) : treeQuery.isError ? (
          <WorkspaceNotice
            destructive
            message={treeQuery.error instanceof Error ? treeQuery.error.message : t("projects.workspaceLoadFailed")}
          />
        ) : rows.length === 0 ? (
          <WorkspaceNotice message={t("projects.workspaceEmpty")} />
        ) : (
          <div className="max-h-56 overflow-auto rounded-md border border-border/70 bg-background/60 p-1 [scrollbar-width:thin]">
            {rows.map(({ entry, depth }) => (
              <WorkspaceTreeButton
                key={entry.path}
                entry={entry}
                depth={depth}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            ))}
          </div>
        )}

        <div className="rounded-md border border-border/70 bg-background/70">
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
            <div className="min-w-0 text-xs font-medium">
              {selectedPath || t("projects.workspaceSelectFile")}
            </div>
            {selectedFile?.truncated ? (
              <Badge variant="secondary">{t("projects.workspaceTruncated")}</Badge>
            ) : null}
          </div>
          <WorkspaceFilePreview
            content={selectedFile?.content}
            isLoading={fileQuery.isLoading}
            isError={fileQuery.isError}
            isBinary={Boolean(selectedFile?.binary)}
            errorMessage={fileQuery.error instanceof Error ? fileQuery.error.message : undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function WorkspaceTreeButton({
  entry,
  depth,
  selectedPath,
  onSelect,
}: {
  entry: WorkspaceTreeEntry;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const isFile = entry.kind === "file";
  const Icon = isFile ? FileText : Folder;

  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs transition-colors hover:bg-muted/40",
        selectedPath === entry.path && "bg-brand/10 text-brand",
        !isFile && "cursor-default text-muted-foreground"
      )}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => {
        if (isFile) {
          onSelect(entry.path);
        }
      }}
      disabled={!isFile}
      aria-label={entry.path}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate font-mono">{entry.path}</span>
      {entry.sizeBytes !== undefined ? (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatBytes(entry.sizeBytes)}
        </span>
      ) : null}
    </button>
  );
}

function WorkspaceFilePreview({
  content,
  isLoading,
  isError,
  isBinary,
  errorMessage,
}: {
  content?: string;
  isLoading: boolean;
  isError: boolean;
  isBinary: boolean;
  errorMessage?: string;
}) {
  const { t } = useLanguage();

  if (isLoading) {
    return <WorkspaceNotice message={t("projects.workspaceFileLoading")} className="h-48 rounded-none border-0" />;
  }

  if (isError) {
    return (
      <WorkspaceNotice
        destructive
        message={errorMessage ?? t("projects.workspaceFileLoadFailed")}
        className="h-48 rounded-none border-0"
      />
    );
  }

  if (isBinary) {
    return <WorkspaceNotice message={t("projects.workspaceBinaryFile")} className="h-48 rounded-none border-0" />;
  }

  if (!content) {
    return <WorkspaceNotice message={t("projects.workspaceFileEmpty")} className="h-48 rounded-none border-0" />;
  }

  return (
    <pre className="h-48 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground [scrollbar-width:thin]">
      {content}
    </pre>
  );
}

function WorkspaceNotice({
  message,
  destructive = false,
  className,
}: {
  message: string;
  destructive?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-20 items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground",
        destructive && "border-destructive/50 text-destructive",
        className
      )}
    >
      {destructive ? <AlertTriangle className="size-4" /> : null}
      <span>{message}</span>
    </div>
  );
}

function flattenWorkspaceTree(entries: WorkspaceTreeEntry[], depth = 0): WorkspaceTreeRow[] {
  return entries.flatMap((entry) => [
    { entry, depth },
    ...flattenWorkspaceTree(entry.children ?? [], depth + 1),
  ]);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
