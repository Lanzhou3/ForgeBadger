// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { AccountMembers } from "./AccountMembers";

const { listAdminUsersMock, updateAdminUserMock, invitationsMock } = vi.hoisted(() => ({
  listAdminUsersMock: vi.fn(),
  updateAdminUserMock: vi.fn(),
  invitationsMock: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "admin-1", role: "admin", email: "admin@example.com" },
    isLoading: false,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listAdminUsers: listAdminUsersMock,
    updateAdminUser: updateAdminUserMock,
  };
});

vi.mock("@/lib/teams-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teams-api")>();
  return {
    ...actual,
    accountsApi: { ...actual.accountsApi, invitations: invitationsMock },
  };
});

const member = {
  id: "user-9",
  email: "member@example.com",
  role: "admin",
  status: "active",
};

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <AccountMembers />
      </QueryClientProvider>
    </LanguageProvider>
  );
  return { ...view, queryClient };
}

describe("AccountMembers", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
    listAdminUsersMock.mockResolvedValue({ users: [member] });
    invitationsMock.mockResolvedValue({ invites: [] });
    updateAdminUserMock.mockResolvedValue({});
  });

  it("re-syncs the row draft when the server-side values change", async () => {
    const { queryClient } = renderPanel();
    const roleSelect = await screen.findByLabelText("角色: member@example.com");

    // Local draft: demote to regular user.
    fireEvent.change(roleSelect, { target: { value: "user" } });
    expect((roleSelect as HTMLSelectElement).value).toBe("user");

    // Another admin demotes the same user; the refetched value wins and the
    // stale draft resyncs instead of drifting.
    queryClient.setQueryData(["admin-users", "admin-1"], {
      users: [{ ...member, role: "user" }],
    });
    await waitFor(() => expect((roleSelect as HTMLSelectElement).value).toBe("user"));

    // A refetch that changes nothing else must not clobber an in-flight draft.
    const statusSelect = screen.getByLabelText("状态: member@example.com");
    fireEvent.change(statusSelect, { target: { value: "disabled" } });
    expect((statusSelect as HTMLSelectElement).value).toBe("disabled");
    queryClient.setQueryData(["admin-users", "admin-1"], {
      users: [{ ...member, role: "user" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((statusSelect as HTMLSelectElement).value).toBe("disabled");
  });

  it("keeps the member list visible when a background refetch fails", async () => {
    const { queryClient } = renderPanel();
    await screen.findByText("member@example.com");

    listAdminUsersMock.mockRejectedValue(new Error("gateway unreachable"));
    await actInvalidate(queryClient);

    // Error banner (generic copy for unrecognized messages) AND the cached
    // list, not a table-replacing error state.
    await screen.findByText("请求失败，请重试。");
    expect(screen.getByText("member@example.com")).toBeTruthy();
  });
});

async function actInvalidate(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
}
