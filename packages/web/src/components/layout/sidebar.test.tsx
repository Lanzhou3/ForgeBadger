// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "@/hooks/use-language";
import { Sidebar } from "./sidebar";

const { useAuthMock, useNotificationsMock, usePathnameMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useNotificationsMock: vi.fn(),
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => useNotificationsMock(),
}));

function renderSidebar() {
  return render(
    <LanguageProvider>
      <Sidebar />
    </LanguageProvider>
  );
}

describe("Sidebar mobile trigger", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    useAuthMock.mockReturnValue({ user: { email: "dev@example.com", role: "admin" }, logout: vi.fn() });
    useNotificationsMock.mockReturnValue({ unreadCount: 0, notifications: [] });
    usePathnameMock.mockReturnValue("/");
  });

  it("gives the hamburger a localized label and a visible card background", () => {
    renderSidebar();

    const trigger = screen.getByRole("button", { name: "打开导航" });
    expect(trigger.className).toContain("bg-card");
    expect(trigger.className).toContain("shadow-md");
  });

  it("localizes the sheet title inside the opened mobile navigation", () => {
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));

    const title = screen.getByText("ForgeBadger 导航");
    expect(title.className).toContain("sr-only");
  });

  it("marks the current nav link with aria-current", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: "控制台" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "项目" }).getAttribute("aria-current")).toBeNull();
  });

  it("gives nav links a focus-visible ring", () => {
    renderSidebar();

    for (const label of ["控制台", "项目", "设置"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link.className).toContain("focus-visible:ring-2");
      expect(link.className).toContain("focus-visible:ring-ring");
    }
  });

  it("keeps group labels at a readable contrast while preserving hierarchy", () => {
    renderSidebar();

    const groupLabel = screen.getByText("工作区");
    expect(groupLabel.className).toContain("text-muted-foreground/70");
    expect(groupLabel.className).not.toContain("text-muted-foreground/50");
  });

  it("exposes stable hooks for session focus-mode chrome hiding", () => {
    renderSidebar();

    expect(document.querySelector("[data-app-sidebar]")).toBeTruthy();
    expect(document.querySelector("[data-app-sidebar-trigger]")).toBeTruthy();
  });
});
