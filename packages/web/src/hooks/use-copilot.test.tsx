// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FORGEBADGER_GATEWAY_EVENT, FORGEBADGER_GATEWAY_CONNECTED } from "@/lib/gateway-events";
import { getTranslation } from "@/lib/i18n";
import { LanguageProvider } from "@/hooks/use-language";
import { RUN_STALE_TIMEOUT_MS, useCopilotRun } from "@/hooks/use-copilot";
import type { CopilotPendingAction } from "@/lib/copilot-api";

afterEach(() => { cleanup(); vi.useRealTimers(); });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

const { sendMessageMock, editMessageMock, getRunMock, listRunsMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  editMessageMock: vi.fn(),
  getRunMock: vi.fn(),
  listRunsMock: vi.fn(),
}));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    sendMessage: sendMessageMock,
    editMessage: editMessageMock,
    getRun: getRunMock,
    listConversationRuns: listRunsMock,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dispatchRunUpdated(payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(FORGEBADGER_GATEWAY_EVENT, {
        detail: { type: "copilot_run_updated", payload },
      })
    );
  });
}

const runningRun = {
  id: "run-1",
  conversationId: "conv-1",
  userId: "user-1",
  status: "running",
  steps: 0,
  createdAt: "2026-05-22T00:00:00.000Z",
  updatedAt: "2026-05-22T00:00:00.000Z",
};

const pendingAction: CopilotPendingAction = {
  id: "act-1",
  runId: "run-1",
  userId: "user-1",
  tool: "run_terminal",
  inputJson: "{}",
  inputDigest: "digest",
  status: "pending",
  createdAt: "2026-05-22T00:00:00.000Z",
  updatedAt: "2026-05-22T00:00:00.000Z",
};

describe("useCopilotRun streaming reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock.mockResolvedValue({ runId: "run-1" });
    editMessageMock.mockResolvedValue({ runId: "run-1" });
    getRunMock.mockResolvedValue({ run: runningRun, pendingActions: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps deltas that streamed in while the POST was still in flight", async () => {
    const blocked = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blocked.promise);
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    let startPromise!: Promise<string>;
    act(() => {
      startPromise = result.current.startRun("conv-1", "hi");
    });
    // Deltas arrive before the POST returns the runId.
    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "Hello" });
    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: " world" });

    await act(async () => {
      blocked.resolve({ runId: "run-1" });
      await startPromise;
    });

    // startRun must not wipe the already-streamed text with a fresh state.
    expect(result.current.active?.text).toBe("Hello world");
    expect(result.current.active?.status).toBe("running");
  });

  it("does not resurrect a finished run when the terminal event landed before the POST returned", async () => {
    const blocked = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blocked.promise);
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    let startPromise!: Promise<string>;
    act(() => {
      startPromise = result.current.startRun("conv-1", "hi");
    });
    getRunMock.mockResolvedValue({ run: { ...runningRun, status: "completed" }, pendingActions: [] });
    // Blocking-POST path: the run completes before the POST responds.
    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "done" });
    dispatchRunUpdated({ run_id: "run-1", status: "completed" });
    await act(async () => {});

    await act(async () => {
      blocked.resolve({ runId: "run-1" });
      await startPromise;
    });

    // Regression guard: previously this left a stuck "running" bubble forever.
    expect(result.current.active).toBeNull();
  });

  it("reconciles against GET /runs/:id when the terminal event was missed entirely", async () => {
    getRunMock.mockResolvedValue({
      run: { ...runningRun, status: "completed" },
      pendingActions: [],
    });
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    await act(async () => {
      await result.current.startRun("conv-1", "hi");
    });

    expect(getRunMock).toHaveBeenCalledWith("run-1");
    expect(result.current.active).toBeNull();
  });

  it("adopts the server pending action when the WS frame raced past", async () => {
    getRunMock.mockResolvedValue({
      run: { ...runningRun, status: "awaiting_approval" },
      pendingActions: [pendingAction],
    });
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    await act(async () => {
      await result.current.startRun("conv-1", "run the build");
    });

    expect(result.current.active?.status).toBe("awaiting_approval");
    expect(result.current.active?.pendingAction?.id).toBe("act-1");
    expect(result.current.active?.pendingAction?.tool).toBe("run_terminal");
  });

  it("maps a known gateway error code to user-readable text without the raw code", async () => {
    window.localStorage.setItem("forgebadger-language", "en");
    getRunMock.mockResolvedValue({
      run: { ...runningRun, status: "failed", error: "AGENT_NO_MODEL" },
      pendingActions: [],
    });
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    await act(async () => {
      await result.current.startRun("conv-1", "hi");
    });

    expect(result.current.active?.status).toBe("failed");
    expect(result.current.active?.error).toBe(getTranslation("en", "copilot.error.noModel"));
    expect(result.current.active?.error).not.toContain("AGENT_NO_MODEL");
    expect(result.current.active?.errorCode).toBeUndefined();
    window.localStorage.removeItem("forgebadger-language");
  });

  it("falls back to generic text and keeps the raw code for unknown codes", async () => {
    window.localStorage.setItem("forgebadger-language", "en");
    getRunMock.mockResolvedValue({
      run: { ...runningRun, status: "failed", error: "SOME_FUTURE_CODE" },
      pendingActions: [],
    });
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    await act(async () => {
      await result.current.startRun("conv-1", "hi");
    });

    expect(result.current.active?.error).toBe(getTranslation("en", "copilot.error.unknown"));
    expect(result.current.active?.error).not.toContain("SOME_FUTURE_CODE");
    expect(result.current.active?.errorCode).toBe("SOME_FUTURE_CODE");
    window.localStorage.removeItem("forgebadger-language");
  });

  it("uses the default failure text when the run carries no reason", async () => {
    window.localStorage.setItem("forgebadger-language", "en");
    getRunMock.mockResolvedValue({
      run: { ...runningRun, status: "failed" },
      pendingActions: [],
    });
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    await act(async () => {
      await result.current.startRun("conv-1", "hi");
    });

    expect(result.current.active?.error).toBe(getTranslation("en", "copilot.terminal.failedDefault"));
    expect(result.current.active?.errorCode).toBeUndefined();
    window.localStorage.removeItem("forgebadger-language");
  });

  it("retains facts and marks an unreachable run as awaiting synchronization", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    await act(async () => {
      await result.current.startRun("conv-1", "hi");
    });
    expect(result.current.active?.status).toBe("running");

    getRunMock.mockRejectedValue(new Error("offline"));
    await act(async () => { vi.advanceTimersByTime(RUN_STALE_TIMEOUT_MS + 1); });
    expect(result.current.active?.status).toBe("running");
    expect(result.current.active?.syncError).toBeTruthy();
  });

  it("never auto-clears an awaiting_approval run", async () => {
    vi.useFakeTimers();
    getRunMock.mockResolvedValue({
      run: { ...runningRun, status: "awaiting_approval" },
      pendingActions: [pendingAction],
    });
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    await act(async () => {
      await result.current.startRun("conv-1", "run the build");
    });
    expect(result.current.active?.status).toBe("awaiting_approval");

    await act(async () => {
      vi.advanceTimersByTime(RUN_STALE_TIMEOUT_MS + 1);
    });

    expect(result.current.active?.pendingAction?.id).toBe("act-1");
  });
});

describe("useCopilotRun optimistic pending state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock.mockResolvedValue({ runId: "run-1" });
    getRunMock.mockResolvedValue({ run: runningRun, pendingActions: [] });
  });

  it("shows the pending state the instant startRun is called, before the POST answers", async () => {
    const blocked = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blocked.promise);
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    let startPromise!: Promise<string>;
    act(() => {
      startPromise = result.current.startRun("conv-1", "hi");
    });

    // No await, no event: the thinking indicator must already be renderable.
    expect(result.current.active?.status).toBe("pending");
    expect(result.current.active?.conversationId).toBe("conv-1");
    expect(result.current.active?.text).toBe("");

    await act(async () => {
      blocked.resolve({ runId: "run-1" });
      await startPromise;
    });
    expect(result.current.active?.status).toBe("running");
    expect(result.current.active?.runId).toBe("run-1");
  });

  it("drops the pending state immediately when the POST fails", async () => {
    const blocked = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blocked.promise);
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    let startPromise!: Promise<string>;
    act(() => {
      startPromise = result.current.startRun("conv-1", "hi");
    });
    expect(result.current.active?.status).toBe("pending");

    await act(async () => {
      blocked.reject(new Error("gateway down"));
      await startPromise.catch(() => undefined);
    });

    expect(result.current.active).toBeNull();
  });

  it("keeps deltas that arrive while the placeholder is still pending", async () => {
    const blocked = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blocked.promise);
    const { result } = renderHook(() => useCopilotRun(), { wrapper });

    let startPromise!: Promise<string>;
    act(() => {
      startPromise = result.current.startRun("conv-1", "hi");
    });
    expect(result.current.active?.status).toBe("pending");

    // The first frame lands before the POST returns: it folds onto the
    // placeholder and adopts the real runId from the payload.
    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "Hello" });
    expect(result.current.active?.text).toBe("Hello");
    expect(result.current.active?.runId).toBe("run-1");

    await act(async () => {
      blocked.resolve({ runId: "run-1" });
      await startPromise;
    });
    expect(result.current.active?.text).toBe("Hello");
    expect(result.current.active?.status).toBe("running");
  });
});


describe("durable conversation restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRunsMock.mockResolvedValue({ runs: [runningRun], activeRun: runningRun });
    getRunMock.mockResolvedValue({ run: { ...runningRun, status: "awaiting_approval", revision: 3 }, pendingActions: [pendingAction] });
  });
  it("restores a persisted pending action on mount", async () => {
    const { result } = renderHook(() => useCopilotRun({ conversationId: "conv-1" }), { wrapper });
    await act(async () => {});
    expect(result.current.active?.pendingAction?.inputDigest).toBe("digest");
    getRunMock.mockResolvedValue({ run: { ...runningRun, status: "pending", revision: 4 }, pendingActions: [] });
    await act(async () => { await result.current.reconcile(); });
    expect(result.current.active?.status).toBe("pending");
    expect(result.current.active?.pendingAction).toBeNull();
  });
  it("rejects foreign conversation and older revision events", async () => {
    const { result } = renderHook(() => useCopilotRun({ conversationId: "conv-1" }), { wrapper });
    await act(async () => {});
    dispatchRunUpdated({ run_id: "run-1", conversation_id: "conv-2", revision: 5, text_delta: "foreign" });
    dispatchRunUpdated({ run_id: "run-1", conversation_id: "conv-1", revision: 2, text_delta: "old" });
    expect(result.current.active?.text).toBe("");
  });
  it("refreshes persisted messages at terminal status and removes streamed duplication", async () => {
    const onSettled = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCopilotRun({ conversationId: "conv-1", onSettled }), { wrapper });
    await act(async () => {});
    getRunMock.mockResolvedValue({ run: { ...runningRun, status: "indeterminate", revision: 4, stopReason: "unknown_effect" }, pendingActions: [] });
    await act(async () => { await result.current.reconcile(); });
    expect(onSettled).toHaveBeenCalledWith("conv-1");
    expect(result.current.active?.text).toBe("");
    expect(result.current.active?.error).toContain("确认");
  });
  it("reconciles full approval details when the shared socket reconnects", async () => {
    const { result } = renderHook(() => useCopilotRun({ conversationId: "conv-1" }), { wrapper });
    await act(async () => {});
    getRunMock.mockResolvedValue({ run: { ...runningRun, status: "awaiting_approval", revision: 4 }, pendingActions: [{ ...pendingAction, inputJson: '{"project":"P"}', inputDigest: "updated" }] });
    await act(async () => { window.dispatchEvent(new Event(FORGEBADGER_GATEWAY_CONNECTED)); });
    expect(result.current.active?.pendingAction?.inputDigest).toBe("updated");
    expect(result.current.active?.pendingAction?.inputJson).toContain("project");
  });
  it("ignores an old conversation response after switching conversations", async () => {
    const old = deferred<{ run: typeof runningRun; pendingActions: CopilotPendingAction[] }>();
    getRunMock.mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(({ id }) => useCopilotRun({ conversationId: id }), { initialProps: { id: "conv-1" }, wrapper });
    await act(async () => {});
    const second = { ...runningRun, id: "run-2", conversationId: "conv-2", revision: 2 };
    listRunsMock.mockResolvedValue({ runs: [second], activeRun: second });
    getRunMock.mockResolvedValue({ run: second, pendingActions: [] });
    rerender({ id: "conv-2" });
    await act(async () => {});
    await act(async () => { old.resolve({ run: runningRun, pendingActions: [pendingAction] }); });
    expect(result.current.active?.runId).toBe("run-2");
    expect(result.current.active?.pendingAction).toBeNull();
  });

  it("discovers another client's run after a retained terminal outcome, comparing revisions per run", async () => {
    getRunMock.mockResolvedValue({ run: { ...runningRun, status: "failed", revision: 90 }, pendingActions: [] });
    const { result } = renderHook(() => useCopilotRun({ conversationId: "conv-1" }), { wrapper });
    await act(async () => {});
    expect(result.current.active?.status).toBe("failed");
    const newer = { ...runningRun, id: "run-2", status: "awaiting_approval", revision: 2 };
    listRunsMock.mockResolvedValue({ runs: [newer, runningRun], activeRun: newer });
    getRunMock.mockResolvedValue({ run: newer, pendingActions: [{ ...pendingAction, runId: "run-2" }] });
    await act(async () => { await result.current.reconcile(); });
    expect(result.current.active?.runId).toBe("run-2");
    expect(result.current.active?.revision).toBe(2);
    expect(result.current.active?.pendingAction?.inputDigest).toBe("digest");
  });

  it("does not replace a pending submission with the previous completed run during polling", async () => {
    vi.useFakeTimers();
    const blocked = deferred<{ runId: string }>();
    const old = { ...runningRun, status: "completed" };
    listRunsMock.mockResolvedValue({ runs: [old], activeRun: null });
    getRunMock.mockResolvedValue({ run: old, pendingActions: [] });
    sendMessageMock.mockReturnValueOnce(blocked.promise);
    const { result } = renderHook(() => useCopilotRun({ conversationId: "conv-1" }), { wrapper });
    await act(async () => {});
    let request!: Promise<string>;
    act(() => { request = result.current.startRun("conv-1", "new question"); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(result.current.active?.status).toBe("pending");
    getRunMock.mockResolvedValue({ run: { ...runningRun, id: "run-2" }, pendingActions: [] });
    await act(async () => { blocked.resolve({ runId: "run-2" }); await request; });
    expect(result.current.active?.runId).toBe("run-2");
    vi.useRealTimers();
  });

  it("refreshes durable messages for a late task report without reviving a settled run", async () => {
    const onSettled = vi.fn().mockResolvedValue(undefined);
    getRunMock.mockResolvedValue({ run: { ...runningRun, status: "completed", revision: 3 }, pendingActions: [] });
    const { result } = renderHook(() => useCopilotRun({ conversationId: "conv-1", onSettled }), { wrapper });
    await act(async () => {});
    expect(result.current.active).toBeNull();
    const previousCalls = onSettled.mock.calls.length;
    dispatchRunUpdated({ run_id: "run-1", conversation_id: "conv-1", status: "completed", revision: 3, message: "CLI task completed" });
    await act(async () => {});
    expect(onSettled.mock.calls.length).toBeGreaterThan(previousCalls);
    expect(result.current.active).toBeNull();
  });

  it("refreshes messages during reconciliation even if a late report event was lost", async () => {
    const onSettled = vi.fn().mockResolvedValue(undefined);
    getRunMock.mockResolvedValue({ run: { ...runningRun, status: "completed" }, pendingActions: [] });
    const { result } = renderHook(() => useCopilotRun({ conversationId: "conv-1", onSettled }), { wrapper });
    await act(async () => {});
    const previousCalls = onSettled.mock.calls.length;
    await act(async () => { await result.current.reconcile(); });
    expect(onSettled.mock.calls.length).toBeGreaterThan(previousCalls);
  });

  it("deduplicates ordered stream frames across reconnects and ignores superseded fences", async () => {
    const { result,unmount }=renderHook(()=>useCopilotRun(), { wrapper });
    await act(async()=>{await result.current.startRun('conv-1','hello');});
    const frame=(fence:number,sequence:number,text:string)=>({run_id:'run-1',conversation_id:'conv-1',text_step_id:'model-step',text_fence:fence,text_sequence:sequence,text_delta:text});
    dispatchRunUpdated(frame(1,1,'first '));dispatchRunUpdated(frame(1,3,'third'));dispatchRunUpdated(frame(1,2,'second '));
    dispatchRunUpdated(frame(1,1,'first '));expect(result.current.active?.text).toBe('first second third');
    await act(async()=>{window.dispatchEvent(new Event(FORGEBADGER_GATEWAY_CONNECTED));});
    dispatchRunUpdated(frame(1,3,'third'));expect(result.current.active?.text).toBe('first second third');
    dispatchRunUpdated(frame(2,1,'replacement'));dispatchRunUpdated(frame(1,4,'stale'));
    expect(result.current.active?.text).toBe('replacement');
    dispatchRunUpdated({...frame(3,1,' next'),text_step_id:'new-step'});
    dispatchRunUpdated({...frame(2,1,' stale'),text_step_id:'unknown-old-step'});
    expect(result.current.active?.text).toBe('replacement next');unmount();
  });

});

it('does not fetch REST state per unchanged-status delta and coalesces state transitions', async () => {
  getRunMock.mockResolvedValue({ run: { ...runningRun, revision: 1 }, pendingActions: [] });
  sendMessageMock.mockResolvedValue({ runId: 'run-1' });
  const { result } = renderHook(() => useCopilotRun(), { wrapper });
  await act(async () => { await result.current.startRun('conv-1','hi'); });
  getRunMock.mockClear();
  for(let sequence=1;sequence<=100;sequence++) dispatchRunUpdated({ run_id:'run-1',status:'running',revision:1,text_step_id:'step',text_fence:1,text_sequence:sequence,text_delta:'a' });
  await act(async () => {});
  expect(result.current.active?.text).toBe('a'.repeat(100));
  expect(getRunMock).not.toHaveBeenCalled();
  getRunMock.mockResolvedValue({ run: {...runningRun,status:'awaiting_approval',revision:2},pendingActions:[pendingAction] });
  for(let i=0;i<20;i++) dispatchRunUpdated({run_id:'run-1',status:'awaiting_approval',revision:2,pending_action_id:pendingAction.id});
  await act(async () => {});
  expect(getRunMock).toHaveBeenCalledTimes(1);
  expect(result.current.active?.pendingAction?.id).toBe(pendingAction.id);
});

it('reconciles a sequence gap with the safe server snapshot and keeps streaming', async () => {
  getRunMock.mockResolvedValue({ run: { ...runningRun, revision: 1 }, pendingActions: [] });
  sendMessageMock.mockResolvedValue({ runId: 'run-1' });
  const { result } = renderHook(() => useCopilotRun(), { wrapper });
  await act(async () => { await result.current.startRun('conv-1','hi'); });
  getRunMock.mockClear();
  getRunMock.mockResolvedValue({run:{...runningRun,revision:1},pendingActions:[],provisionalText:{steps:[{stepId:'step',fence:1,sequence:2,text:'one two '}]} });
  dispatchRunUpdated({run_id:'run-1',status:'running',revision:1,text_step_id:'step',text_fence:1,text_sequence:1,text_delta:'one '});
  dispatchRunUpdated({run_id:'run-1',status:'running',revision:1,text_step_id:'step',text_fence:1,text_sequence:3,text_delta:'three '});
  await act(async () => {});
  expect(getRunMock).toHaveBeenCalledTimes(1);
  expect(result.current.active?.text).toBe('one two three ');
  dispatchRunUpdated({run_id:'run-1',status:'running',revision:1,text_step_id:'step',text_fence:1,text_sequence:4,text_delta:'four'});
  expect(result.current.active?.text).toBe('one two three four');
});

it('coalesces reactive conversation-list updates rather than refreshing per text chunk', async () => {
  const onReactiveUpdate=vi.fn();
  getRunMock.mockResolvedValue({run:{...runningRun,revision:1},pendingActions:[]});
  sendMessageMock.mockResolvedValue({runId:'run-1'});
  const { result }=renderHook(()=>useCopilotRun({onReactiveUpdate}),{wrapper});
  await act(async()=>{await result.current.startRun('conv-1','hi');});
  for(let sequence=1;sequence<=100;sequence++)dispatchRunUpdated({run_id:'run-1',source:'reactive',status:'running',revision:1,text_step_id:'step',text_fence:1,text_sequence:sequence,text_delta:'a'});
  await act(async()=>{});
  expect(onReactiveUpdate).toHaveBeenCalledTimes(1);
});
