"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderTree, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";
import { WorkspaceTree } from "./WorkspaceTree";

interface WorkspaceExplorerProps {
  projectId?: string | null;
  enabled?: boolean;
  className?: string;
}

export function WorkspaceExplorer({
  projectId,
  enabled = true,
  className,
}: WorkspaceExplorerProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPath(null);
  }, [projectId]);

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
          <Button
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
        </CardHeader>
        <CardContent className="px-2 py-2">
          <div className="max-h-[320px] overflow-auto [scrollbar-width:thin] lg:max-h-[calc(100vh-15rem)]">
            <WorkspaceTree
              projectId={projectId}
              enabled={queryEnabled}
              selectedPath={selectedPath}
              onSelectFile={setSelectedPath}
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
            className="h-[420px] lg:h-[calc(100vh-15.5rem)]"
          />
        </CardContent>
      </Card>
    </div>
  );
}
