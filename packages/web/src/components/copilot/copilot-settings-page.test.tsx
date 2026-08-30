// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { GatewayApiError } from "@/lib/api";
import { CopilotSettingsPage } from "@/components/copilot/copilot-settings-page";

const {
  pushMock,
  getPortfolioHeartbeatMock,
  updatePortfolioHeartbeatMock,
  getDshConfigMock,
  updateDshConfigMock,
  getCopilotCapabilitiesMock,
  setCopilotToolEnabledMock,
  listModelProvidersMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getPortfolioHeartbeatMock: vi.fn(),
  updatePortfolioHeartbeatMock: vi.fn(),
  getDshConfigMock: vi.fn(),
  updateDshConfigMock: vi.fn(),
  getCopilotCapabilitiesMock: vi.fn(),
  setCopilotToolEnabledMock: vi.fn(),
  listModelProvidersMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/portfolio-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portfolio-api")>();
  return {
    ...actual,
    getPortfolioHeartbeat: getPortfolioHeartbeatMock,
    updatePortfolioHeartbeat: updatePortfolioHeartbeatMock,
  };
});

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    getDshConfig: getDshConfigMock,
    updateDshConfig: updateDshConfigMock,
    getCopilotCapabilities: getCopilotCapabilitiesMock,
    setCopilotToolEnabled: setCopilotToolEnabledMock,
  };
});

const {
  getFeishuChannelAccountMock,
  getFeishuConnectionHealthMock,
  getFeishuIntegrationConfigMock,
} = vi.hoisted(() => ({
  getFeishuChannelAccountMock: vi.fn(),
  getFeishuConnectionHealthMock: vi.fn(),
  getFeishuIntegrationConfigMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listModelProviders: listModelProvidersMock,
    getFeishuChannelAccount: getFeishuChannelAccountMock,
    getFeishuConnectionHealth: getFeishuConnectionHealthMock,
    getFeishuIntegrationConfig: getFeishuIntegrationConfigMock,
  };
});

const baseHeartbeat = { enabled: false, cadenceMinutes: null as number | null };

const baseDshConfig = {
  defaultModelId: "model-1",
  plugins: { "forgebadger-bridge": true, "mcp-client": false },
  availablePlugins: [
    { id: "forgebadger-bridge", label: "ForgeBadger Bridge", description: "平台工具" },
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

const baseCapabilities = {
  tools: [
    {
      name: "list_projects",
      description: "列出当前用户的项目",
      risk: "read" as const,
      requiresApproval: false,
      enabled: true,
    },
    {
      name: "run_terminal",
      description: "在终端执行命令",
      risk: "operate" as const,
      requiresApproval: true,
      enabled: false,
    },
  ],
};

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <CopilotSettingsPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("CopilotSettingsPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getPortfolioHeartbeatMock.mockResolvedValue(baseHeartbeat);
    updatePortfolioHeartbeatMock.mockResolvedValue({ ...baseHeartbeat, enabled: true });
    listModelProvidersMock.mockResolvedValue(baseModels);
    getDshConfigMock.mockResolvedValue(baseDshConfig);
    updateDshConfigMock.mockResolvedValue(baseDshConfig);
    getCopilotCapabilitiesMock.mockResolvedValue(baseCapabilities);
    getFeishuChannelAccountMock.mockResolvedValue({
      appId: "cli_feishu_test", enabled: true
    });
    getFeishuConnectionHealthMock.mockResolvedValue({
      state: "connected", accountId: "acc-1", configRevision: 1,
      reconnectAttempt: 0, lastConnectedAt: new Date().toISOString(), lastErrorMessage: null
    });
    getFeishuIntegrationConfigMock.mockResolvedValue({
      enabled: true, emergencyDisabled: false, identityMode: "bot",
      allowedChatIds: [], commandPrefix: "/"
    });
    setCopilotToolEnabledMock.mockImplementation((name: string, enabled: boolean) =>
      Promise.resolve({ toolName: name, enabled })
    );
  });

  it("renders the header with a back affordance and the section titles", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Copilot 设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "返回对话" })).toBeTruthy();

    await waitFor(() => expect(screen.getByText("dsh 内核")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("可用工具")).toBeTruthy());
    // Feishu integration section renders with live health badge.
    await waitFor(() => expect(screen.getByText("飞书集成")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("已连接")).toBeTruthy());
  });

  it("returns to the console via the back button", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(pushMock).toHaveBeenCalledWith("/copilot");
  });

  it("reflects the heartbeat state and sends an idempotent update on toggle", async () => {
    getPortfolioHeartbeatMock.mockResolvedValue({ enabled: true, cadenceMinutes: 30 });
    renderPage();

    const heartbeatSwitch = await screen.findByRole("switch", { name: /主动巡检/u });
    await waitFor(() => expect(heartbeatSwitch.getAttribute("data-state")).toBe("checked"));
    expect(screen.getByText("每 30 分钟巡检一次")).toBeTruthy();

    fireEvent.click(heartbeatSwitch);

    // The switch was on; clicking turns it off.
    await waitFor(() =>
      expect(updatePortfolioHeartbeatMock).toHaveBeenCalledWith(
        { enabled: false },
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      )
    );
  });

  it("renders the dsh kernel config: runtime badge, model select, plugin toggles", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("运行中")).toBeTruthy());
    expect(screen.getByText("DeepSeek / deepseek-chat")).toBeTruthy();
    expect(screen.getByText("ForgeBadger Bridge")).toBeTruthy();
    expect(screen.getByText("MCP Client")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "ForgeBadger Bridge" }).getAttribute("data-state")
    ).toBe("checked");
    expect(screen.getByRole("switch", { name: "MCP Client" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
  });

  it("sends the merged plugin map when a plugin toggle is clicked", async () => {
    renderPage();

    const toggle = await screen.findByRole("switch", { name: "MCP Client" });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(updateDshConfigMock).toHaveBeenCalledWith({
        plugins: { "forgebadger-bridge": true, "mcp-client": true },
      })
    );
  });

  it("shows the not-enabled hint when dsh-config answers 404, capabilities still render", async () => {
    getDshConfigMock.mockRejectedValue(new GatewayApiError("Not Found", 404));

    renderPage();

    await waitFor(() => expect(screen.getByText("dsh 内核未启用")).toBeTruthy());
    expect(screen.queryByRole("switch", { name: "ForgeBadger Bridge" })).toBeNull();
    expect(screen.queryByText("dsh 配置加载失败，请检查 Gateway 服务。")).toBeNull();
    await waitFor(() => expect(screen.getByText("list_projects")).toBeTruthy());
  });

  it("renders tools as a list with name, description, and per-tool switches", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId("tool-row-list_projects")).toBeTruthy());
    expect(screen.getByTestId("tool-row-run_terminal")).toBeTruthy();
    // Known tools show the localized (zh-CN) description from i18n.
    expect(screen.getByText("列出当前用户的项目（名称、路径、状态与 AI 工具）。")).toBeTruthy();
    // Unknown tools fall back to the server-provided description.
    expect(screen.getByText("在终端执行命令")).toBeTruthy();

    // The switch reflects each tool's enabled state.
    const enabledSwitch = screen.getByRole("switch", { name: "list_projects" });
    const disabledSwitch = screen.getByRole("switch", { name: "run_terminal" });
    expect(enabledSwitch.getAttribute("data-state")).toBe("checked");
    expect(disabledSwitch.getAttribute("data-state")).toBe("unchecked");
  });

  it("sends the toggle request when a tool switch is clicked", async () => {
    renderPage();

    const disabledSwitch = await screen.findByRole("switch", { name: "run_terminal" });
    fireEvent.click(disabledSwitch);

    await waitFor(() =>
      expect(setCopilotToolEnabledMock).toHaveBeenCalledWith("run_terminal", true)
    );
    // The capabilities query is invalidated so the row reflects the new state.
    await waitFor(() => expect(getCopilotCapabilitiesMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("shows an error hint when a toggle update fails", async () => {
    setCopilotToolEnabledMock.mockRejectedValue(new Error("boom"));
    renderPage();

    const disabledSwitch = await screen.findByRole("switch", { name: "run_terminal" });
    fireEvent.click(disabledSwitch);

    await waitFor(() => expect(screen.getByText("工具开关更新失败，请重试。")).toBeTruthy());
  });

  it("surfaces a load-error hint when capabilities fail", async () => {
    getCopilotCapabilitiesMock.mockRejectedValue(new GatewayApiError("boom", 500));

    renderPage();

    await waitFor(() => expect(screen.getByText("工具列表加载失败。")).toBeTruthy());
  });
});
