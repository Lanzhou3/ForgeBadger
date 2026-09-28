// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { edgeVisualStyle, GraphCanvas, type GraphCanvasNode } from "./GraphCanvas";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const globalScope = globalThis as unknown as Record<string, unknown>;
globalScope.ResizeObserver = globalScope.ResizeObserver ?? ResizeObserverStub;
globalScope.DOMMatrixReadOnly =
  globalScope.DOMMatrixReadOnly ??
  class {
    m22 = 1;
    scale = () => this;
    translate = () => this;
  };

const nodes: GraphCanvasNode[] = [
  { id: "src/a.ts", label: "a.ts", kind: "file" },
  { id: "src/b.ts", label: "b.ts", kind: "file" }
];
const edges = [{ id: "e1", source: "src/a.ts", target: "src/b.ts", kind: "imports" }];

describe("GraphCanvas node clicks", () => {
  it("fires onNodeClick when a rendered node is clicked", () => {
    const onNodeClick = vi.fn();
    const utils = render(<GraphCanvas nodes={nodes} edges={edges} onNodeClick={onNodeClick} />);

    const domNodes = utils.container.querySelectorAll(".react-flow__node");
    expect(domNodes.length).toBe(2);
    // Clickable nodes advertise the pointer affordance.
    expect(domNodes[0]!.innerHTML).toContain("cursor-pointer");

    fireEvent.click(domNodes[0]!);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith("src/a.ts");
    cleanup();
  });

  it("does not mark nodes clickable when no handler is wired", () => {
    const utils = render(<GraphCanvas nodes={nodes} edges={edges} />);
    const domNodes = utils.container.querySelectorAll(".react-flow__node");
    expect(domNodes[0]!.innerHTML).not.toContain("cursor-pointer");
    cleanup();
  });

  it("highlights the selected node, its neighbors and their edges; dims the rest", () => {
    const onNodeClick = vi.fn();
    const utils = render(<GraphCanvas nodes={nodes} edges={edges} onNodeClick={onNodeClick} />);
    const domNodes = () => utils.container.querySelectorAll(".react-flow__node");

    // Click src/a.ts (source of the only edge).
    fireEvent.click(domNodes()[0]!);

    // Selected node carries the focus ring; neighbor stays emphasized;
    // unrelated nodes dim (none in this two-node fixture — covered below).
    expect(domNodes()[0]!.innerHTML).toContain("ring-brand/40");
    expect(domNodes()[1]!.innerHTML).not.toContain("opacity-30");

    // Re-click toggles focus off: no selection ring, no dimming anywhere.
    fireEvent.click(domNodes()[0]!);
    expect(domNodes()[0]!.innerHTML).not.toContain("ring-brand/40");
    expect(domNodes()[1]!.innerHTML).not.toContain("opacity-30");
    cleanup();
  });

  it("dims unrelated nodes while a node is focused", () => {
    const threeNodes: GraphCanvasNode[] = [
      ...nodes,
      { id: "src/c.ts", label: "c.ts", kind: "file" }
    ];
    const onNodeClick = vi.fn();
    const utils = render(<GraphCanvas nodes={threeNodes} edges={edges} onNodeClick={onNodeClick} />);

    fireEvent.click(utils.container.querySelectorAll(".react-flow__node")[0]!);

    const domNodes = utils.container.querySelectorAll(".react-flow__node");
    expect(domNodes[1]!.innerHTML).not.toContain("opacity-30"); // direct neighbor
    expect(domNodes[2]!.innerHTML).toContain("opacity-30"); // unrelated
    cleanup();
  });

  it("styles edges by relation to the focused node", () => {
    // Connected edge: brand stroke, thicker, raised.
    const connected = edgeVisualStyle("a", "a", "b");
    expect(connected.style.stroke).toBe("hsl(var(--brand))");
    expect(connected.style.strokeWidth).toBe(2);
    expect(connected.zIndex).toBe(10);

    // Unrelated edge while a focus exists: dimmed.
    const dimmed = edgeVisualStyle("a", "c", "d");
    expect(dimmed.style.opacity).toBe(0.15);

    // No focus: neutral base style.
    const neutral = edgeVisualStyle(null, "a", "b");
    expect(neutral.style.stroke).toBe("hsl(var(--border))");
    expect(neutral.style.opacity).toBeUndefined();
    cleanup();
  });

  it("clears focus when the pane background is clicked", () => {
    const utils = render(<GraphCanvas nodes={nodes} edges={edges} onNodeClick={vi.fn()} />);
    const domNodes = () => utils.container.querySelectorAll(".react-flow__node");

    fireEvent.click(domNodes()[0]!);
    expect(domNodes()[0]!.innerHTML).toContain("ring-brand/40");

    fireEvent.click(utils.container.querySelector(".react-flow__pane")!);
    expect(domNodes()[0]!.innerHTML).not.toContain("ring-brand/40");
    cleanup();
  });
});
