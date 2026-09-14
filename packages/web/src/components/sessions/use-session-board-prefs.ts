"use client";

import { useCallback, useEffect, useState } from "react";

import {
  clampColumnWidth,
  DEFAULT_COLUMN_WIDTH,
  normalizeBoardView,
  normalizeColumnOrder,
  normalizeColumnWidth,
  SESSION_BOARD_ORDER_KEY,
  SESSION_BOARD_VIEW_KEY,
  SESSION_BOARD_WIDTH_KEY,
  type SessionBoardView,
} from "./session-board-prefs";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Session board UI preferences (column width, column order, view mode),
 * hydrated after mount so server and client markup match, and persisted to
 * localStorage on change.
 */
export function useSessionBoardPrefs() {
  const [columnWidth, setColumnWidthState] = useState(DEFAULT_COLUMN_WIDTH);
  const [columnOrder, setColumnOrderState] = useState<string[]>([]);
  const [view, setViewState] = useState<SessionBoardView>("board");

  useEffect(() => {
    setColumnWidthState(normalizeColumnWidth(readStorage(SESSION_BOARD_WIDTH_KEY)));
    try {
      setColumnOrderState(normalizeColumnOrder(JSON.parse(readStorage(SESSION_BOARD_ORDER_KEY) ?? "[]")));
    } catch {
      setColumnOrderState([]);
    }
    setViewState(normalizeBoardView(readStorage(SESSION_BOARD_VIEW_KEY)));
  }, []);

  const setColumnWidth = useCallback((width: number) => {
    const clamped = clampColumnWidth(width);
    setColumnWidthState(clamped);
    try {
      window.localStorage.setItem(SESSION_BOARD_WIDTH_KEY, String(clamped));
    } catch {
      // Storage may be unavailable (private mode); the in-memory value still applies.
    }
  }, []);

  const setColumnOrder = useCallback((order: string[]) => {
    const normalized = normalizeColumnOrder(order);
    setColumnOrderState(normalized);
    try {
      window.localStorage.setItem(SESSION_BOARD_ORDER_KEY, JSON.stringify(normalized));
    } catch {
      // See above.
    }
  }, []);

  const resetColumnOrder = useCallback(() => {
    setColumnOrderState([]);
    try {
      window.localStorage.removeItem(SESSION_BOARD_ORDER_KEY);
    } catch {
      // See above.
    }
  }, []);

  const setView = useCallback((nextView: SessionBoardView) => {
    setViewState(nextView);
    try {
      window.localStorage.setItem(SESSION_BOARD_VIEW_KEY, nextView);
    } catch {
      // See above.
    }
  }, []);

  return {
    columnWidth,
    setColumnWidth,
    columnOrder,
    setColumnOrder,
    resetColumnOrder,
    view,
    setView,
  };
}
