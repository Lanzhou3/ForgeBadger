// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CopilotSettingsPage } from "@/components/copilot/copilot-settings-page";
import { LanguageProvider } from "@/hooks/use-language";

const { pushMock, getCapabilitiesMock, setToolEnabledMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getCapabilitiesMock: vi.fn(),
  setToolEnabledMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    getCopilotCapabilities: getCapabilitiesMock,
    setCopilotToolEnabled: setToolEnabledMock,
  };
});

const capabilities = {
  tools: [
    {
      name: "list_projects",
      description: "List projects",
      risk: "read" as const,
      requiresApproval: false,
      enabled: true,
    },
    {
      name: "run_terminal",
      description: "Run a terminal command",
      risk: "operate" as const,
      requiresApproval: true,
      enabled: false,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <CopilotSettingsPage />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("CopilotSettingsPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getCapabilitiesMock.mockResolvedValue(capabilities);
    setToolEnabledMock.mockImplementation((name: string, enabled: boolean) =>
      Promise.resolve({ toolName: name, enabled })
    );
  });

  it("identifies the self-owned runtime and renders capability switches", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Copilot 设置" })).toBeTruthy();
    expect(screen.getByText("Gateway 原生")).toBeTruthy();
    expect(screen.getByText(/不依赖外部 Harness 服务/u)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("tool-row-list_projects")).toBeTruthy());
    expect(screen.getByTestId("tool-row-run_terminal")).toBeTruthy();
  });

  it("returns to the Copilot console", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(pushMock).toHaveBeenCalledWith("/copilot");
  });

  it("updates a native capability switch", async () => {
    renderPage();
    const toggle = await screen.findByRole("switch", { name: "run_terminal" });
    fireEvent.click(toggle);
    await waitFor(() => expect(setToolEnabledMock).toHaveBeenCalledWith("run_terminal", true));
  });

  it("shows capability load failures without hiding the runtime boundary", async () => {
    getCapabilitiesMock.mockRejectedValue(new Error("gateway unavailable"));
    renderPage();
    await waitFor(() => expect(screen.getByText("工具列表加载失败。")).toBeTruthy());
    expect(screen.getByText("Gateway 原生")).toBeTruthy();
  });
});
