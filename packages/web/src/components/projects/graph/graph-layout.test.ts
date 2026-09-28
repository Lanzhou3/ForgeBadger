import { describe, expect, it } from "vitest";

import { computeLayeredLayout } from "./graph-layout";

describe("computeLayeredLayout", () => {
  it("places sources upstream of targets in layered order", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" }
    ];

    const positions = computeLayeredLayout(nodes, edges);

    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
    expect(positions.get("b")!.x).toBeLessThan(positions.get("c")!.x);
  });

  it("is cycle-safe and terminates", () => {
    const nodes = [{ id: "a" }, { id: "b" }];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "a" }
    ];

    const positions = computeLayeredLayout(nodes, edges);
    expect(positions.size).toBe(2);
  });

  it("keeps disconnected nodes without position collisions", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [{ source: "a", target: "b" }];

    const positions = computeLayeredLayout(nodes, edges);

    // a,c land in layer 0; b is pushed to layer 1 by the a->b edge.
    expect(positions.get("a")!.x).toBe(0);
    expect(positions.get("c")!.x).toBe(0);
    expect(positions.get("b")!.x).toBeGreaterThan(0);
    const keys = new Set([...positions.values()].map((p) => `${p.x}:${p.y}`));
    expect(keys.size).toBe(3);
  });

  it("returns an empty map for empty input", () => {
    expect(computeLayeredLayout([], []).size).toBe(0);
  });
});
