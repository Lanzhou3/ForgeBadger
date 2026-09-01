// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForgotPasswordForm } from "./forgot-password-form";
import { LanguageProvider } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";

const { replaceMock, resetPasswordMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  resetPasswordMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock })
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, resetPassword: resetPasswordMock };
});

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetPasswordMock.mockResolvedValue({
      revokedSessions: true,
      recoveryKeyRotated: true
    });
  });

  function renderForm() {
    return render(
      <LanguageProvider>
        <ForgotPasswordForm />
      </LanguageProvider>
    );
  }

  it("resets the password and returns to the normal sign-in flow", async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("电子邮箱"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.change(screen.getByLabelText("恢复密钥"), {
      target: { value: "fbr_example-recovery-key" }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "new-password-123" }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "new-password-123" }
    });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));

    await waitFor(() => expect(resetPasswordMock).toHaveBeenCalledWith({
      email: "owner@example.com",
      recoveryKey: "fbr_example-recovery-key",
      newPassword: "new-password-123"
    }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login?passwordReset=1"));
  });

  it("rejects mismatched passwords before sending the recovery key", async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("电子邮箱"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.change(screen.getByLabelText("恢复密钥"), {
      target: { value: "fbr_example-recovery-key" }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "new-password-123" }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "different-password" }
    });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));

    await waitFor(() => expect(screen.getByText("两次输入的密码不一致")).toBeTruthy());
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("localizes a rate-limit response instead of exposing the Gateway message", async () => {
    resetPasswordMock.mockRejectedValueOnce(
      new GatewayApiError("Too many requests", 429)
    );
    renderForm();

    fireEvent.change(screen.getByLabelText("电子邮箱"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.change(screen.getByLabelText("恢复密钥"), {
      target: { value: "fbr_example-recovery-key" }
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "new-password-123" }
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "new-password-123" }
    });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));

    await waitFor(() => {
      expect(screen.getByText("尝试次数过多，请稍后再试。")).toBeTruthy();
    });
    expect(screen.queryByText("Too many requests")).toBeNull();
  });
});
