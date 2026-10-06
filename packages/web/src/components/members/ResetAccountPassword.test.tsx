// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { ResetAccountPassword } from "./ResetAccountPassword";

const { resetMock } = vi.hoisted(() => ({
  resetMock: vi.fn(),
}));

vi.mock("@/lib/teams-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/teams-api")>();
  return {
    ...actual,
    accountsApi: { ...actual.accountsApi, reset: resetMock },
  };
});

function renderControl(isSelf = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <ResetAccountPassword
          userId="user-1"
          email="member@example.com"
          isSelf={isSelf}
          onSelfReset={() => {}}
        />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("ResetAccountPassword", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
    resetMock.mockResolvedValue({ revokedSessions: 1 });
  });

  it("opens a real dialog with explicit ack wording naming the member", async () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: "重置账号密码" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    // The ack checkbox says exactly what is about to happen, to whom.
    expect(screen.getByText(/我确认要为此成员（member@example.com）重置密码/)).toBeTruthy();

    // Escape semantics come from the Dialog primitive.
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("requires the ack checkbox before submitting", async () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: "重置账号密码" }));
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password-123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password-123" } });
    const submit = screen.getByRole("button", { name: "重置账号密码" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => expect(resetMock).toHaveBeenCalledWith("user-1", "new-password-123"));
  });
});
