// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useTerminalWriter } from "./use-terminal-writer";
import * as api from "@/lib/platform-actions-api";
vi.mock("@/lib/platform-actions-api", () => ({
  getSessionWriter: vi.fn(),
  takeoverSession: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(() => useTerminalWriter("s1"), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
it("blocks while loading/automated and unlocks only after confirmed takeover and refreshed authority", async () => {
  vi.mocked(api.getSessionWriter).mockResolvedValue({
    sessionId: "s1",
    mode: "automated",
    autonomy: "manual_only",
  });
  vi.mocked(api.takeoverSession).mockImplementation(async () => {
    vi.mocked(api.getSessionWriter).mockResolvedValue({
      sessionId: "s1",
      mode: "manual",
      autonomy: "manual_only",
    });
    return { sessionId: "s1", takenOver: true };
  });
  const { result } = mount();
  expect(result.current.readOnly).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.readOnly).toBe(true);
  act(() => result.current.takeover());
  await waitFor(() => expect(result.current.readOnly).toBe(false));
  expect(api.takeoverSession).toHaveBeenCalledWith("s1");
});
it("retains read-only and failure feedback after failed takeover", async () => {
  vi.mocked(api.getSessionWriter).mockResolvedValue({
    sessionId: "s1",
    mode: "automated",
    autonomy: "manual_only",
  });
  vi.mocked(api.takeoverSession).mockRejectedValue(
    new Error("takeover denied"),
  );
  const { result } = mount();
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.takeover());
  await waitFor(() =>
    expect(result.current.error?.message).toBe("takeover denied"),
  );
  expect(result.current.readOnly).toBe(true);
});
