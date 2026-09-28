"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getProjectWorkspaceTree } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import { WorkspaceFileViewer } from "./workspace/WorkspaceFileViewer";
import { WorkspaceTree } from "./workspace/WorkspaceTree";

interface WorkspaceContextPanelProps {
  projectId?: string | null;
  className?: string;
  enabled?: boolean;
}

export function WorkspaceContextPanel({
  projectId,
  className,
  enabled = true,
}: WorkspaceContextPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const queryEnabled = Boolean(projectId) && enabled;

  useEffect(() => {
    setSelectedPath(null);
    setViewerOpen(false);
  }, [projectId]);

  // Shares the tree root query so the header can show the project root path
  // and truncated badge without a duplicate request.
  const treeQuery = useQuery({
    queryKey: ["workspace-context", projectId, "tree"],
    queryFn: () => getProjectWorkspaceTree(projectId!, { depth: 1, limit: 500 }),
    enabled: queryEnabled,
    retry: false,
  });

  return (
    <Card
      data-testid="workspace-context-panel"
      className={cn("forgebadger-animate-in gap-0 overflow-hidden py-0", className)}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold leading-none">{t("projects.workspace")}</h2>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {treeQuery.data?.rootPath ?? t("projects.workspaceRootPending")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["workspace-context", projectId] })
          }
          disabled={!queryEnabled}
          aria-label={t("projects.workspaceRefresh")}
          title={t("projects.workspaceRefresh")}
        >
          <RefreshCw className={cn("size-4", treeQuery.isFetching && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        {treeQuery.data?.truncated ? (
          <Badge variant="secondary" className="w-fit">
            {t("projects.workspaceTruncated")}
          </Badge>
        ) : null}
        {!projectId ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {t("projects.workspaceNoProject")}
          </p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-md border border-border/70 bg-background/60 p-1 [scrollbar-width:thin]">
            <WorkspaceTree
              projectId={projectId}
              enabled={queryEnabled}
              compact
              selectedPath={selectedPath}
              onSelectFile={(path) => {
                setSelectedPath(path);
                setViewerOpen(true);
              }}
            />
          </div>
        )}
      </CardContent>

      <Sheet open={viewerOpen} onOpenChange={setViewerOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{selectedPath ?? t("projects.workspace")}</SheetTitle>
          </SheetHeader>
          {projectId ? (
            <WorkspaceFileViewer
              variant="sheet"
              projectId={projectId}
              path={selectedPath}
              enabled={viewerOpen}
              onClose={() => setViewerOpen(false)}
              className="h-full flex-1 rounded-none border-0"
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
