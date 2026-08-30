// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import { CopilotStatusBar, DshRuntimeBadge } from "@/components/copilot/copilot-kernel-panel";

const { getDshConfigMock, listModelProvidersMock } = vi.hoisted(() => ({
  getDshConfigMock: vi.fn(),
  listModelProvidersMock: vi.fn(),
}));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    getDshConfig: getDshConfigMock,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listModelProviders: listModelProvidersMock,
  };
});

const baseDshConfig = {
  defaultModelId: "model-1",
  plugins: {},
  availablePlugins: [],
  runtime: { status: "running" as const },
};

const baseModels = {
  providers: [],
  credentials: [],
  models: [
    {
      id: "model-1",
      providerProfileId: "provider-1",
      providerKey: "deepseek",
      providerName: "DeepSeek",
      baseUrl: null,
      name: "deepseek-chat",
      modelId: "deepseek-chat",
      capabilities: [],
      status: "active",
      isDefault: true,
    },
  ],
};

function renderWithProviders(ui: ReactNode) {
  render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {ui}
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("CopilotStatusBar", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    listModelProvidersMock.mockResolvedValue(baseModels);
  });

  it("shows the resolved model label and the runtime badge", async () => {
    getDshConfigMock.mockResolvedValue(baseDshConfig);

    renderWithProviders(<CopilotStatusBar />);

    // The bar renders as soon as dsh-config lands; the models query only
    // becomes enabled afterwards, so the resolved label needs its own wait.
    const bar = await screen.findByTestId("copilot-status-bar");
    await waitFor(() => expect(bar.textContent).toContain("DeepSeek / deepseek-chat"));
    expect(bar.textContent).toContain("当前模型");
    expect(bar.textContent).toContain("运行中");
  });

  it("falls back to the system-default label without a model override", async () => {
    getDshConfigMock.mockResolvedValue({ ...baseDshConfig, defaultModelId: null });

    renderWithProviders(<CopilotStatusBar />);

    const bar = await screen.findByTestId("copilot-status-bar");
    expect(bar.textContent).toContain("跟随系统默认");
  });

  it("hides itself entirely when dsh-config answers 404", async () => {
    getDshConfigMock.mockRejectedValue(new GatewayApiError("Not Found", 404));

    renderWithProviders(<CopilotStatusBar />);

    await waitFor(() => expect(screen.queryByTestId("copilot-status-bar")).toBeNull());
  });
});

describe("DshRuntimeBadge", () => {
  beforeEach(() => {
    cleanup();
  });

  it("maps each runtime status to its localized label", () => {
    renderWithProviders(<DshRuntimeBadge status="running" />);
    expect(screen.getByText("运行中")).toBeTruthy();

    cleanup();
    renderWithProviders(<DshRuntimeBadge status="idle" />);
    expect(screen.getByText("空闲")).toBeTruthy();

    cleanup();
    renderWithProviders(<DshRuntimeBadge status="off" />);
    expect(screen.getByText("未启动")).toBeTruthy();
  });
});
