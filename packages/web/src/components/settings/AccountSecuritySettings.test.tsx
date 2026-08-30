// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import {
  AccountSecuritySettings
} from "@/components/settings/AccountSecuritySettings";

const { listAuthSessionsMock, revokeAuthSessionMock, revokeOtherAuthSessionsMock, changePasswordMock } =
  vi.hoisted(() => ({
    listAuthSessionsMock: vi.fn(),
    revokeAuthSessionMock: vi.fn(),
    revokeOtherAuthSessionsMock: vi.fn(),
    changePasswordMock: vi.fn()
  }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listAuthSessions: listAuthSessionsMock,
    revokeAuthSession: revokeAuthSessionMock,
    revokeOtherAuthSessions: revokeOtherAuthSessionsMock,
    changePassword: changePasswordMock
  };
});

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPanel() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <AccountSecuritySettings />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

const baseSessions = [
  {
    id: "session-current",
    createdAt: "2026-08-19T10:00:00.000Z",
    lastSeenAt: "2026-08-19T11:00:00.000Z",
    expiresAt: "2026-08-26T10:00:00.000Z",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0",
    current: true
  },
  {
    id: "session-other",
    createdAt: "2026-08-18T08:00:00.000Z",
    lastSeenAt: "2026-08-18T09:00:00.000Z",
    expiresAt: "2026-08-25T08:00:00.000Z",
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Firefox/128.0",
    current: false
  }
];

describe("AccountSecuritySettings", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    listAuthSessionsMock.mockResolvedValue({ sessions: baseSessions });
  });

  it("lists signed-in devices and marks the current one", async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByText("macOS · Chrome")).toBeTruthy());
    expect(screen.getByText("Windows · Firefox")).toBeTruthy();
    expect(screen.getByText("当前设备")).toBeTruthy();
    // The current session row has no revoke button; the other one does.
    expect(screen.getByText("吊销")).toBeTruthy();
  });

  it("keeps the change-password submit disabled until all fields are filled", async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByText("macOS · Chrome")).toBeTruthy());
    const submit = screen.getByRole("button", { name: "修改密码" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password-123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password-123" } });
    expect(submit.disabled).toBe(false);
  });

  it("rejects mismatched confirmation password before calling the API", async () => {
    renderPanel();

    await waitFor(() => expect(screen.getByText("macOS · Chrome")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password-123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    expect(screen.getByText("两次输入的新密码不一致。")).toBeTruthy();
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("shows a server error message when the current password is wrong", async () => {
    changePasswordMock.mockRejectedValue(new Error("Current password is incorrect"));
    renderPanel();

    await waitFor(() => expect(screen.getByText("macOS · Chrome")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "wrong" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password-123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() => expect(changePasswordMock).toHaveBeenCalledWith("wrong", "new-password-123"));
    await waitFor(() => expect(screen.getByText("Current password is incorrect")).toBeTruthy());
  });

  it("revokes another device session and refreshes the list", async () => {
    revokeAuthSessionMock.mockResolvedValue({ revoked: 1 });
    renderPanel();

    await waitFor(() => expect(screen.getByText("Windows · Firefox")).toBeTruthy());
    fireEvent.click(screen.getByText("吊销"));

    await waitFor(() => expect(revokeAuthSessionMock).toHaveBeenCalledWith("session-other"));
    await waitFor(() => expect(listAuthSessionsMock).toHaveBeenCalledTimes(2));
  });

  it("signs out other devices in bulk from the header action", async () => {
    revokeOtherAuthSessionsMock.mockResolvedValue({ revoked: 1 });
    renderPanel();

    const bulkButton = await screen.findByRole("button", { name: "退出其他设备" });
    fireEvent.click(bulkButton);

    await waitFor(() => expect(revokeOtherAuthSessionsMock).toHaveBeenCalled());
  });
});
