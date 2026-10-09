// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import type { StoredNotification } from "@/lib/notifications";
import NotificationsPage from "./page";

const { reloadNotificationsMock, notificationsRef, initialLoadErrorRef, clearNotificationsMock } = vi.hoisted(() => ({
  reloadNotificationsMock: vi.fn(),
  clearNotificationsMock: vi.fn(),
  notificationsRef: { value: [] as StoredNotification[] },
  initialLoadErrorRef: { value: true },
}));

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    notifications: notificationsRef.value,
    unreadCount: notificationsRef.value.filter((notification) => !notification.read).length,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    clearNotifications: clearNotificationsMock,
    initialLoadError: initialLoadErrorRef.value,
    reloadNotifications: reloadNotificationsMock,
  }),
}));

function makeNotification(overrides: Partial<StoredNotification>): StoredNotification {
  return {
    id: "n1",
    type: "session_notification",
    category: "session_event",
    titleKey: "notifications.taskCompleted",
    message: "Task finished",
    createdAt: new Date().toISOString(),
    href: "/sessions/s1",
    read: true,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <LanguageProvider>
      <NotificationsPage />
    </LanguageProvider>
  );
}

describe("NotificationsPage initial load failure", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    notificationsRef.value = [];
    initialLoadErrorRef.value = true;
    window.localStorage.setItem("forgebadger-language", "zh-CN");
  });

  it("shows the error state with retry instead of the empty notifications card", async () => {
    renderPage();

    await screen.findByText("加载失败");
    expect(screen.queryByText("暂无通知")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(reloadNotificationsMock).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationsPage polish", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    initialLoadErrorRef.value = false;
    window.localStorage.setItem("forgebadger-language", "zh-CN");
  });

  it("asks for confirmation before clearing all notifications", async () => {
    notificationsRef.value = [makeNotification({ id: "n1" })];
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    const dialog = await screen.findByRole("dialog");
    // Nothing is cleared before the user confirms.
    expect(clearNotificationsMock).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("不可撤销");

    fireEvent.click(within(dialog).getByRole("button", { name: "清空" }));
    expect(clearNotificationsMock).toHaveBeenCalledTimes(1);
  });

  it("distinguishes the filtered empty state from the never-had-notifications one", async () => {
    notificationsRef.value = [makeNotification({ id: "n1", category: "session_event" })];
    renderPage();

    // With notifications present, the generic "暂无通知" empty state must not show.
    expect(screen.queryByText("暂无通知")).toBeNull();

    // Radix tabs activate on mouseDown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "应用操作" }), { button: 0, ctrlKey: false });
    await screen.findByText("该分类暂无通知");
    expect(screen.queryByText("会话状态变化和各个 Code CLI 的关键事件会显示在这里。")).toBeNull();
  });

  it("shows the never-had-notifications empty state only when the list is empty", async () => {
    notificationsRef.value = [];
    renderPage();

    await screen.findByText("暂无通知");
    // Radix tabs activate on mouseDown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "会话事件" }), { button: 0, ctrlKey: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Still the generic empty state: there is nothing to filter.
    expect(screen.queryByText("该分类暂无通知")).toBeNull();
  });

  it("paginates the list client-side with a load-more control", async () => {
    const now = Date.now();
    notificationsRef.value = Array.from({ length: 120 }, (_, index) =>
      makeNotification({
        id: `n${index}`,
        createdAt: new Date(now - index * 60_000).toISOString(),
        message: `message-${index}`,
      })
    );
    renderPage();

    // First page: 50 rows, load-more visible with the showing count.
    await screen.findByText("message-0");
    expect(screen.queryByText("message-50")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await screen.findByText("message-50");
    expect(screen.queryByText("message-100")).toBeNull();
    expect(screen.getByText("已显示 100 / 120 条")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await screen.findByText("message-119");
    // Everything is shown: the load-more control (and its count) is gone.
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
    expect(screen.queryByText(/已显示/)).toBeNull();
  });

  it("renders relative timestamps instead of the verbose locale string", async () => {
    notificationsRef.value = [
      makeNotification({ id: "n1", createdAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
    ];
    renderPage();

    await screen.findByText("Task finished");
    expect(screen.getByText(/分钟前/)).toBeTruthy();
  });
});
