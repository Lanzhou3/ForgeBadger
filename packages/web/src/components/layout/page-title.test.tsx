// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import { PageTitle } from "./page-title";

const location = vi.hoisted(() => ({ pathname: "/templates", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));

describe("PageTitle", () => {
  beforeEach(() => {
    location.pathname = "/templates";
    location.search = "";
    window.localStorage.setItem("forgebadger-language", "zh-CN");
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  function renderTitle(client = new QueryClient()) {
    return render(<QueryClientProvider client={client}><LanguageProvider><PageTitle /></LanguageProvider></QueryClientProvider>);
  }

  it("updates localized titles when navigating between pages and settings sections", async () => {
    const view = renderTitle();
    expect(document.title).toBe("模板 · ForgeBadger");
    location.pathname = "/settings";
    location.search = "section=account";
    view.rerender(<QueryClientProvider client={new QueryClient()}><LanguageProvider><PageTitle /></LanguageProvider></QueryClientProvider>);
    expect(document.title).toBe("账号与安全 · 设置 · ForgeBadger");
    location.search = "section=unknown";
    view.rerender(<QueryClientProvider client={new QueryClient()}><LanguageProvider><PageTitle /></LanguageProvider></QueryClientProvider>);
    expect(document.title).toBe("外观与偏好 · 设置 · ForgeBadger");
  });

  it("follows loaded session names and renames without fetching data", async () => {
    const client = new QueryClient();
    location.pathname = "/sessions/session-1";
    renderTitle(client);
    expect(document.title).toBe("会话 · ForgeBadger");
    act(() => client.setQueryData(["session", "session-1"], { session: { name: "修复构建" } }));
    await waitFor(() => expect(document.title).toBe("修复构建 · 会话 · ForgeBadger"));
    act(() => client.setQueryData(["session", "session-1"], { session: { name: "回归验证" } }));
    expect(document.title).toBe("回归验证 · 会话 · ForgeBadger");
    expect(client.isFetching()).toBe(0);
    expect(client.getQueryCache().findAll()).toHaveLength(1);
  });

  it("uses cached project names and honors the English language preference", () => {
    window.localStorage.setItem("forgebadger-language", "en");
    location.pathname = "/projects/project-1";
    const client = new QueryClient();
    client.setQueryData(["project", "project-1"], { project: { name: "Workspace Alpha" } });
    renderTitle(client);
    expect(document.title).toBe("Workspace Alpha · Projects · ForgeBadger");
  });
});
