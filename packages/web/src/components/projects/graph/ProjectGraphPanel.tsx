"use client";

import { useMemo, useState, type ReactNode } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Boxes,
  FileCode,
  GitCompare,
  GitFork,
  Network,
  TerminalSquare
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLanguage } from "@/hooks/use-language";
import {
  getProjectGitChanges,
  getProjectGraphAffected,
  getProjectGraphFileGraph,
  getProjectGraphImpact,
  getProjectGraphOverview,
  getProjectGraphSymbolDetail,
  type GraphSymbolRef
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { WorkspaceFileViewer } from "@/components/projects/workspace/WorkspaceFileViewer";

import { GraphCanvas, type GraphCanvasEdge, type GraphCanvasNode } from "./GraphCanvas";
import { SymbolSearchBox } from "./SymbolSearchBox";

export interface ProjectGraphPanelProps {
  projectId: string;
  enabled: boolean;
}

interface SourceViewerRequest {
  path: string;
  line?: number;
}

const FILE_GRAPH_LIMIT = 120;

type PanelMode = "files" | "affected";

export function ProjectGraphPanel({ projectId, enabled }: ProjectGraphPanelProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<PanelMode>("files");
  const [selectedSymbol, setSelectedSymbol] = useState<GraphSymbolRef | null>(null);
  const [sourceViewer, setSourceViewer] = useState<SourceViewerRequest | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["project-graph", "overview", projectId],
    queryFn: () => getProjectGraphOverview(projectId),
    enabled,
  });

  const fileGraphQuery = useQuery({
    queryKey: ["project-graph", "file-graph", projectId],
    queryFn: () => getProjectGraphFileGraph(projectId, FILE_GRAPH_LIMIT),
    enabled: enabled && (overviewQuery.data?.available ?? false),
  });

  const detailQuery = useQuery({
    queryKey: ["project-graph", "symbol", projectId, selectedSymbol?.id],
    queryFn: () => getProjectGraphSymbolDetail(projectId, selectedSymbol?.id ?? ""),
    enabled: enabled && !!selectedSymbol,
  });

  const impactQuery = useQuery({
    queryKey: ["project-graph", "impact", projectId, selectedSymbol?.id],
    queryFn: () => getProjectGraphImpact(projectId, selectedSymbol?.id ?? "", 2),
    enabled: enabled && !!selectedSymbol,
  });

  if (!enabled || overviewQuery.isLoading || (!overviewQuery.data && overviewQuery.isPending)) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-20 animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
        <div className="h-[460px] animate-pulse rounded-lg bg-muted/60" />
      </div>
    );
  }

  if (overviewQuery.isError) {
    return <UnavailableCard message={t("projects.graphUnavailable")} />;
  }

  const overview = overviewQuery.data;
  if (!overview?.available) {
    return (
      <SetupGuidanceCard reason={overview && !overview.available ? overview.reason : "error"} />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<FileCode className="size-4 text-brand" />}
          label={t("projects.graphFiles")}
          value={String(overview.files.total)}
        />
        <StatCard
          icon={<Boxes className="size-4 text-emerald-400" />}
          label={t("projects.graphSymbols")}
          value={String(overview.nodes.total)}
        />
        <StatCard
          icon={<GitFork className="size-4 text-sky-400" />}
          label={t("projects.graphRelations")}
          value={String(overview.edges.total)}
        />
        <StatCard
          icon={<TerminalSquare className="size-4 text-violet-400" />}
          label={t("projects.graphIndexState")}
          value={overview.indexState ?? "-"}
        />
      </div>

      {!selectedSymbol && (
        <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <ModeButton
            active={mode === "files"}
            onClick={() => setMode("files")}
            label={t("projects.graphViewFiles")}
          />
          <ModeButton
            active={mode === "affected"}
            onClick={() => setMode("affected")}
            label={t("projects.graphViewAffected")}
          />
        </div>
      )}

      {selectedSymbol ? (
        <SymbolNeighborhoodView
          symbol={selectedSymbol}
          detail={detailQuery.data ?? null}
          impact={impactQuery.data ?? null}
          impactLoading={impactQuery.isPending}
          onBack={() => setSelectedSymbol(null)}
          onOpenSource={setSourceViewer}
        />
      ) : mode === "affected" ? (
        <AffectedView
          projectId={projectId}
          enabled={enabled}
          onOpenSource={setSourceViewer}
          onBack={() => setMode("files")}
        />
      ) : (
        <FileGraphView
          projectId={projectId}
          enabled={enabled}
          fileGraph={fileGraphQuery.data ?? null}
          onSelectSymbol={setSelectedSymbol}
          onOpenSource={setSourceViewer}
        />
      )}

      <Sheet open={!!sourceViewer} onOpenChange={(open) => { if (!open) setSourceViewer(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>{sourceViewer?.path ?? t("projects.workspace")}</SheetTitle>
          </SheetHeader>
          {sourceViewer && (
            <WorkspaceFileViewer
              variant="sheet"
              projectId={projectId}
              path={sourceViewer.path}
              enabled
              focusLine={sourceViewer.line ?? null}
              onClose={() => setSourceViewer(null)}
              className="h-full flex-1 rounded-none border-0"
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ModeButton({
  active,
  onClick,
  label
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function UnavailableCard({ message }: { message: string }) {
  return (
    <Card className="border-dashed py-0">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Network className="size-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function SetupGuidanceCard({ reason }: { reason: string }) {
  const { t } = useLanguage();
  return (
    <Card className="border-dashed py-0">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
          <Network className="size-6 text-muted-foreground" />
        </div>
        <div className="max-w-md space-y-1.5">
          <p className="text-sm font-medium">{t("projects.graphNotInitTitle")}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {reason === "schema_unsupported"
              ? t("projects.graphSchemaUnsupported")
              : t("projects.graphNotInitDesc")}
          </p>
        </div>
        <div className="flex w-full max-w-sm items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <code className="flex-1 truncate text-left font-mono text-xs">codegraph init .</code>
          <Badge variant="outline" className="shrink-0 font-mono text-[10px]">CLI</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

interface FileGraphViewProps {
  projectId: string;
  enabled: boolean;
  fileGraph: Awaited<ReturnType<typeof getProjectGraphFileGraph>> | null;
  onSelectSymbol: (symbol: GraphSymbolRef) => void;
  onOpenSource?: (target: { path: string; line?: number }) => void;
}

function FileGraphView({
  projectId,
  enabled,
  fileGraph,
  onSelectSymbol,
  onOpenSource
}: FileGraphViewProps) {
  const { t } = useLanguage();
  const [activeKinds, setActiveKinds] = useState<Set<string>>(new Set());

  const availableKinds = useMemo(() => {
    if (!fileGraph?.available) return [];
    const kinds = new Set<string>();
    for (const edge of fileGraph.edges) {
      for (const kind of Object.keys(edge.kinds)) kinds.add(kind);
    }
    return [...kinds].sort();
  }, [fileGraph]);

  const canvasNodes = useMemo<GraphCanvasNode[]>(() => {
    if (!fileGraph?.available) return [];
    return fileGraph.nodes.map((node) => ({
      id: node.path,
      label: node.path.split("/").pop() ?? node.path,
      sublabel: node.path,
      kind: "file"
    }));
  }, [fileGraph]);

  const canvasEdges = useMemo<GraphCanvasEdge[]>(() => {
    if (!fileGraph?.available) return [];
    return fileGraph.edges
      .filter((edge) =>
        activeKinds.size === 0 || Object.keys(edge.kinds).some((kind) => activeKinds.has(kind))
      )
      .map((edge) => {
        const dominantKind =
          Object.entries(edge.kinds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "imports";
        return {
          id: `${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          kind: dominantKind
        };
      });
  }, [fileGraph, activeKinds]);

  const toggleKind = (kind: string) => {
    setActiveKinds((previous) => {
      const next = new Set(previous);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SymbolSearchBox projectId={projectId} enabled={enabled} onSelect={onSelectSymbol} />
        <div className="flex flex-wrap items-center gap-1.5">
          {availableKinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                activeKinds.has(kind)
                  ? "border-brand/60 bg-brand/10 text-brand"
                  : "border-border text-muted-foreground hover:border-ring/50"
              )}
            >
              {kind}
            </button>
          ))}
          {fileGraph?.available && fileGraph.truncated && (
            <span className="text-xs text-muted-foreground">{t("projects.graphTruncated")}</span>
          )}
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t("projects.graphHint")}</p>
      <GraphCanvas nodes={canvasNodes} edges={canvasEdges} onNodeClick={(nodeId) => onOpenSource?.({ path: nodeId })} />
    </div>
  );
}

interface AffectedViewProps {
  projectId: string;
  enabled: boolean;
  onOpenSource?: (target: { path: string; line?: number }) => void;
  onBack: () => void;
}

interface AffectedAnalysis {
  changedFiles: Array<{ path: string; status: string }>;
  result: Awaited<ReturnType<typeof getProjectGraphAffected>>;
}

function AffectedView({ projectId, enabled, onOpenSource, onBack }: AffectedViewProps) {
  const { t } = useLanguage();
  const [analysis, setAnalysis] = useState<AffectedAnalysis | null>(null);

  const gitQuery = useQuery({
    queryKey: ["project-graph", "git-changes", projectId],
    queryFn: () => getProjectGitChanges(projectId),
    enabled,
  });

  const changedFiles = useMemo(() => {
    const git = gitQuery.data;
    if (!git?.isGitRepo) return [];
    return git.changed.map((entry) => ({ path: entry.path, status: entry.status }));
  }, [gitQuery.data]);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const paths = changedFiles.map((entry) => entry.path);
      if (paths.length === 0) throw new Error(t("projects.graphAffectedNoChanges"));
      const [result] = await Promise.all([
        getProjectGraphAffected(projectId, paths.slice(0, 50), 2)
      ]);
      return { changedFiles, result } satisfies AffectedAnalysis;
    },
    onSuccess: setAnalysis,
  });

  const canvasNodes = useMemo<GraphCanvasNode[]>(() => {
    if (!analysis || !analysis.result.available) return [];
    return analysis.result.nodes.map((node) => ({
      id: node.id,
      label: node.name,
      sublabel: `${node.filePath}:${node.startLine}`,
      kind: node.kind,
      depth: node.depth > 0 ? node.depth : undefined,
      impacted: node.depth === 0,
      sourcePath: node.filePath,
      sourceLine: node.startLine
    }));
  }, [analysis]);

  const canvasEdges = useMemo<GraphCanvasEdge[]>(() => {
    if (!analysis || !analysis.result.available) return [];
    return analysis.result.edges.map((edge) => ({
      id: `${edge.source}->${edge.target}->${edge.kind}`,
      source: edge.source,
      target: edge.target,
      kind: edge.kind
    }));
  }, [analysis]);

  const summary = analysis?.result;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 size-4" />
          {t("projects.graphBackToFiles")}
        </Button>
        <Button
          size="sm"
          className="bg-brand text-brand-foreground hover:bg-brand/90"
          disabled={!enabled || gitQuery.isPending || changedFiles.length === 0 || analyzeMutation.isPending}
          onClick={() => analyzeMutation.mutate()}
        >
          <GitCompare className="mr-1.5 size-4" />
          {analyzeMutation.isPending ? t("projects.graphAffectedAnalyzing") : t("projects.graphAffectedAnalyze")}
        </Button>
      </div>

      {!gitQuery.data ? (
        <p className="text-xs text-muted-foreground">{t("projects.graphAffectedLoadingGit")}</p>
      ) : !gitQuery.data.isGitRepo ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          {t("projects.graphAffectedNoGit")}
        </p>
      ) : changedFiles.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          {t("projects.graphAffectedNoChanges")}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {changedFiles.length} {t("projects.graphAffectedChangedCount")}
          {summary?.available ? (
            <>
              {" · "}
              {summary.seededSymbols} {t("projects.graphAffectedSeeded")}
              {" · "}
              {summary.nodes.length} {t("projects.graphAffectedTouched")}
            </>
          ) : null}
        </p>
      )}

      {analyzeMutation.isError && (
        <p className="text-sm text-destructive">
          {analyzeMutation.error instanceof Error ? analyzeMutation.error.message : ""}
        </p>
      )}

      {canvasNodes.length > 0 && (
        <GraphCanvas
          nodes={canvasNodes}
          edges={canvasEdges}
          onNodeClick={(nodeId) => {
            const node = canvasNodes.find((candidate) => candidate.id === nodeId);
            if (node?.sourcePath) {
              onOpenSource?.({ path: node.sourcePath, line: node.sourceLine });
            }
          }}
        />
      )}
      {summary?.available && summary.truncated && (
        <p className="text-xs text-muted-foreground">{t("projects.graphTruncated")}</p>
      )}
    </div>
  );
}

interface SymbolNeighborhoodViewProps {
  symbol: GraphSymbolRef;
  detail: Awaited<ReturnType<typeof getProjectGraphSymbolDetail>> | null;
  impact: Awaited<ReturnType<typeof getProjectGraphImpact>> | null;
  impactLoading: boolean;
  onBack: () => void;
  onOpenSource?: (target: { path: string; line?: number }) => void;
}

function SymbolNeighborhoodView({
  symbol,
  detail,
  impact,
  impactLoading,
  onBack,
  onOpenSource,
}: SymbolNeighborhoodViewProps) {
  const { t } = useLanguage();

  const impactedIds = useMemo(() => {
    if (!impact?.available) return new Set<string>();
    return new Set(impact.nodes.map((node) => node.id));
  }, [impact]);

  const canvasNodes = useMemo<GraphCanvasNode[]>(() => {
    if (!detail?.available) return [];
    const seen = new Set<string>([detail.symbol.id]);
    const nodes: GraphCanvasNode[] = [
      {
        id: detail.symbol.id,
        label: detail.symbol.name,
        sublabel: `${detail.symbol.kind} · ${detail.symbol.filePath}`,
        kind: detail.symbol.kind,
        impacted: impactedIds.has(detail.symbol.id),
        sourcePath: detail.symbol.filePath,
        sourceLine: detail.symbol.startLine
      }
    ];
    for (const caller of detail.callers) {
      if (seen.has(caller.id)) continue;
      seen.add(caller.id);
      nodes.push({
        id: caller.id,
        label: caller.name,
        sublabel: caller.filePath,
        kind: caller.kind,
        impacted: impactedIds.has(caller.id),
        sourcePath: caller.filePath,
        sourceLine: caller.startLine
      });
    }
    for (const callee of detail.callees) {
      if (seen.has(callee.id)) continue;
      seen.add(callee.id);
      nodes.push({
        id: callee.id,
        label: callee.name,
        sublabel: callee.filePath,
        kind: callee.kind,
        sourcePath: callee.filePath,
        sourceLine: callee.startLine
      });
    }
    return nodes;
  }, [detail, impactedIds]);

  const canvasEdges = useMemo<GraphCanvasEdge[]>(() => {
    if (!detail?.available) return [];
    const edges: GraphCanvasEdge[] = [];
    for (const caller of detail.callers) {
      edges.push({
        id: `in-${caller.id}`,
        source: caller.id,
        target: detail.symbol.id,
        kind: caller.edgeKind
      });
    }
    for (const callee of detail.callees) {
      edges.push({
        id: `out-${callee.id}`,
        source: detail.symbol.id,
        target: callee.id,
        kind: callee.edgeKind
      });
    }
    return edges;
  }, [detail]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 size-4" />
          {t("projects.graphBackToFiles")}
        </Button>
        <div className="flex items-center gap-2">
          {impactLoading ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {t("projects.graphImpact")}…
            </Badge>
          ) : impact?.available ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {t("projects.graphImpact")} · {impact.nodes.length}
            </Badge>
          ) : null}
        </div>
      </div>
      <GraphCanvas
        nodes={canvasNodes}
        edges={canvasEdges}
        onNodeClick={(nodeId) => {
          const node = canvasNodes.find((candidate) => candidate.id === nodeId);
          if (node?.sourcePath) {
            onOpenSource?.({ path: node.sourcePath, line: node.sourceLine });
          }
        }}
      />
      {detail?.available && (
        <Card className="py-0">
          <CardContent className="grid gap-2 px-4 py-3 sm:grid-cols-3">
            <DetailItem label={t("projects.graphSymbols")} value={detail.symbol.name} />
            <DetailItem
              label={t("projects.graphCallers")}
              value={String(detail.callers.length)}
            />
            <DetailItem
              label={t("projects.graphCallees")}
              value={String(detail.callees.length)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-sm">{value}</p>
    </div>
  );
}
