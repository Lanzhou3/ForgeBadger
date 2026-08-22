// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import { CopilotSettings } from "@/components/copilot/copilot-settings";

const { getDshConfigMock, updateDshConfigMock, listModelProvidersMock, getPortfolioHeartbeatMock } =
  vi.hoisted(() => ({
    getDshConfigMock: vi.fn(),
    updateDshConfigMock: vi.fn(),
    listModelProvidersMock: vi.fn(),
    getPortfolioHeartbeatMock: vi.fn(),
  }));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    getDshConfig: getDshConfigMock,
    updateDshConfig: updateDshConfigMock,
  };
});

vi.mock("@/lib/portfolio-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portfolio-api")>();
  return {
    ...actual,
    getPortfolioHeartbeat: getPortfolioHeartbeatMock,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listModelProviders: listModelProvidersMock,
  };
});

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const baseDshConfig = {
  defaultModelId: "model-1",
  plugins: { "openforge-bridge": true, "mcp-client": false },
  availablePlugins: [
    { id: "openforge-bridge", label: "OpenForge Bridge", description: "平台工具" },
    { id: "mcp-client", label: "MCP Client", description: "外部工具接入" },
  ],
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

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderAndOpen() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <CopilotSettings />
      </QueryClientProvider>
    </LanguageProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Copilot 设置" }));
  await waitFor(() => expect(screen.getByText("dsh 内核")).toBeTruthy());
}

describe("CopilotSettings dsh kernel section", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getPortfolioHeartbeatMock.mockResolvedValue({ enabled: false, projectionVersion: 1 });
    listModelProvidersMock.mockResolvedValue(baseModels);
    getDshConfigMock.mockResolvedValue(baseDshConfig);
    updateDshConfigMock.mockResolvedValue(baseDshConfig);
  });

  it("renders the runtime badge, default model selection, and plugin toggles", async () => {
    await renderAndOpen();

    await waitFor(() => expect(screen.getByText("运行中")).toBeTruthy());
    expect(screen.getByText("OpenForge Bridge")).toBeTruthy();
    expect(screen.getByText("平台工具")).toBeTruthy();
    expect(screen.getByText("MCP Client")).toBeTruthy();
    // The closed Select trigger shows the label of the current default model.
    expect(screen.getByText("DeepSeek / deepseek-chat")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "OpenForge Bridge" }).getAttribute("data-state")).toBe("checked");
    expect(screen.getByRole("switch", { name: "MCP Client" }).getAttribute("data-state")).toBe("unchecked");
  });

  it("sends the merged plugin map when a toggle is clicked", async () => {
    await renderAndOpen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "MCP Client" })).toBeTruthy());
    fireEvent.click(screen.getByRole("switch", { name: "MCP Client" }));

    await waitFor(() =>
      expect(updateDshConfigMock).toHaveBeenCalledWith({
        plugins: { "openforge-bridge": true, "mcp-client": true },
      })
    );
  });

  it("shows a not-enabled hint instead of the form when the Gateway returns 404", async () => {
    getDshConfigMock.mockRejectedValue(new GatewayApiError("Not Found", 404));

    await renderAndOpen();

    await waitFor(() => expect(screen.getByText("dsh 内核未启用")).toBeTruthy());
    expect(screen.queryByRole("switch", { name: "OpenForge Bridge" })).toBeNull();
    expect(screen.queryByText("dsh 配置加载失败，请检查 Gateway 服务。")).toBeNull();
  });
});
