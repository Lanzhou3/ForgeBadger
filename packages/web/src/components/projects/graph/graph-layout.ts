/**
 * Deterministic layered layout for the project graph canvas.
 *
 * Nodes are assigned to layers by the longest-path over edge direction
 * (sources upstream, targets downstream); cycles fall back gracefully since
 * layer(node) = max(layer(source) + 1) converges once every node has a slot.
 * Within a layer, nodes keep insertion order (stable across re-renders).
 */

export interface LayoutInputNode {
  id: string;
}

export interface LayoutInputEdge {
  source: string;
  target: string;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

export const GRAPH_NODE_WIDTH = 168;
export const GRAPH_NODE_HEIGHT = 52;

const LAYER_SPACING_X = 240;
const LAYER_SPACING_Y = 76;

export function computeLayeredLayout(
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[]
): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();
  if (nodes.length === 0) return positions;

  const ids = new Set(nodes.map((node) => node.id));
  const layer = new Map<string, number>();
  for (const id of ids) layer.set(id, 0);

  // Longest-path layering with bounded relaxation passes (cycle-safe).
  const passes = Math.min(ids.size + 1, 32);
  for (let pass = 0; pass < passes; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
      const next = (layer.get(edge.source) ?? 0) + 1;
      if (edge.target !== edge.source && next > (layer.get(edge.target) ?? 0)) {
        layer.set(edge.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group into layers preserving node order within each layer.
  const layers = new Map<number, string[]>();
  for (const node of nodes) {
    const depth = layer.get(node.id) ?? 0;
    const bucket = layers.get(depth);
    if (bucket) bucket.push(node.id);
    else layers.set(depth, [node.id]);
  }

  const sortedDepths = [...layers.keys()].sort((a, b) => a - b);
  sortedDepths.forEach((depth, columnIndex) => {
    const members = layers.get(depth) ?? [];
    members.forEach((id, rowIndex) => {
      positions.set(id, {
        x: columnIndex * LAYER_SPACING_X,
        y: rowIndex * LAYER_SPACING_Y
      });
    });
  });

  return positions;
}
