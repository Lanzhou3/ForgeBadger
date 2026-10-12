"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CopilotTextStream } from '@/lib/copilot-text-stream';
import { FORGEBADGER_GATEWAY_EVENT, FORGEBADGER_GATEWAY_CONNECTED } from "@/lib/gateway-events";
import { useLanguage } from "@/hooks/use-language";
import type { TranslationKey } from "@/lib/i18n";
import { agentErrorTranslationKey } from "@/lib/agent-error";
import { editMessage, getRun, listConversationRuns, sendMessage,
  type CopilotPendingAction, type CopilotRunStatus } from "@/lib/copilot-api";

export interface ActiveCopilotRun {
  phase?: string;
  phaseStartedAt?: string;
  runId: string;
  conversationId: string;
  status: CopilotRunStatus;
  text: string;
  thinking: string;
  pendingAction: CopilotPendingAction | null;
  revision?: number;
  error?: string;
  errorCode?: string;
  syncError?: string;
}
export interface UseCopilotRunOptions {
  conversationId?: string | null;
  onSettled?: (conversationId: string) => Promise<void> | void;
  onReactiveUpdate?: () => void;
  onTitleUpdated?: (input: { conversationId: string; title: string }) => void;
}
const TERMINAL = new Set(["completed", "failed", "cancelled", "stopped", "indeterminate"]);
export const RUN_STALE_TIMEOUT_MS = 5 * 60 * 1000;
const emptyRun = (conversationId: string, runId = ""): ActiveCopilotRun => ({
  conversationId, runId, status: "pending", text: "", thinking: "", pendingAction: null,
});
type Translate = (key: TranslationKey) => string;
function terminalReason(status: CopilotRunStatus, reason: string | undefined, t: Translate) {
  if (status === "indeterminate") return t("copilot.terminal.indeterminate");
  if (status === "stopped" && reason === "COPILOT_TOKEN_BUDGET") return t("copilot.terminal.tokenBudget");
  if (status === "stopped" && reason === "COPILOT_TIME_BUDGET") return t("copilot.terminal.timeBudget");
  if (status === "stopped") return reason === "step_budget_exhausted" ? t("copilot.terminal.stepBudget") : t("copilot.terminal.stopped");
  if (status === "cancelled") return t("copilot.terminal.cancelled");
  if (status === "failed") {
    if (!reason) return t("copilot.terminal.failedDefault");
    const key = agentErrorTranslationKey(reason);
    return key ? t(key) : t("copilot.error.unknown");
  }
  return undefined;
}

/** REST owns execution state. WebSocket frames only stream text and request reconciliation. */
export function useCopilotRun(options?: UseCopilotRunOptions) {
  const { t } = useLanguage();
  const [active, setActive] = useState<ActiveCopilotRun | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const activeRef = useRef<ActiveCopilotRun | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const selectedRef = useRef<string | null>(options?.conversationId ?? null);
  const generation = useRef(0);
  const settled = useRef(new Set<string>());
  const requestSerial = useRef(0);
  const appliedSerial = useRef(0);
  const submitting = useRef(false);
  const publicStream = useRef(new CopilotTextStream());
  const refreshEventKey = useRef("");
  const refreshGapKey = useRef("");
  const reactiveEventKeys = useRef(new Map<string, string>());
  const reactiveRefreshEpoch = useRef<number | null>(null);
  const refreshFlight = useRef<{ epoch: number; promise: Promise<void>; dirty: boolean } | null>(null);
  const update = useCallback((next: ActiveCopilotRun | null) => {
    activeRef.current = next;
    setActive(next);
  }, []);
  const clearActive = useCallback(() => {
    generation.current++;
    submitting.current = false;
    publicStream.current.clear();
    refreshEventKey.current = "";
    refreshGapKey.current = "";
    update(null);
    setSyncError(null);
  }, [update]);

  const reconcileOnce = useCallback(async () => {
    const epoch = generation.current;
    const conversationId = selectedRef.current;
    const serial = ++requestSerial.current;
    const valid = () => epoch === generation.current && serial >= appliedSerial.current;
    try {
      let runId = activeRef.current?.runId;
      // Until the POST (or a run event) identifies the new turn, the latest
      // persisted run can still be the previous one.
      if (!runId && submitting.current) return;
      if (conversationId && (!runId || TERMINAL.has(activeRef.current?.status ?? ""))) {
        const { runs, activeRun } = await listConversationRuns(conversationId);
        if (!valid()) return;
        runId = (activeRun ?? runs[0])?.id;
      }
      if (!runId) return;
      const { run, pendingActions, provisionalText } = await getRun(runId);
      if (!valid() || (conversationId && run.conversationId !== conversationId)) return;
      const previous = activeRef.current;
      const sameRun = previous?.runId === run.id;
      if (previous?.runId && !sameRun && !TERMINAL.has(previous.status)) return;
      if (sameRun && (run.revision ?? 0) < (previous?.revision ?? 0)) return;
      appliedSerial.current = serial;
      setSyncError(null);
      const next: ActiveCopilotRun = {
        ...(sameRun && previous ? previous : emptyRun(run.conversationId, run.id)),
        runId: run.id, conversationId: run.conversationId, status: run.status,
        revision: run.revision, syncError: undefined, phase: run.phase, phaseStartedAt: run.phaseStartedAt,
        ...(provisionalText && !TERMINAL.has(run.status) ? { text: publicStream.current.restore(run.id, provisionalText) } : {}),
        pendingAction: pendingActions.find((action) => action.status === "pending") ?? null,
        error: terminalReason(run.status, run.error ?? run.stopReason, t),
        errorCode: run.status === "failed" && !agentErrorTranslationKey(run.error ?? run.stopReason)
          ? (run.error ?? run.stopReason) : undefined,
      };
      if (TERMINAL.has(run.status)) {
        // Keep the streaming bubble until durable messages have replaced it.
        // A completed run can receive durable task reports later. The settled
        // set only fences provisional deltas, never transcript refreshes.
        await optionsRef.current?.onSettled?.(run.conversationId);
        if (!valid()) return;
        settled.current.add(run.id);
        publicStream.current.clear();
        update(run.status === "completed" ? null : { ...next, text: "", thinking: "", pendingAction: null });
      } else update(next);
    } catch {
      if (!valid()) return;
      const message = t("copilot.syncFailedRetrying");
      setSyncError(message);
      if (activeRef.current) update({ ...activeRef.current, syncError: message });
    }
  }, [update, t]);

  // At most one request is in flight for this selection. A state update that
  // arrives during it schedules one follow-up instead of a request per frame.
  const reconcile = useCallback((): Promise<void> => {
    const epoch = generation.current;
    if (refreshFlight.current?.epoch === epoch) {
      refreshFlight.current.dirty = true;
      return refreshFlight.current.promise;
    }
    const flight = { epoch, promise: Promise.resolve(), dirty: false };
    refreshFlight.current = flight;
    flight.promise = (async () => {
      try {
        do {
          flight.dirty = false;
          await reconcileOnce();
        } while (flight.dirty && epoch === generation.current);
      } finally {
        if (refreshFlight.current === flight) refreshFlight.current = null;
      }
    })();
    return flight.promise;
  }, [reconcileOnce]);

  useEffect(() => {
    const id = options?.conversationId ?? null;
    // Lazy conversation creation may already have started this run.
    if (selectedRef.current !== id) {
      selectedRef.current = id;
      if (activeRef.current?.conversationId !== id) clearActive();
    }
    void reconcile();
  }, [options?.conversationId, clearActive, reconcile]);

  useEffect(() => {
    const refresh = () => { void reconcile(); };
    const eventHandler = (event: Event) => {
      const detail = (event as CustomEvent<{type?: string; payload?: Record<string, unknown>}>).detail;
      if (detail?.type !== "copilot_run_updated") return;
      const p = detail.payload ?? {};
      if (typeof p.title_updated === "string" && typeof p.conversation_id === "string")
        optionsRef.current?.onTitleUpdated?.({ conversationId: p.conversation_id, title: p.title_updated });
      if ((p.source === "reactive" || p.source === "scheduled") && typeof p.run_id === "string") {
        const key = JSON.stringify([p.status, p.revision]);
        if (reactiveEventKeys.current.get(p.run_id) !== key) {
          reactiveEventKeys.current.set(p.run_id, key);
          if (reactiveEventKeys.current.size > 200) reactiveEventKeys.current.delete(reactiveEventKeys.current.keys().next().value!);
          const epoch = generation.current;
          if (reactiveRefreshEpoch.current !== epoch) {
            reactiveRefreshEpoch.current = epoch;
            queueMicrotask(() => {
              if (reactiveRefreshEpoch.current !== epoch) return;
              reactiveRefreshEpoch.current = null;
              if (epoch === generation.current) optionsRef.current?.onReactiveUpdate?.();
            });
          }
        }
      }
      const current = activeRef.current;
      const conversationId = selectedRef.current ?? current?.conversationId;
      if (!conversationId || (p.conversation_id && p.conversation_id !== conversationId)) return;
      if (typeof p.run_id !== "string") return;
      if (typeof p.message === "string" && TERMINAL.has(String(p.status))
        && (settled.current.has(p.run_id) || (current?.runId && current.runId !== p.run_id))) {
        const epoch = generation.current;
        void Promise.resolve(optionsRef.current?.onSettled?.(conversationId)).catch(() => {
          if (epoch === generation.current) setSyncError(t("copilot.syncFailedRetry"));
        });
      }
      if (current?.runId && current.runId !== p.run_id) {
        if (TERMINAL.has(current.status)) refresh();
        return;
      }
      if (settled.current.has(p.run_id)) return;
      if (typeof p.revision === "number" && p.revision < (current?.revision ?? 0)) return;
      if (!current && p.conversation_id !== conversationId) return;
      const next = current ?? emptyRun(conversationId, p.run_id);
      const streamed = publicStream.current.accept(p.run_id,p);
      update({ ...next, runId: p.run_id,
        revision: typeof p.revision === "number" ? p.revision : next.revision,
        text: streamed ?? (typeof p.text_step_id === 'string' ? next.text : next.text + (typeof p.text_delta === "string" ? p.text_delta : "")),
        thinking: next.thinking + (typeof p.thinking_delta === "string" ? p.thinking_delta : ""),
      });
      // Never manufacture an empty approval card or infer a terminal outcome.
      const eventKey = JSON.stringify([p.run_id, p.status, p.revision, p.pending_action_id]);
      const stateChanged = (typeof p.status === "string" && p.status !== current?.status)
        || (typeof p.revision === "number" && p.revision > (current?.revision ?? 0))
        || (typeof p.pending_action_id === "string" && p.pending_action_id !== current?.pendingAction?.id);
      const gapKey = publicStream.current.gapKey();
      const newGap = Boolean(gapKey && gapKey !== refreshGapKey.current);
      refreshGapKey.current = gapKey;
      if ((stateChanged && eventKey !== refreshEventKey.current) || newGap) {
        refreshEventKey.current = eventKey;
        refresh();
      }
    };
    window.addEventListener(FORGEBADGER_GATEWAY_EVENT, eventHandler);
    window.addEventListener(FORGEBADGER_GATEWAY_CONNECTED, refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    // Polling also covers a terminal frame lost while the socket was offline.
    const timer = setInterval(refresh, 5000);
    return () => {
      generation.current++;
      clearInterval(timer);
      window.removeEventListener(FORGEBADGER_GATEWAY_EVENT, eventHandler);
      window.removeEventListener(FORGEBADGER_GATEWAY_CONNECTED, refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [reconcile, update, t]);

  const markPending = useCallback((conversationId: string) => {
    submitting.current = true;
    selectedRef.current = conversationId;
    update(emptyRun(conversationId));
  }, [update]);
  const submit = useCallback(async (conversationId: string, request: () => Promise<{ runId: string }>) => {
    markPending(conversationId);
    const epoch = generation.current;
    try {
      const { runId } = await request();
      if (epoch !== generation.current) return runId;
      submitting.current = false;
      if (!settled.current.has(runId)) update({ ...(activeRef.current ?? emptyRun(conversationId)), runId });
      await reconcile();
      return runId;
    } catch (error) {
      if (epoch === generation.current) clearActive();
      throw error;
    }
  }, [markPending, update, reconcile, clearActive]);
  const startRun = useCallback((id: string, text: string, modelId?: string, options?: import("@/lib/copilot-api").CopilotMessageOptions) =>
    submit(id, () => options ? sendMessage(id, text, modelId, options) : sendMessage(id, text, modelId)), [submit]);
  const startEditedRun = useCallback((id: string, messageId: string, text: string, options?: Parameters<typeof editMessage>[3]) =>
    submit(id, () => options ? editMessage(id, messageId, text, options) : editMessage(id, messageId, text)), [submit]);
  return { active, syncError, startRun, startEditedRun, clearActive, markPending, reconcile };
}
