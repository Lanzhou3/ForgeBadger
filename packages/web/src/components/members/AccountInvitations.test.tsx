// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { AccountInvitations } from "./AccountInvitations";

const { invitationsMock, inviteMock, revokeMock } = vi.hoisted(() => ({
  invitationsMock: vi.fn(),
  inviteMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock("@/lib/teams-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teams-api")>();
  return {
    ...actual,
    accountsApi: {
      ...actual.accountsApi,
      invitations: invitationsMock,
      invite: inviteMock,
      revoke: revokeMock,
    },
  };
});

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <AccountInvitations actorId="admin-1" />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

const pendingInvite = {
  id: "inv-1",
  code: "ABCD-1234",
  usedByUserId: null,
  usedAt: null,
  expiresAt: "2999-01-01T00:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("AccountInvitations", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    invitationsMock.mockResolvedValue({ invites: [] });
    inviteMock.mockResolvedValue({ invite: pendingInvite });
    revokeMock.mockResolvedValue({});
  });

  it("shows the new invite code with a copy button and its expiry time", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "创建邀请" }));

    const codeInput = await screen.findByDisplayValue("ABCD-1234");
    expect(codeInput).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制邀请码" })).toBeTruthy();
    expect(screen.getByText(/2999/)).toBeTruthy();
  });

  it("copies the invite code to the clipboard", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "创建邀请" }));
    fireEvent.click(await screen.findByRole("button", { name: "复制邀请码" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD-1234")
    );
    await screen.findByRole("button", { name: "已复制" });
  });

  it("confirms before revoking an invitation", async () => {
    invitationsMock.mockResolvedValue({ invites: [pendingInvite] });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "撤销邀请" }));
    expect(revokeMock).not.toHaveBeenCalled();

    await screen.findAllByText(/ABCD-1234/);
    fireEvent.click(screen.getByRole("button", { name: "撤销邀请" }));

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith("inv-1"));
  });
});
