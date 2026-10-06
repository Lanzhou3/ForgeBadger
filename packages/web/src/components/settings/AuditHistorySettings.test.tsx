// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { AuditHistorySettings } from "./AuditHistorySettings";

const { listAuditLogsMock } = vi.hoisted(() => ({
  listAuditLogsMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listAuditLogs: listAuditLogsMock,
  };
});

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <AuditHistorySettings />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("AuditHistorySettings", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
  });

  it("maps raw audit actions to localized labels and links to the full history", async () => {
    listAuditLogsMock.mockResolvedValue({
      auditLogs: [
        {
          id: 1,
          action: "apply_provider",
          resourceType: "model_provider",
          details: {},
          createdAt: "2026-10-01T08:00:00.000Z",
        },
        {
          id: 2,
          action: "future.unknown_action",
          resourceType: "something",
          details: {},
          createdAt: "2026-10-01T09:00:00.000Z",
        },
      ],
    });
    renderCard();

    await screen.findByText("应用提供商配置");
    // Unknown actions fall back to the raw string instead of rendering blank.
    expect(screen.getByText("future.unknown_action")).toBeTruthy();

    const viewAll = screen.getByRole("link", { name: /查看全部/ });
    expect(viewAll.getAttribute("href")).toBe("/history");
  });
});
