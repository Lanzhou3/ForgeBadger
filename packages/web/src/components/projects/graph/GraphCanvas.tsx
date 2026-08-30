"use client";

import { useMemo, useState } from "react";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { cn } from "@/lib/utils";

import { computeLayeredLayout, GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH } from "./graph-layout";

export interface GraphCanvasNode extends Record<string, unknown> {
  id: string;
  label: string;
  sublabel?: string;
  kind: string;
  /** BFS depth from the selected root (symbol neighborhood view). */
  depth?: number;
  /** Marks nodes inside the computed impact set. */
  impacted?: boolean;
  /** Optional source location for "view source" hand-off. */
  sourcePath?: string;
  sourceLine?: number;
  /** Shows the pointer cursor; set by GraphCanvas when clicks are wired. */
  clickable?: boolean;
  /** The currently focused node. */
  selected?: boolean;
  /** Directly connected to the focused node. */
  related?: boolean;
  /** Not part of the focused node's immediate relations. */
  dimmed?: boolean;
}

export interface GraphCanvasEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}

export interface GraphCanvasProps {
  nodes: GraphCanvasNode[];
  edges: GraphCanvasEdge[];
  onNodeClick?: (nodeId: string) => void;
  className?: string;
}

const BASE_EDGE_STYLE = { stroke: "hsl(var(--border))", strokeWidth: 1 };

/**
 * Visual state of one edge relative to the focused node. Pure function so the
 * highlight rules stay unit-testable (React Flow does not render edge paths
 * without real layout measurements).
 */
export function edgeVisualStyle(
  activeId: string | null,
  source: string,
  target: string
): {
  style: { stroke: string; strokeWidth: number; opacity?: number };
  markerEnd: { type: "arrowclosed"; color: string };
  zIndex?: number;
} {
  const connected = !!activeId && (source === activeId || target === activeId);
  if (connected) {
    return {
      style: { stroke: "hsl(var(--brand))", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--brand))" },
      zIndex: 10
    };
  }
  const dimmed = !!activeId;
  return {
    style: dimmed ? { ...BASE_EDGE_STYLE, opacity: 0.15 } : BASE_EDGE_STYLE,
    markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--muted-foreground))" },
    ...(dimmed ? {} : { zIndex: undefined })
  };
}

const KIND_ACCENT: Record<string, string> = {
  file: "text-muted-foreground",
  function: "text-emerald-400",
  method: "text-emerald-300",
  class: "text-sky-400",
  interface: "text-cyan-400",
  type_alias: "text-teal-300",
  route: "text-violet-400",
  component: "text-pink-400",
  constant: "text-amber-400",
  import: "text-muted-foreground/70"
};

type FlowNode = Node<GraphCanvasNode>;

function GraphNodeCard({ data }: NodeProps<FlowNode>) {
  const node = data;
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-center rounded-md border bg-card px-2.5 py-1.5 text-left shadow-sm transition-all",
        node.dimmed && "opacity-30",
        node.selected
          ? "border-brand bg-brand/10 ring-[3px] ring-brand/40"
          : node.impacted
            ? "border-brand ring-[3px] ring-ring/40"
            : node.related
              ? "border-ring"
              : "border-border hover:border-ring/60",
        node.clickable && "cursor-pointer hover:border-brand"
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-none !bg-border" />
      <span className="truncate font-mono text-xs font-medium leading-tight">
        <span className={cn("mr-1", KIND_ACCENT[node.kind] ?? "text-muted-foreground")}>●</span>
        {node.label}
      </span>
      {node.sublabel && (
        <span className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
          {node.depth !== undefined ? `d${node.depth} · ` : ""}
          {node.sublabel}
        </span>
      )}
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-none !bg-border" />
    </div>
  );
}

const nodeTypes = { graphNode: GraphNodeCard };

export function GraphCanvas({ nodes, edges, onNodeClick, className }: GraphCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Selection survives data refreshes only while the node still exists.
  const activeId = useMemo(() => {
    if (!selectedId) return null;
    return nodes.some((node) => node.id === selectedId) ? selectedId : null;
  }, [selectedId, nodes]);

  // Immediate relations of the focused node (either direction).
  const relatedIds = useMemo(() => {
    const neighbors = new Set<string>();
    if (!activeId) return neighbors;
    for (const edge of edges) {
      if (edge.source === activeId) neighbors.add(edge.target);
      else if (edge.target === activeId) neighbors.add(edge.source);
    }
    return neighbors;
  }, [activeId, edges]);

  const layoutNodes = useMemo<FlowNode[]>(
    () => {
      const positions = computeLayeredLayout(nodes, edges);
      return nodes.map((node) => ({
        id: node.id,
        type: "graphNode" as const,
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        width: GRAPH_NODE_WIDTH,
        height: GRAPH_NODE_HEIGHT,
        data: {
          ...node,
          clickable: !!onNodeClick || undefined,
          selected: node.id === activeId || undefined,
          related: relatedIds.has(node.id) || undefined,
          dimmed: (!!activeId && node.id !== activeId && !relatedIds.has(node.id)) || undefined
        },
        style: { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT }
      }));
    },
    [nodes, edges, onNodeClick, activeId, relatedIds]
  );

  const layoutEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: false,
        ...edgeVisualStyle(activeId, edge.source, edge.target)
      })),
    [edges, activeId]
  );

  const handleNodeClick = (nodeId: string) => {
    // Re-click toggles focus off; clicking the pane clears it too.
    setSelectedId((previous) => (previous === nodeId ? null : nodeId));
    onNodeClick?.(nodeId);
  };

  return (
    <div
      className={cn(
        "h-[460px] overflow-hidden rounded-lg border border-border bg-background",
        // React Flow ships light-theme control buttons; re-point its CSS
        // variables at theme tokens so the zoom controls follow dark/light.
        "[--xy-controls-button-background-color:hsl(var(--card))] [--xy-controls-button-background-color-hover:hsl(var(--muted))]",
        "[--xy-controls-button-border-color:hsl(var(--border))]",
        "[--xy-controls-button-color:hsl(var(--muted-foreground))] [--xy-controls-button-color-hover:hsl(var(--foreground))]",
        "[--xy-controls-box-shadow:0_1px_4px_rgb(0_0_0/0.35)]",
        className
      )}
    >
      <ReactFlow
        nodes={layoutNodes}
        edges={layoutEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable={!onNodeClick}
        onNodeClick={(_, node) => handleNodeClick(node.id)}
        onPaneClick={() => setSelectedId(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="hsl(var(--border))" />
        <Controls showInteractive={false} className="!rounded-md !border !border-border" />
      </ReactFlow>
    </div>
  );
}
