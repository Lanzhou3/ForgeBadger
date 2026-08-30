"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import {
  decidePendingAction,
  editMessage,
  getRun,
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
  /** Accumulated reasoning/thinking content (Anthropic extended thinking, OpenAI reasoning_content). */
  thinking: string;
  pendingAction: CopilotPendingAction | null;
  error?: string;
}

interface CopilotRunUpdatedPayload {
  run_id?: string;
  conversation_id?: string;
  status?: string;
  source?: "user" | "reactive";
  text_delta?: string;
  thinking_delta?: string;
  tool_name?: string;
  pending_action_id?: string;
  message?: string;
  /** Set when the gateway auto-generated the conversation title after the first completed turn. */
  title_updated?: string;
}

export interface UseCopilotRunOptions {
  /** Fired when the proactive loop starts a report in a fresh conversation. */
  onReactiveUpdate?: () => void;
  /** Fired when the gateway finishes an auto-generated conversation title. */
  onTitleUpdated?: (input: { conversationId: string; title: string }) => void;
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);
/** Placeholder runId for the optimistic pending state (before the POST returns). */
const PENDING_RUN_ID = "";
/**
 * Last-resort cleanup: if no event for the active run arrives for this long
 * (WS dead, gateway restarted mid-run), drop the streaming state instead of
 * leaving "Copilot is thinking" stuck forever. awaiting_approval is a stable
 * state and is never auto-cleared.
 */
export const RUN_STALE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Live state for the currently-running Copilot turn. Subscribes to the shared
 * gateway event stream (dispatched by NotificationProvider's /ws/events socket)
 * and folds `copilot_run_updated` frames into a single ActiveCopilotRun.
 * Proactive (`source: "reactive"`) runs are surfaced via onReactiveUpdate instead
 * of being folded into the active user run.
 *
 * Reliability: the send POST is blocking on some paths (the run may already be
 * finished — terminal WS event consumed — before the POST returns the runId).
 * To keep the streaming state consistent in both worlds:
 * - events arriving before the runId is known are accepted and folded (matched
 *   by payload, not dropped), and startRun never wipes already-streamed deltas;
 * - terminal run ids are remembered so a late startRun cannot resurrect a
 *   finished run into a stuck "running" state;
 * - after the POST returns, the run is reconciled once against GET /runs/:id;
 * - a sliding stale timer is the final fallback when no events arrive at all.
 */
export function useCopilotRun(options?: UseCopilotRunOptions) {
  const [active, setActive] = useState<ActiveCopilotRun | null>(null);
  const activeRef = useRef<ActiveCopilotRun | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const terminalRunIdsRef = useRef<Set<string>>(new Set());
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReactiveUpdateRef = useRef<UseCopilotRunOptions["onReactiveUpdate"]>(options?.onReactiveUpdate);
  const onTitleUpdatedRef = useRef<UseCopilotRunOptions["onTitleUpdated"]>(options?.onTitleUpdated);
  const clearActiveRef = useRef<(() => void) | null>(null);
  onReactiveUpdateRef.current = options?.onReactiveUpdate;
  onTitleUpdatedRef.current = options?.onTitleUpdated;

  const setActiveSafe = useCallback((updater: (prev: ActiveCopilotRun | null) => ActiveCopilotRun | null) => {
    setActive((prev) => {
      const next = updater(prev);
      activeRef.current = next;
      return next;
    });
  }, []);

  const clearStaleTimer = useCallback(() => {
    if (staleTimerRef.current) {
      clearTimeout(staleTimerRef.current);
      staleTimerRef.current = null;
    }
  }, []);

  const armStaleTimer = useCallback(
    (runId: string) => {
      clearStaleTimer();
      staleTimerRef.current = setTimeout(() => {
        const current = activeRef.current;
        if (
          current &&
          current.runId === runId &&
          !current.pendingAction &&
          (current.status === "running" || current.status === "pending")
        ) {
          clearActiveRef.current?.();
        }
      }, RUN_STALE_TIMEOUT_MS);
    },
    [clearStaleTimer]
  );

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
      // Auto-title: the gateway generated a title after a completed turn.
      // The sidebar/header want to pick it up so the "未命名对话" placeholder
      // disappears. Fires for both reactive and user runs so reports get named
      // too, but the source check above already short-circuited reactive.
      if (payload.title_updated && payload.conversation_id) {
        onTitleUpdatedRef.current?.({ conversationId: payload.conversation_id, title: payload.title_updated });
      }
      const runId = payload.run_id;
      if (!runId) return;
      if (currentRunIdRef.current !== null && runId !== currentRunIdRef.current) return;

      // Events are flowing — the run is alive, re-arm the stale fallback.
      armStaleTimer(runId);

      setActiveSafe((prev) => {
        const current = prev ?? { runId, conversationId: payload.conversation_id ?? "", status: "running", text: "", thinking: "", pendingAction: null };
        return {
          ...current,
          runId,
          conversationId: payload.conversation_id ?? current.conversationId,
          status: (payload.status as CopilotRunStatus) ?? current.status,
          text: current.text + (payload.text_delta ?? ""),
          thinking: (current.thinking ?? "") + (payload.thinking_delta ?? ""),
          pendingAction: payload.pending_action_id
            ? { id: payload.pending_action_id, runId, tool: payload.tool_name ?? "", inputJson: "", inputDigest: "", status: "pending", createdAt: "", updatedAt: "", conversationId: current.conversationId, userId: "" }
            : current.pendingAction,
          error: payload.message && (payload.status === "failed" || payload.status === "error") ? payload.message : undefined,
        };
      });

      // When the run reaches a terminal state and there is no pending action
      // waiting for owner approval, drop the active state entirely. The
      // persisted assistant message is already in `messages` (reloadActive
      // Conversation runs in the chat component after sendMessage returns),
      // so keeping `active` around would re-render the streaming bubble and
      // stack the same text on top of the persisted message — the chat would
      // look like it was still "thinking" while showing the answer twice.
      if (TERMINAL_RUN_STATUSES.has(payload.status ?? "")) {
        // Remember terminal run ids: on the blocking-POST path the terminal
        // event can land before startRun has seen the response, and without
        // this it would resurrect the finished run as a stuck "running".
        const terminalIds = terminalRunIdsRef.current;
        terminalIds.add(runId);
        if (terminalIds.size > 50) {
          const oldest = terminalIds.values().next().value;
          if (oldest !== undefined) terminalIds.delete(oldest);
        }
        if (!payload.pending_action_id) {
          clearActiveRef.current?.();
        }
      }
    };

    window.addEventListener(FORGEBADGER_GATEWAY_EVENT, handler);
    return () => window.removeEventListener(FORGEBADGER_GATEWAY_EVENT, handler);
  }, [setActiveSafe, armStaleTimer]);

  // Blocking-POST reconcile: the run may already be finished by the time the
  // POST returned, with its terminal WS frame consumed before we adopted the
  // runId. Ask the server once so the streaming state can never stick; the
  // stale timer remains the last resort if this request fails.
  // Gating uses currentRunIdRef (set synchronously by adoptRun), not
  // activeRef: the adoptRun merge is queued right before this runs and React
  // may not have flushed it yet, so activeRef can still hold the pending
  // placeholder here.
  const reconcileRun = useCallback(
    async (runId: string) => {
      try {
        const { run, pendingActions } = await getRun(runId);
        if (currentRunIdRef.current !== runId) return;
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          if (!activeRef.current?.pendingAction) clearActiveRef.current?.();
          return;
        }
        // If the WS pending-action frame raced past us, adopt the server's
        // pending action so the approval card still shows up. Merge onto
        // whatever is on screen (possibly the pending placeholder).
        if (run.status === "awaiting_approval") {
          const pending = pendingActions.find((action) => action.status === "pending");
          if (pending) {
            setActiveSafe((prev) =>
              prev && !prev.pendingAction
                ? { ...prev, runId, status: "awaiting_approval", pendingAction: pending }
                : prev
            );
          }
        }
      } catch {
        // Best-effort; RUN_STALE_TIMEOUT_MS is the final fallback.
      }
    },
    [setActiveSafe]
  );

  const adoptRun = useCallback(
    async (runId: string, conversationId: string) => {
      currentRunIdRef.current = runId;
      if (terminalRunIdsRef.current.has(runId)) {
        // The run already finished before we learned its id — stay cleared
        // instead of resurrecting a stuck "running" bubble.
        terminalRunIdsRef.current.delete(runId);
        clearActiveRef.current?.();
        return;
      }
      // Deltas (or the optimistic pending state) may already exist from while
      // the POST was in flight; never wipe them with a fresh empty state. The
      // POST has answered, so a bare pending placeholder graduates to running.
      setActiveSafe((prev) =>
        prev && (prev.runId === runId || prev.runId === PENDING_RUN_ID)
          ? { ...prev, runId, conversationId, status: prev.status === "pending" ? "running" : prev.status }
          : { runId, conversationId, status: "running", text: "", thinking: "", pendingAction: null }
      );
      armStaleTimer(runId);
      await reconcileRun(runId);
    },
    [setActiveSafe, armStaleTimer, reconcileRun]
  );

  // Optimistic "thinking" state the instant the user hits send — before the
  // POST returns and before any WS event arrives, so the UI never looks dead
  // while the dsh runtime cold-starts. runId is PENDING_RUN_ID until the
  // server responds or the first frame folds in.
  const markPending = useCallback(
    (conversationId: string) => {
      setActiveSafe(
        (prev) => prev ?? { runId: PENDING_RUN_ID, conversationId, status: "pending", text: "", thinking: "", pendingAction: null }
      );
      armStaleTimer(PENDING_RUN_ID);
    },
    [setActiveSafe, armStaleTimer]
  );

  const startRun = useCallback(
    async (conversationId: string, text: string, modelId?: string) => {
      markPending(conversationId);
      let runId: string;
      try {
        ({ runId } = await sendMessage(conversationId, text, modelId));
      } catch (error) {
        // A failed send must drop the optimistic pending state immediately;
        // the caller surfaces its own error affordance.
        clearActiveRef.current?.();
        throw error;
      }
      await adoptRun(runId, conversationId);
      return runId;
    },
    [markPending, adoptRun]
  );

  // Edit/regenerate flow: the server truncates the target message in place and
  // reruns the turn. Streaming deltas flow over /ws/events exactly like a fresh
  // sendMessage, so we just hand off the returned runId to the same UI state.
  const startEditedRun = useCallback(
    async (conversationId: string, messageId: string, content: string) => {
      markPending(conversationId);
      let runId: string;
      try {
        ({ runId } = await editMessage(conversationId, messageId, content));
      } catch (error) {
        clearActiveRef.current?.();
        throw error;
      }
      await adoptRun(runId, conversationId);
      return runId;
    },
    [markPending, adoptRun]
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
    clearStaleTimer();
    setActiveSafe(() => null);
  }, [clearStaleTimer, setActiveSafe]);
  clearActiveRef.current = clearActive;

  useEffect(() => clearStaleTimer, [clearStaleTimer]);

  return { active, startRun, startEditedRun, approveAction, clearActive, markPending };
}
