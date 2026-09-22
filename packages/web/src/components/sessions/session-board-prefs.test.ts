import { describe, expect, it } from "vitest";

import type { SessionBoardColumnData } from "./session-board-utils";
import {
  applyColumnOrder,
  clampColumnWidth,
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveColumnKey,
  normalizeBoardView,
  normalizeColumnOrder,
  normalizeColumnWidth,
} from "./session-board-prefs";

function column(key: string, unlinked = false): SessionBoardColumnData {
  return {
    key,
    projectId: unlinked ? null : key,
    projectName: key,
    sessions: [],
    runningCount: 0,
    totalCount: 0,
    lastActivity: 0,
    unlinked,
  };
}

describe("clampColumnWidth", () => {
  it("clamps to the supported range and rounds", () => {
    expect(clampColumnWidth(100)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(260)).toBe(260);
    expect(clampColumnWidth(300.6)).toBe(301);
    expect(clampColumnWidth(9999)).toBe(MAX_COLUMN_WIDTH);
  });

  it("falls back to the default for non-finite values", () => {
    expect(clampColumnWidth(Number.NaN)).toBe(DEFAULT_COLUMN_WIDTH);
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COLUMN_WIDTH);
  });
});

describe("normalizeColumnWidth", () => {
  it("parses stored strings and clamps them", () => {
    expect(normalizeColumnWidth("340")).toBe(340);
    expect(normalizeColumnWidth("10")).toBe(MIN_COLUMN_WIDTH);
    expect(normalizeColumnWidth("junk")).toBe(DEFAULT_COLUMN_WIDTH);
    expect(normalizeColumnWidth(null)).toBe(DEFAULT_COLUMN_WIDTH);
  });
});

describe("normalizeColumnOrder", () => {
  it("keeps unique string entries only", () => {
    expect(normalizeColumnOrder(["b", "a", "b", 1, "", null, "a"])).toEqual(["b", "a"]);
  });

  it("rejects non-array values", () => {
    expect(normalizeColumnOrder("p1")).toEqual([]);
    expect(normalizeColumnOrder(undefined)).toEqual([]);
    expect(normalizeColumnOrder({})).toEqual([]);
  });
});

describe("normalizeBoardView", () => {
  it("accepts only board or list", () => {
    expect(normalizeBoardView("board")).toBe("board");
    expect(normalizeBoardView("list")).toBe("list");
    expect(normalizeBoardView("gallery")).toBe("board");
    expect(normalizeBoardView(null)).toBe("board");
  });
});

describe("applyColumnOrder", () => {
  it("is a no-op for an empty saved order", () => {
    const columns = [column("p1"), column("p2")];
    expect(applyColumnOrder(columns, [])).toEqual(columns);
  });

  it("leads with saved keys and appends new columns in default order", () => {
    const columns = [column("p1"), column("p2"), column("p3")];
    const result = applyColumnOrder(columns, ["p3", "p1", "ghost"]);
    expect(result.map((entry) => entry.key)).toEqual(["p3", "p1", "p2"]);
  });

  it("always moves the unlinked column last", () => {
    const columns = [column("__unlinked__", true), column("p1"), column("p2")];
    const result = applyColumnOrder(columns, ["p2", "p1"]);
    expect(result.map((entry) => entry.key)).toEqual(["p2", "p1", "__unlinked__"]);
  });
});

describe("moveColumnKey", () => {
  it("moves the active key onto the target key", () => {
    expect(moveColumnKey(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveColumnKey(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("returns a copy for unknown or identical keys", () => {
    const order = ["a", "b"];
    expect(moveColumnKey(order, "a", "a")).toEqual(order);
    expect(moveColumnKey(order, "ghost", "a")).toEqual(order);
    expect(moveColumnKey(order, "a", "ghost")).toEqual(order);
    expect(moveColumnKey(order, "a", "b")).not.toBe(order);
  });
});
