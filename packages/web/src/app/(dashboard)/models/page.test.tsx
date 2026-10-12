// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import ModelsPage from "./page";

const { listModelProvidersMock } = vi.hoisted(() => ({
  listModelProvidersMock: vi.fn(),
}));

const provider = {
  id: "prov-1",
  providerKey: "anthropic",
  name: "Anthropic",
  baseUrl: "https://api.example.com",
  authType: "api_key",
  apiFormat: "anthropic",
  supportedAdapters: ["claude"],
  status: "active",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/models",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listModelProviders: listModelProvidersMock,
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <ModelsPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("ModelsPage query state", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.setItem("forgebadger-language", "zh-CN");
  });

  it("shows the error state with retry instead of the empty providers workspace when the query fails", async () => {
    listModelProvidersMock.mockRejectedValue(new Error("gateway unreachable"));
    renderPage();

    await screen.findByText("加载失败");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    // The failure must not masquerade as "no providers yet".
    expect(screen.queryByText("暂无服务商，请手动添加一个服务商。")).toBeNull();
  });

  it("labels the provider search input for screen readers", async () => {
    listModelProvidersMock.mockResolvedValue({
      providers: [provider],
      models: [],
      credentials: [],
    });
    renderPage();
    const search = await screen.findByPlaceholderText("搜索已配置服务商");
    expect(search.getAttribute("aria-label")).toBe("搜索已配置服务商");
  });

  it("prompts to select a provider instead of repeating the empty-catalog copy", async () => {
    listModelProvidersMock.mockResolvedValue({
      providers: [provider],
      models: [],
      credentials: [],
    });
    renderPage();
    expect(await screen.findByText("请选择一个服务商。")).toBeTruthy();
    // The right-hand placeholder must not repeat the left column's message.
    expect(screen.queryByText("暂无服务商，请手动添加一个服务商。")).toBeNull();
  });
});
