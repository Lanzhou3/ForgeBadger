// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";
import { LanguageProvider } from "@/hooks/use-language";
import { GatewayApiError, gatewayBaseUrl } from "@/lib/api";

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ login: loginMock })
}));

describe("LoginForm", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderForm() {
    return render(
      <LanguageProvider>
        <LoginForm />
      </LanguageProvider>
    );
  }

  it("offers the local account recovery flow", () => {
    renderForm();

    expect(screen.getByLabelText("电子邮箱")).toBeTruthy();
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "忘记密码？" });
    expect(link.getAttribute("href")).toBe("/forgot-password");
  });

  it("does not expose an English transport error on the localized form", async () => {
    loginMock.mockRejectedValueOnce(new Error("Gateway request failed"));
    renderForm();

    fireEvent.change(screen.getByLabelText("电子邮箱"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "wrong-password" }
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(screen.getByText("登录失败，请检查邮箱和密码。")).toBeTruthy();
    });
    expect(screen.queryByText("Gateway request failed")).toBeNull();
  });

  it("shows the unreachable-gateway message with the target address instead of a credential hint", async () => {
    loginMock.mockRejectedValueOnce(
      new GatewayApiError(`Cannot reach the Gateway at ${gatewayBaseUrl}.`, undefined, {
        code: "GATEWAY_UNREACHABLE"
      })
    );
    renderForm();

    fireEvent.change(screen.getByLabelText("电子邮箱"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "any-password" }
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(
        screen.getByText(`无法连接到 Gateway（${gatewayBaseUrl}），请确认 Gateway 已启动且端口配置正确。`)
      ).toBeTruthy();
    });
    expect(screen.queryByText("登录失败，请检查邮箱和密码。")).toBeNull();
  });
});
