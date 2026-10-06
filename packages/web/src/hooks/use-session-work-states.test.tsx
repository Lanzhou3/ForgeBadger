// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SessionWorkState } from "@/lib/api";
import { FORGEBADGER_GATEWAY_CONNECTED, FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import { useSessionWorkStates } from "./use-session-work-states";

const { snapshotMock } = vi.hoisted(() => ({ snapshotMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ getSessionWorkStates: snapshotMock }));
beforeEach(() => { snapshotMock.mockReset(); });
afterEach(cleanup);

it("keeps newer lifecycle events when an older snapshot finishes and repairs missed completion on reconnect", async () => {
  let resolveSnapshot!: (data: { states: SessionWorkState[]; snapshotAt: number }) => void;
  snapshotMock.mockImplementationOnce(() => new Promise(resolve => { resolveSnapshot = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(useSessionWorkStates, { wrapper: ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  act(() => window.dispatchEvent(new CustomEvent(FORGEBADGER_GATEWAY_EVENT, { detail: {
    type: "session_work_state_changed", payload: { session_id: "s1", state: "working", updated_at: 20 },
  } })));
  expect(result.current.get("s1")?.state).toBe("working");
  await act(async () => resolveSnapshot({ states: [{ sessionId: "s1", state: "idle", updatedAt: 10 }], snapshotAt: 10 }));
  expect(result.current.get("s1")?.state).toBe("working");
  snapshotMock.mockResolvedValue({ states: [{ sessionId: "s1", state: "idle", updatedAt: 30 }], snapshotAt: 30 });
  act(() => window.dispatchEvent(new Event(FORGEBADGER_GATEWAY_CONNECTED)));
  await waitFor(() => expect(result.current.get("s1")?.state).toBe("idle"));
  expect(snapshotMock).toHaveBeenCalledTimes(2);
  act(() => window.dispatchEvent(new CustomEvent(FORGEBADGER_GATEWAY_EVENT, { detail: {
    type: "session_work_state_changed", payload: { session_id: "s1", state: "working", updated_at: "bad" },
  } })));
  expect(result.current.get("s1")?.state).toBe("idle");
  client.clear();
});
