"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Search,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  getProjectWorkspaceTree,
  type WorkspaceTreeEntry,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import { ancestorPaths, filterWorkspaceFiles, formatBytes } from "./utils";

const INDENT_PX = 14;
const BASE_PADDING_PX = 8;
const CHEVRON_SLOT_PX = 18;

interface WorkspaceTreeProps {
  projectId: string;
  enabled?: boolean;
  selectedPath?: string | null;
  onSelectFile: (path: string) => void;
  compact?: boolean;
  className?: string;
}

interface TreeContext {
  projectId: string;
  enabled: boolean;
  compact: boolean;
  expandedPaths: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
}

export function WorkspaceTree({
  projectId,
  enabled = true,
  selectedPath = null,
  onSelectFile,
  compact = false,
  className,
}: WorkspaceTreeProps) {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());

  const treeQuery = useQuery({
    queryKey: ["workspace-context", projectId, "tree"],
    queryFn: () => getProjectWorkspaceTree(projectId, { depth: 1, limit: 500 }),
    enabled,
    retry: false,
  });

  const searchActive = searchTerm.trim().length > 0;
  const searchQuery = useQuery({
    queryKey: ["workspace-context", projectId, "search"],
    queryFn: () => getProjectWorkspaceTree(projectId, { depth: 3, limit: 500 }),
    enabled: enabled && searchActive,
    retry: false,
  });

  const searchResults = useMemo(
    () => (searchActive ? filterWorkspaceFiles(searchQuery.data?.entries ?? [], searchTerm) : []),
    [searchActive, searchQuery.data?.entries, searchTerm]
  );

  const treeContext: TreeContext = {
    projectId,
    enabled,
    compact,
    expandedPaths,
    selectedPath,
    onToggleDirectory: (path) => {
      setExpandedPaths((current) => {
        const next = new Set(current);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    },
    onSelectFile,
  };

  const handleSelectSearchResult = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      ancestorPaths(path).forEach((ancestor) => next.add(ancestor));
      return next;
    });
    setSearchTerm("");
    onSelectFile(path);
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={t("projects.workspaceSearchPlaceholder")}
          aria-label={t("projects.workspaceSearchPlaceholder")}
          className="h-8 pl-8 text-xs"
        />
      </div>

      {searchActive ? (
        searchQuery.isLoading ? (
          <TreeSkeleton compact={compact} />
        ) : searchQuery.isError ? (
          <TreeNotice
            destructive
            message={
              searchQuery.error instanceof Error
                ? searchQuery.error.message
                : t("projects.workspaceLoadFailed")
            }
          />
        ) : searchResults.length === 0 ? (
          <TreeNotice message={t("projects.workspaceSearchNoResults")} />
        ) : (
          <div className="min-w-max">
            {searchResults.map((entry, index) => (
              <SearchResultRow
                key={entry.path}
                entry={entry}
                index={index}
                compact={compact}
                selected={selectedPath === entry.path}
                onSelect={() => handleSelectSearchResult(entry.path)}
              />
            ))}
            {searchQuery.data?.truncated ? <TruncatedNote /> : null}
          </div>
        )
      ) : treeQuery.isLoading ? (
        <TreeSkeleton compact={compact} />
      ) : treeQuery.isError ? (
        <TreeNotice
          destructive
          message={
            treeQuery.error instanceof Error
              ? treeQuery.error.message
              : t("projects.workspaceLoadFailed")
          }
        />
      ) : (treeQuery.data?.entries ?? []).length === 0 ? (
        <TreeNotice message={t("projects.workspaceEmpty")} />
      ) : (
        <div className="min-w-max">
          <TreeNodeList entries={treeQuery.data?.entries ?? []} depth={0} ctx={treeContext} />
          {treeQuery.data?.truncated ? <TruncatedNote /> : null}
        </div>
      )}
    </div>
  );
}

function TreeNodeList({
  entries,
  depth,
  ctx,
}: {
  entries: WorkspaceTreeEntry[];
  depth: number;
  ctx: TreeContext;
}) {
  return (
    <>
      {entries.map((entry, index) => (
        <TreeNode key={entry.path} entry={entry} depth={depth} index={index} ctx={ctx} />
      ))}
    </>
  );
}

function TreeNode({
  entry,
  depth,
  index,
  ctx,
}: {
  entry: WorkspaceTreeEntry;
  depth: number;
  index: number;
  ctx: TreeContext;
}) {
  if (entry.kind === "directory") {
    return <DirectoryNode entry={entry} depth={depth} index={index} ctx={ctx} />;
  }
  if (entry.kind === "file") {
    return <FileNode entry={entry} depth={depth} index={index} ctx={ctx} />;
  }
  return <MutedNode entry={entry} depth={depth} index={index} compact={ctx.compact} />;
}

function DirectoryNode({
  entry,
  depth,
  index,
  ctx,
}: {
  entry: WorkspaceTreeEntry;
  depth: number;
  index: number;
  ctx: TreeContext;
}) {
  const { t } = useLanguage();
  const expanded = ctx.expandedPaths.has(entry.path);
  const childrenQuery = useQuery({
    queryKey: ["workspace-context", ctx.projectId, "tree", entry.path],
    queryFn: () => getProjectWorkspaceTree(ctx.projectId, { path: entry.path, depth: 1 }),
    enabled: ctx.enabled && expanded,
    retry: false,
  });
  const children = childrenQuery.data?.entries ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={() => ctx.onToggleDirectory(entry.path)}
        aria-expanded={expanded}
        title={entry.path}
        className={cn(
          "forgebadger-animate-in flex w-full items-center gap-1 rounded pr-2 text-left transition-colors hover:bg-muted/40",
          ctx.compact ? "h-7 text-[11px]" : "h-8 text-xs"
        )}
        style={{
          paddingLeft: BASE_PADDING_PX + depth * INDENT_PX,
          animationDelay: `${Math.min(index, 10) * 20}ms`,
        }}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
        {expanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-brand/80" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 whitespace-nowrap font-mono">{entry.name}</span>
        {childrenQuery.isFetching ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </button>
      <div className="forgebadger-collapse-grid" data-open={expanded}>
        <div>
          <div
            className="border-l border-border/50"
            style={{ marginLeft: BASE_PADDING_PX + depth * INDENT_PX + 6 }}
          >
            {expanded && childrenQuery.isLoading ? (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">
                {t("projects.workspaceLoading")}
              </div>
            ) : expanded && childrenQuery.isError ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5 shrink-0" />
                {t("projects.workspaceLoadFailed")}
              </div>
            ) : childrenQuery.data ? (
              <>
                <TreeNodeList entries={children} depth={depth + 1} ctx={ctx} />
                {childrenQuery.data.truncated ? <TruncatedNote /> : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function FileNode({
  entry,
  depth,
  index,
  ctx,
}: {
  entry: WorkspaceTreeEntry;
  depth: number;
  index: number;
  ctx: TreeContext;
}) {
  const { t } = useLanguage();
  const selected = ctx.selectedPath === entry.path;

  return (
    <button
      type="button"
      onClick={() => ctx.onSelectFile(entry.path)}
      aria-current={selected ? "true" : undefined}
      title={ctx.compact ? t("projects.workspaceOpenViewer") : entry.path}
      className={cn(
        "forgebadger-animate-in flex w-full items-center gap-1.5 rounded pr-2 text-left transition-colors hover:bg-muted/40",
        ctx.compact ? "h-7 text-[11px]" : "h-8 text-xs",
        selected ? "bg-brand/10 text-brand" : "text-foreground/90"
      )}
      style={{
        paddingLeft: BASE_PADDING_PX + depth * INDENT_PX + CHEVRON_SLOT_PX,
        animationDelay: `${Math.min(index, 10) * 20}ms`,
      }}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 whitespace-nowrap font-mono">{entry.name}</span>
      {entry.sizeBytes !== undefined ? (
        <span className="shrink-0 pr-1 text-[10px] text-muted-foreground">
          {formatBytes(entry.sizeBytes)}
        </span>
      ) : null}
    </button>
  );
}

function MutedNode({
  entry,
  depth,
  index,
  compact,
}: {
  entry: WorkspaceTreeEntry;
  depth: number;
  index: number;
  compact: boolean;
}) {
  return (
    <div
      title={entry.path}
      className={cn(
        "forgebadger-animate-in flex w-full items-center gap-1.5 rounded pr-2 text-muted-foreground/70",
        compact ? "h-7 text-[11px]" : "h-8 text-xs"
      )}
      style={{
        paddingLeft: BASE_PADDING_PX + depth * INDENT_PX + CHEVRON_SLOT_PX,
        animationDelay: `${Math.min(index, 10) * 20}ms`,
      }}
    >
      <FileText className="size-3.5 shrink-0 opacity-50" />
      <span className="flex-1 whitespace-nowrap font-mono">{entry.name}</span>
    </div>
  );
}

function SearchResultRow({
  entry,
  index,
  compact,
  selected,
  onSelect,
}: {
  entry: WorkspaceTreeEntry;
  index: number;
  compact: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const separatorIndex = entry.path.lastIndexOf("/");
  const directory = separatorIndex >= 0 ? entry.path.slice(0, separatorIndex + 1) : "";

  return (
    <button
      type="button"
      onClick={onSelect}
      title={entry.path}
      className={cn(
        "forgebadger-animate-in flex w-full items-center gap-1.5 rounded px-2 text-left transition-colors hover:bg-muted/40",
        compact ? "h-7 text-[11px]" : "h-8 text-xs",
        selected && "bg-brand/10 text-brand"
      )}
      style={{ animationDelay: `${Math.min(index, 10) * 20}ms` }}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 whitespace-nowrap font-mono">
        {directory ? <span className="text-muted-foreground">{directory}</span> : null}
        <span className="text-foreground">{entry.name}</span>
      </span>
      {entry.sizeBytes !== undefined ? (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatBytes(entry.sizeBytes)}
        </span>
      ) : null}
    </button>
  );
}

function TreeSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className="space-y-1 px-1 py-1" aria-hidden="true">
      {[92, 76, 84, 64, 80, 56].map((width, index) => (
        <div
          key={index}
          className={cn("animate-pulse rounded bg-muted/50", compact ? "h-6" : "h-7")}
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

function TreeNotice({ message, destructive = false }: { message: string; destructive?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-20 items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground",
        destructive && "border-destructive/50 text-destructive"
      )}
    >
      {destructive ? <AlertTriangle className="size-4" /> : null}
      <span>{message}</span>
    </div>
  );
}

function TruncatedNote() {
  const { t } = useLanguage();
  return (
    <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
      {t("projects.workspaceTreeTruncated")}
    </p>
  );
}
