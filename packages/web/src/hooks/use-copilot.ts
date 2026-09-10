"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FORGEBADGER_GATEWAY_EVENT, FORGEBADGER_GATEWAY_CONNECTED } from "@/lib/gateway-events";
import { decidePendingAction, editMessage, getRun, listConversationRuns, sendMessage,
  type CopilotPendingAction, type CopilotRunStatus } from "@/lib/copilot-api";

export interface ActiveCopilotRun {
  runId: string;
  conversationId: string;
  status: CopilotRunStatus;
  text: string;
  thinking: string;
  pendingAction: CopilotPendingAction | null;
  revision?: number;
  error?: string;
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
function terminalReason(status: CopilotRunStatus, reason?: string) {
  if (status === "indeterminate") return "操作结果尚未确认，请核实实际结果后再继续，避免重复操作。";
  if (status === "stopped") return reason === "step_budget_exhausted" ? "已达到本次执行步数上限。" : "执行已停止。";
  if (status === "cancelled") return "执行已取消；已发生的操作不会自动撤销。";
  if (status === "failed") return reason || "执行失败，请查看会话记录。";
  return undefined;
}

/** REST owns execution state. WebSocket frames only stream text and request reconciliation. */
export function useCopilotRun(options?: UseCopilotRunOptions) {
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
  const update = useCallback((next: ActiveCopilotRun | null) => {
    activeRef.current = next;
    setActive(next);
  }, []);
  const clearActive = useCallback(() => {
    generation.current++;
    update(null);
    setSyncError(null);
  }, [update]);

  const reconcile = useCallback(async () => {
    const epoch = generation.current;
    const conversationId = selectedRef.current;
    const serial = ++requestSerial.current;
    const valid = () => epoch === generation.current && serial >= appliedSerial.current;
    try {
      let runId = activeRef.current?.runId;
      if (conversationId && (!runId || TERMINAL.has(activeRef.current?.status ?? ""))) {
        const { runs, activeRun } = await listConversationRuns(conversationId);
        if (!valid()) return;
        runId = (activeRun ?? runs[0])?.id;
      }
      if (!runId) return;
      const { run, pendingActions } = await getRun(runId);
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
        revision: run.revision, syncError: undefined,
        pendingAction: pendingActions.find((action) => action.status === "pending") ?? null,
        error: terminalReason(run.status, run.error ?? run.stopReason),
      };
      if (TERMINAL.has(run.status)) {
        // Keep the streaming bubble until durable messages have replaced it.
        if (!settled.current.has(run.id)) {
          await optionsRef.current?.onSettled?.(run.conversationId);
          if (!valid()) return;
          settled.current.add(run.id);
        }
        update(run.status === "completed" ? null : { ...next, text: "", thinking: "", pendingAction: null });
      } else update(next);
    } catch {
      if (!valid()) return;
      const message = "状态同步失败，已保留执行记录；正在重试。";
      setSyncError(message);
      if (activeRef.current) update({ ...activeRef.current, syncError: message });
    }
  }, [update]);

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
      if (p.source === "reactive" || p.source === "scheduled") optionsRef.current?.onReactiveUpdate?.();
      const current = activeRef.current;
      const conversationId = selectedRef.current ?? current?.conversationId;
      if (!conversationId || (p.conversation_id && p.conversation_id !== conversationId)) return;
      if (typeof p.run_id !== "string") return;
      if (current?.runId && current.runId !== p.run_id) {
        if (TERMINAL.has(current.status)) refresh();
        return;
      }
      if (settled.current.has(p.run_id)) return;
      if (typeof p.revision === "number" && p.revision < (current?.revision ?? 0)) return;
      if (!current && p.conversation_id !== conversationId) return;
      const next = current ?? emptyRun(conversationId, p.run_id);
      update({ ...next, runId: p.run_id,
        revision: typeof p.revision === "number" ? p.revision : next.revision,
        text: next.text + (typeof p.text_delta === "string" ? p.text_delta : ""),
        thinking: next.thinking + (typeof p.thinking_delta === "string" ? p.thinking_delta : ""),
      });
      // Never manufacture an empty approval card or infer a terminal outcome.
      if (p.status || p.pending_action_id) refresh();
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
  }, [reconcile, update]);

  const markPending = useCallback((conversationId: string) => {
    selectedRef.current = conversationId;
    update(emptyRun(conversationId));
  }, [update]);
  const submit = useCallback(async (conversationId: string, request: () => Promise<{ runId: string }>) => {
    markPending(conversationId);
    const epoch = generation.current;
    try {
      const { runId } = await request();
      if (epoch !== generation.current) return runId;
      if (!settled.current.has(runId)) update({ ...(activeRef.current ?? emptyRun(conversationId)), runId });
      await reconcile();
      return runId;
    } catch (error) {
      if (epoch === generation.current) clearActive();
      throw error;
    }
  }, [markPending, update, reconcile, clearActive]);
  const startRun = useCallback((id: string, text: string, modelId?: string) =>
    submit(id, () => sendMessage(id, text, modelId)), [submit]);
  const startEditedRun = useCallback((id: string, messageId: string, text: string) =>
    submit(id, () => editMessage(id, messageId, text)), [submit]);
  const approveAction = useCallback(async (runId: string, actionId: string, approved: boolean) => {
    await decidePendingAction(runId, actionId, approved);
    await reconcile();
  }, [reconcile]);
  return { active, syncError, startRun, startEditedRun, approveAction, clearActive, markPending, reconcile };
}
