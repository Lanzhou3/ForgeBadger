import type { SessionBoardColumnData } from "./session-board-utils";

export const SESSION_BOARD_WIDTH_KEY = "forgebadger.sessionBoard.width.v1";
export const SESSION_BOARD_ORDER_KEY = "forgebadger.sessionBoard.columnOrder.v1";
export const SESSION_BOARD_VIEW_KEY = "forgebadger.sessionBoard.view.v1";

export const MIN_COLUMN_WIDTH = 260;
export const MAX_COLUMN_WIDTH = 420;
export const DEFAULT_COLUMN_WIDTH = 300;

export type SessionBoardView = "board" | "list";

export function clampColumnWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_COLUMN_WIDTH;
  }
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(value)));
}

export function normalizeColumnWidth(value: unknown): number {
  if (typeof value !== "string") {
    return DEFAULT_COLUMN_WIDTH;
  }
  const parsed = Number.parseInt(value, 10);
  return clampColumnWidth(Number.isNaN(parsed) ? DEFAULT_COLUMN_WIDTH : parsed);
}

/** Column order entries are linked-project column keys (never the unlinked column). */
export function normalizeColumnOrder(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    order.push(entry);
  }
  return order;
}

export function normalizeBoardView(value: unknown): SessionBoardView {
  return value === "list" ? "list" : "board";
}

/**
 * Applies a saved column order: saved keys lead in saved order, columns missing
 * from the saved order keep their default relative order at the end, and the
 * unlinked column is always moved last. An empty saved order is a no-op.
 */
export function applyColumnOrder(
  columns: SessionBoardColumnData[],
  savedOrder: readonly string[]
): SessionBoardColumnData[] {
  if (savedOrder.length === 0) {
    return columns;
  }
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const placed = new Set<string>();
  const ordered: SessionBoardColumnData[] = [];
  for (const key of savedOrder) {
    const column = byKey.get(key);
    if (column && !placed.has(key)) {
      placed.add(key);
      ordered.push(column);
    }
  }
  const linkedRest = columns.filter(
    (column) => !column.unlinked && !placed.has(column.key)
  );
  const unlinked = columns.filter((column) => column.unlinked);
  return [...ordered, ...linkedRest, ...unlinked];
}

/** Reorders `order` by moving `activeKey` onto `overKey`; unknown keys are a no-op. */
export function moveColumnKey(
  order: readonly string[],
  activeKey: string,
  overKey: string
): string[] {
  const from = order.indexOf(activeKey);
  const to = order.indexOf(overKey);
  if (from < 0 || to < 0 || from === to) {
    return [...order];
  }
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
