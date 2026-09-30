"use client";

import { useEffect, useRef, useState } from "react";

import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";

export interface TerminalCommandProgress {
  command: string;
  outputTail: string;
  status: "running" | "completed" | "timed_out" | "user_took_over" | "error";
  sessionId?: string;
}

/** How long a finished command card stays visible before fading out. */
const FINISHED_VISIBLE_MS = 4000;

/**
 * Live progress for terminal commands executed by Copilot in this
 * conversation (gateway `terminal_command_progress` events over /ws/events).
 * Returns the latest progress while a command runs; finished states stay
 * visible briefly so the user sees the outcome before the tool result lands
 * in the message history.
 */
export function useTerminalCommandProgress(conversationId: string | null): TerminalCommandProgress | null {
  const [progress, setProgress] = useState<TerminalCommandProgress | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Conversation switched: drop any stale card.
    setProgress(null);
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    if (!conversationId) return;

    const onEvent = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as { type?: string; payload?: Record<string, unknown> }) : undefined;
      if (detail?.type !== "terminal_command_progress") return;
      const p = detail.payload ?? {};
      if (p.conversation_id !== conversationId) return;
      const command = typeof p.command === "string" ? p.command : "";
      const status = typeof p.status === "string" ? p.status : "running";
      const next: TerminalCommandProgress = {
        command,
        outputTail: typeof p.output_tail === "string" ? p.output_tail : "",
        status: status as TerminalCommandProgress["status"],
        ...(typeof p.session_id === "string" ? { sessionId: p.session_id } : {})
      };
      setProgress(next);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      if (status !== "running") {
        clearTimer.current = setTimeout(() => setProgress(null), FINISHED_VISIBLE_MS);
      }
    };

    window.addEventListener(FORGEBADGER_GATEWAY_EVENT, onEvent);
    return () => {
      window.removeEventListener(FORGEBADGER_GATEWAY_EVENT, onEvent);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [conversationId]);

  return progress;
}
