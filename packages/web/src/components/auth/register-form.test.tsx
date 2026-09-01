// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import { RegisterForm } from "./register-form";

const { registerMock, replaceMock } = vi.hoisted(() => ({
  registerMock: vi.fn(),
  replaceMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock })
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ register: registerMock })
}));

describe("RegisterForm", () => {
  beforeEach(() => {
    registerMock.mockResolvedValue({ code: 0, data: { token: "token", user: {} } });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("requires and submits the local recovery key with localized copy", async () => {
    render(
      <LanguageProvider>
        <RegisterForm />
      </LanguageProvider>
    );

    expect(screen.getByLabelText("恢复密钥")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("电子邮箱"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.change(screen.getByLabelText("恢复密钥"), {
      target: { value: "fbr_registration-key" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password123" }
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "password123" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账户" }));

    await waitFor(() => expect(registerMock).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "password123",
      recoveryKey: "fbr_registration-key"
    }));
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("localizes an invalid recovery key without exposing the Gateway message", async () => {
    registerMock.mockRejectedValueOnce(
      new GatewayApiError("Invalid registration credentials", 401)
    );
    render(
      <LanguageProvider>
        <RegisterForm />
      </LanguageProvider>
    );

    fireEvent.change(screen.getByLabelText("电子邮箱"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.change(screen.getByLabelText("恢复密钥"), {
      target: { value: "wrong-key" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password123" }
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "password123" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账户" }));

    expect(await screen.findByText("恢复密钥无效。")).toBeTruthy();
    expect(screen.queryByText("Invalid registration credentials")).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
