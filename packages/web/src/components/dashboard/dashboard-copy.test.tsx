// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { dashboardHealthDetail, useDashboardCopy } from "./dashboard-copy";

afterEach(() => {
  window.localStorage.removeItem("forgebadger-language");
});

function copyFor(language: string) {
  window.localStorage.setItem("forgebadger-language", language);
  const view = renderHook(() => useDashboardCopy(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <LanguageProvider>{children}</LanguageProvider>
    ),
  });
  const copy = view.result.current;
  view.unmount();
  return copy;
}

describe("dashboardHealthDetail", () => {
  it("maps known health codes in all three languages", () => {
    expect(
      dashboardHealthDetail(copyFor("zh-CN"), "models", "host_environment", "fallback"),
    ).toBe("可选：CLI 会话使用主机环境中配置的模型");
    expect(
      dashboardHealthDetail(copyFor("zh-TW"), "models", "host_environment", "fallback"),
    ).toBe("可選：CLI 會話使用主機環境中設定的模型");
    expect(
      dashboardHealthDetail(copyFor("en"), "models", "host_environment", "fallback"),
    ).toBe("Optional: CLI sessions use models configured in the host environment");
    expect(dashboardHealthDetail(copyFor("zh-CN"), "skills", "create_skill", "fallback")).toBe(
      "创建 Skill",
    );
    expect(dashboardHealthDetail(copyFor("zh-TW"), "projectConfig", "create_project", "fallback")).toBe(
      "建立或匯入專案",
    );
  });

  it("falls back to the Gateway message for unknown codes, items, or older Gateways", () => {
    const copy = copyFor("zh-CN");
    expect(dashboardHealthDetail(copy, "models", "future_code", "Gateway text")).toBe(
      "Gateway text",
    );
    expect(dashboardHealthDetail(copy, "futureItem", "ready", "Gateway text")).toBe(
      "Gateway text",
    );
    expect(dashboardHealthDetail(copy, "models", undefined, "Legacy gateway message")).toBe(
      "Legacy gateway message",
    );
  });
});
