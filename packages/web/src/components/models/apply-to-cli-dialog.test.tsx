// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyToCliDialog } from "./apply-to-cli-dialog";
import { ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
import { applyCliConfigToAdapter, getClaudeRoute, previewCliConfigApply, setClaudeRoute, type ProviderProfile } from "@/lib/api";

vi.mock("@/hooks/use-language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  discoverAdapters: vi.fn(async () => ({ adapters: [] })),
  getClaudeRoute: vi.fn(async () => ({ enabled: false })),
  setClaudeRoute: vi.fn(async () => ({ enabled: true })),
  previewCliConfigApply: vi.fn(async () => ({ files: [], warnings: [] })),
  applyCliConfigToAdapter: vi.fn(async () => ({ files: [] })),
}));

const provider: ProviderProfile = {
  id: "provider-1", providerKey: "custom", name: "Custom", baseUrl: "https://example.com/v1",
  apiFormat: "openai", authType: "api_key", supportedAdapters: ["claude"], status: "active",
};

function setup(overrides: Partial<ProviderProfile> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ADAPTER_DISCOVERY_QUERY_KEY, { adapters: [] });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><ApplyToCliDialog provider={{ ...provider, ...overrides }} models={[]} credentials={[]} open onOpenChange={vi.fn()} /></QueryClientProvider>);
  return invalidate;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Claude endpoint routing", () => {
  it.each([
    { apiFormat: "openai" as const, anthropicBaseUrl: "https://example.com/anthropic", openaiBaseUrl: "https://example.com/v1" },
    { apiFormat: "openai-compatible" as const, anthropicBaseUrl: "https://example.com/anthropic" },
    { apiFormat: "anthropic" as const },
  ])("applies native Anthropic configuration directly: %j", async (overrides) => {
    const invalidate = setup(overrides);
    fireEvent.click(screen.getByRole("button", { name: "models.applyChangeSummary" }));
    await waitFor(() => expect(previewCliConfigApply).toHaveBeenCalled());
    expect(vi.mocked(previewCliConfigApply).mock.calls[0]?.[1]).not.toHaveProperty("routeThroughGateway");
    fireEvent.click(screen.getByRole("button", { name: "models.applyConfig" }));
    await waitFor(() => expect(applyCliConfigToAdapter).toHaveBeenCalled());
    expect(vi.mocked(applyCliConfigToAdapter).mock.calls[0]?.[1]).not.toHaveProperty("routeThroughGateway");
    expect(setClaudeRoute).not.toHaveBeenCalled();
    expect(getClaudeRoute).not.toHaveBeenCalled();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["claude-route"] }));
  });

  it.each(["openai", "openai-compatible"] as const)("enables routing for %s without Anthropic", async (apiFormat) => {
    setup({ apiFormat });
    await waitFor(() => expect(getClaudeRoute).toHaveBeenCalled());
    const button = screen.getByRole("button", { name: "models.claudeRouteEnableAndApply" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(applyCliConfigToAdapter).toHaveBeenCalledWith("claude", expect.objectContaining({ routeThroughGateway: true })));
    expect(setClaudeRoute).toHaveBeenCalledWith(true);
  });
});
