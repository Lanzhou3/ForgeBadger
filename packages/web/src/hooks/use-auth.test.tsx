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
    localStorage.setItem("openforge.token", "session-token");
    localStorage.setItem("openforge.user", JSON.stringify(cachedUser));
  });

  it("keeps the cached session when Gateway validation fails transiently", async () => {
    getMeMock.mockRejectedValue(new Error("Gateway temporarily unavailable"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toEqual(cachedUser);
    expect(localStorage.getItem("openforge.token")).toBe("session-token");
    expect(localStorage.getItem("openforge.user")).toBe(JSON.stringify(cachedUser));
  });

  it("clears the cached session when Gateway explicitly rejects authentication", async () => {
    getMeMock.mockRejectedValue(new GatewayApiError("Unauthorized", 401));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem("openforge.token")).toBeNull();
    expect(localStorage.getItem("openforge.user")).toBeNull();
  });
});
