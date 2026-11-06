// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/use-auth";
import { GatewayApiError } from "@/lib/api";

const { getMeMock } = vi.hoisted(() => ({
  getMeMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getMe: getMeMock,
  };
});

const cachedUser = {
  id: "user-1",
  email: "user@example.com",
  role: "admin",
  status: "active",
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useAuth session validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("forgebadger.token", "session-token");
    localStorage.setItem("forgebadger.user", JSON.stringify(cachedUser));
  });

  it("keeps the cached session when Gateway validation fails transiently", async () => {
    getMeMock.mockRejectedValue(new Error("Gateway temporarily unavailable"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.user).toEqual(cachedUser);
    expect(localStorage.getItem("forgebadger.token")).toBe("session-token");
    expect(localStorage.getItem("forgebadger.user")).toBe(JSON.stringify(cachedUser));
  });

  it("clears the cached session when Gateway explicitly rejects authentication", async () => {
    getMeMock.mockRejectedValue(new GatewayApiError("Unauthorized", 401));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem("forgebadger.token")).toBeNull();
    expect(localStorage.getItem("forgebadger.user")).toBeNull();
  });

  it("renders the cached user immediately while server validation is in flight", async () => {
    let resolveValidation: (value: { code: number; data: typeof cachedUser }) => void = () => undefined;
    getMeMock.mockImplementation(
      () => new Promise((resolve) => { resolveValidation = resolve; })
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    // No loading gate: the cached user is available on the first render.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toEqual(cachedUser);
    expect(result.current.isFetching).toBe(true);

    resolveValidation({ code: 0, data: { ...cachedUser, email: "fresh@example.com" } });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.user?.email).toBe("fresh@example.com");
  });
});
