"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { OPENFORGE_GATEWAY_EVENT } from "@/lib/gateway-events";
import {
  decidePendingAction,
  sendMessage,
  type CopilotPendingAction,
  type CopilotRunStatus,
} from "@/lib/copilot-api";

export interface ActiveCopilotRun {
  runId: string;
  conversationId: string;
  status: CopilotRunStatus;
  /** Accumulated assistant text for the active run. */
  text: string;
  pendingAction: CopilotPendingAction | null;
  error?: string;
}

interface CopilotRunUpdatedPayload {
  run_id?: string;
  conversation_id?: string;
  status?: string;
  source?: "user" | "reactive";
  text_delta?: string;
  tool_name?: string;
  pending_action_id?: string;
  message?: string;
}

export interface UseCopilotRunOptions {
  /** Fired when the proactive loop starts a report in a fresh conversation. */
  onReactiveUpdate?: () => void;
}

/**
 * Live state for the currently-running Copilot turn. Subscribes to the shared
 * gateway event stream (dispatched by NotificationProvider's /ws/events socket)
 * and folds `copilot_run_updated` frames into a single ActiveCopilotRun.
 * Proactive (`source: "reactive"`) runs are surfaced via onReactiveUpdate instead
 * of being folded into the active user run.
 */
export function useCopilotRun(options?: UseCopilotRunOptions) {
  const [active, setActive] = useState<ActiveCopilotRun | null>(null);
  const activeRef = useRef<ActiveCopilotRun | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const onReactiveUpdateRef = useRef<UseCopilotRunOptions["onReactiveUpdate"]>(options?.onReactiveUpdate);
  onReactiveUpdateRef.current = options?.onReactiveUpdate;

  const setActiveSafe = useCallback((updater: (prev: ActiveCopilotRun | null) => ActiveCopilotRun | null) => {
    setActive((prev) => {
      const next = updater(prev);
      activeRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; payload?: Record<string, unknown> }>).detail;
      if (!detail || detail.type !== "copilot_run_updated") return;
      const payload = (detail.payload ?? {}) as CopilotRunUpdatedPayload;
      if (payload.source === "reactive") {
        // A proactive report landed in a fresh conversation — let the UI refresh.
        onReactiveUpdateRef.current?.();
        return;
      }
      const runId = payload.run_id;
      if (!runId) return;
      if (currentRunIdRef.current !== null && runId !== currentRunIdRef.current) return;

      setActiveSafe((prev) => {
        const current = prev ?? { runId, conversationId: payload.conversation_id ?? "", status: "running", text: "", pendingAction: null };
        return {
          ...current,
          runId,
          conversationId: payload.conversation_id ?? current.conversationId,
          status: (payload.status as CopilotRunStatus) ?? current.status,
          text: current.text + (payload.text_delta ?? ""),
          pendingAction: payload.pending_action_id
            ? { id: payload.pending_action_id, runId, tool: payload.tool_name ?? "", inputJson: "", inputDigest: "", status: "pending", createdAt: "", updatedAt: "", conversationId: current.conversationId, userId: "" }
            : current.pendingAction,
          error: payload.message && (payload.status === "failed" || payload.status === "error") ? payload.message : undefined,
        };
      });
    };
    window.addEventListener(OPENFORGE_GATEWAY_EVENT, handler);
    return () => window.removeEventListener(OPENFORGE_GATEWAY_EVENT, handler);
  }, [setActiveSafe]);

  const startRun = useCallback(
    async (conversationId: string, text: string, modelId?: string) => {
      const { runId } = await sendMessage(conversationId, text, modelId);
      currentRunIdRef.current = runId;
      setActiveSafe(() => ({ runId, conversationId, status: "running", text: "", pendingAction: null }));
      return runId;
    },
    [setActiveSafe]
  );

  const approveAction = useCallback(
    async (runId: string, actionId: string, approved: boolean) => {
      await decidePendingAction(runId, actionId, approved);
      setActiveSafe((prev) => (prev ? { ...prev, status: approved ? "completed" : "completed", pendingAction: null } : prev));
    },
    [setActiveSafe]
  );

  const clearActive = useCallback(() => {
    currentRunIdRef.current = null;
    setActiveSafe(() => null);
  }, [setActiveSafe]);

  return { active, startRun, approveAction, clearActive };
}
