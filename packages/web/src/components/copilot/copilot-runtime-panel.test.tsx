// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { CapabilitiesSection, CopilotStatusBar } from "./copilot-runtime-panel";
import * as api from "@/lib/api";
import * as copilotApi from "@/lib/copilot-api";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  listModelProviders: vi.fn(),
}));

vi.mock("@/lib/copilot-api", async (original) => ({
  ...(await original<typeof import("@/lib/copilot-api")>()),
  getCopilotPreferences: vi.fn(),
  updateCopilotPreferences: vi.fn(),
  getCopilotCapabilities: vi.fn(),
  setCopilotToolEnabled: vi.fn(),
}));

function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("copilot-runtime-panel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.listModelProviders).mockResolvedValue({ providers: [], credentials: [], models: [] });
    vi.mocked(copilotApi.getCopilotPreferences).mockResolvedValue({ modelId: null, thinkingEffort: "medium" });
  });

  it("renders compact pills without Gateway native badge by default", async () => {
    mount(<CopilotStatusBar onModelChange={vi.fn()} />);
    const bar = await screen.findByTestId("copilot-status-bar");
    expect(bar.textContent).not.toContain("Gateway 原生");
    expect(screen.getByRole("combobox", { name: "当前模型" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "思考强度" })).toBeTruthy();
  });

  it("renders labelled grid controls when showLabels is true", async () => {
    mount(<CopilotStatusBar showLabels onModelChange={vi.fn()} />);
    const bar = await screen.findByTestId("copilot-status-bar");
    expect(bar.className).toContain("grid");
    expect(screen.getByLabelText("当前模型")).toBeTruthy();
    expect(screen.getByLabelText("思考强度")).toBeTruthy();
  });

  it("renders localized operate risk badge and warning tone in CapabilitiesSection", async () => {
    vi.mocked(copilotApi.getCopilotCapabilities).mockResolvedValue({
      tools: [
        {
          name: "create_work_item",
          description: "Create a work item",
          risk: "operate",
          requiresApproval: true,
          enabled: true,
          available: false,
          unavailableReason: "No project",
        },
        {
          name: "list_projects",
          description: "List projects",
          risk: "read",
          requiresApproval: false,
          enabled: true,
          available: true,
          unavailableReason: null,
        },
      ],
    });
    mount(<CapabilitiesSection active />);
    expect(await screen.findByText("操作权限")).toBeTruthy();
    expect(screen.queryByText("operate")).toBeNull();
    const unavailable = screen.getByText(/No project/);
    expect(unavailable.className).toContain("text-warning");

    fireEvent.click(screen.getByRole("switch", { name: "list_projects" }));
    await waitFor(() => expect(copilotApi.setCopilotToolEnabled).toHaveBeenCalledWith("list_projects", false));
  });
});
