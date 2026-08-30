// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPENFORGE_GATEWAY_EVENT } from "@/lib/gateway-events";
import { RUN_STALE_TIMEOUT_MS, useCopilotRun } from "@/hooks/use-copilot";
import type { CopilotPendingAction } from "@/lib/copilot-api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { sendMessageMock, editMessageMock, getRunMock, decidePendingActionMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  editMessageMock: vi.fn(),
  getRunMock: vi.fn(),
  decidePendingActionMock: vi.fn(),
}));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    sendMessage: sendMessageMock,
    editMessage: editMessageMock,
    getRun: getRunMock,
    decidePendingAction: decidePendingActionMock,
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
      new CustomEvent(OPENFORGE_GATEWAY_EVENT, {
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
    decidePendingActionMock.mockResolvedValue({ resumed: true, runId: "run-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps deltas that streamed in while the POST was still in flight", async () => {
    const blocked = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blocked.promise);
    const { result } = renderHook(() => useCopilotRun());

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
    const { result } = renderHook(() => useCopilotRun());

    let startPromise!: Promise<string>;
    act(() => {
      startPromise = result.current.startRun("conv-1", "hi");
    });
    // Blocking-POST path: the run completes before the POST responds.
    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "done" });
    dispatchRunUpdated({ run_id: "run-1", status: "completed" });
    expect(result.current.active).toBeNull();

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
    const { result } = renderHook(() => useCopilotRun());

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
    const { result } = renderHook(() => useCopilotRun());

    await act(async () => {
      await result.current.startRun("conv-1", "run the build");
    });

    expect(result.current.active?.status).toBe("awaiting_approval");
    expect(result.current.active?.pendingAction?.id).toBe("act-1");
    expect(result.current.active?.pendingAction?.tool).toBe("run_terminal");
  });

  it("clears a run that goes completely silent via the stale timeout", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopilotRun());

    await act(async () => {
      await result.current.startRun("conv-1", "hi");
    });
    expect(result.current.active?.status).toBe("running");

    act(() => {
      vi.advanceTimersByTime(RUN_STALE_TIMEOUT_MS + 1);
    });

    expect(result.current.active).toBeNull();
  });

  it("never auto-clears an awaiting_approval run", async () => {
    vi.useFakeTimers();
    getRunMock.mockResolvedValue({
      run: { ...runningRun, status: "awaiting_approval" },
      pendingActions: [pendingAction],
    });
    const { result } = renderHook(() => useCopilotRun());

    await act(async () => {
      await result.current.startRun("conv-1", "run the build");
    });
    expect(result.current.active?.status).toBe("awaiting_approval");

    act(() => {
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
    const { result } = renderHook(() => useCopilotRun());

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
    const { result } = renderHook(() => useCopilotRun());

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
    const { result } = renderHook(() => useCopilotRun());

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
