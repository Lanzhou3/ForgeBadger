// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyToCliDialog } from "./apply-to-cli-dialog";
import { ADAPTER_DISCOVERY_QUERY_KEY } from "@/components/adapter-select";
import { applyCliConfigToAdapter, getClaudeRoute, previewCliConfigApply, setClaudeRoute, type ModelProfile, type ProviderProfile } from "@/lib/api";

vi.mock("@/hooks/use-language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  discoverAdapters: vi.fn(async () => ({ adapters: [] })),
  getAdapterOrder: vi.fn(async () => ({ order: [] })),
  getClaudeRoute: vi.fn(async () => ({ enabled: false })),
  setClaudeRoute: vi.fn(async () => ({ enabled: true })),
  previewCliConfigApply: vi.fn(async () => ({ files: [], warnings: [] })),
  applyCliConfigToAdapter: vi.fn(async () => ({ files: [] })),
}));

const provider: ProviderProfile = {
  id: "provider-1", providerKey: "custom", name: "Custom", baseUrl: "https://example.com/v1",
  apiFormat: "openai", authType: "api_key", supportedAdapters: ["claude"], status: "active",
};

function makeModel(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "model-1", providerProfileId: "provider-1", providerKey: "custom", providerName: "Custom",
    baseUrl: "https://example.com/v1", name: "First Model", modelId: "m-1",
    capabilities: [], contextWindow: null, supportEfforts: [], defaultEffort: null, status: "active", isDefault: true, ...overrides
  };
}

function setup(
  overrides: Partial<ProviderProfile> = {},
  models: ModelProfile[] = []
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ADAPTER_DISCOVERY_QUERY_KEY, { adapters: [] });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><ApplyToCliDialog provider={{ ...provider, ...overrides }} models={models} credentials={[]} open onOpenChange={vi.fn()} /></QueryClientProvider>);
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

describe("PI apply model selection semantics", () => {
  it("labels the single selection as the startup default and explains all models are applied", () => {
    setup(
      { supportedAdapters: ["pi"] },
      [makeModel(), makeModel({ id: "model-2", name: "Second Model", modelId: "m-2", isDefault: false })]
    );
    // t() is mocked to return the key itself, so assert on the keys.
    expect(screen.getByText("models.applyToCliDefaultModel")).toBeTruthy();
    expect(screen.getByText("models.applyToCliPiHint")).toBeTruthy();
    expect(screen.getByLabelText("models.applyToCliDefaultModel")).toBeTruthy();
    // Both models stay selectable: the selection does not restrict the apply.
    const select = screen.getByLabelText("models.applyToCliDefaultModel") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["First Model", "Second Model"]);
  });

  it("keeps the plain model label and no PI hint for other adapters", () => {
    setup({ supportedAdapters: ["claude"] }, [makeModel()]);
    expect(screen.getByText("projects.model")).toBeTruthy();
    expect(screen.queryByText("models.applyToCliPiHint")).toBeNull();
    expect(screen.queryByText("models.applyToCliDefaultModel")).toBeNull();
  });

  it("still submits the selected model id for PI (default pin unchanged)", async () => {
    setup(
      { supportedAdapters: ["pi"] },
      [makeModel(), makeModel({ id: "model-2", name: "Second Model", modelId: "m-2", isDefault: false })]
    );
    const select = screen.getByLabelText("models.applyToCliDefaultModel") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "model-2" } });
    fireEvent.click(screen.getByRole("button", { name: "models.applyConfig" }));
    await waitFor(() => expect(applyCliConfigToAdapter).toHaveBeenCalledWith("pi", expect.objectContaining({ modelProfileId: "model-2" })));
  });
});

describe("Codex wire API blocker", () => {
  it("renders the localized blocker banner and filters the raw marker code", async () => {
    vi.mocked(previewCliConfigApply).mockResolvedValueOnce({
      files: [],
      warnings: [
        "CODEX_WIRE_API_UNSUPPORTED",
        "Codex (installed: codex-cli 0.157.1) no longer supports wire_api = \"chat\"."
      ]
    } as never);
    setup({ supportedAdapters: ["codex"] }, [makeModel()]);

    fireEvent.click(screen.getByRole("button", { name: "models.applyChangeSummary" }));
    await waitFor(() => expect(screen.getByText("models.codexWireApiBlocked")).toBeTruthy());
    // The machine-readable marker never renders verbatim; the human message does.
    expect(screen.queryByText("CODEX_WIRE_API_UNSUPPORTED")).toBeNull();
    expect(
      screen.getByText((content) => content.includes("no longer supports wire_api"))
    ).toBeTruthy();
    // The apply action is hard-blocked while the marker is present.
    const applyButton = screen.getByRole("button", { name: "models.applyConfig" }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
  });

  it("does not render the blocker banner for other warning sets", async () => {
    vi.mocked(previewCliConfigApply).mockResolvedValueOnce({
      files: [],
      warnings: ["Applying this change may normalize TOML comments and formatting in the config file."]
    } as never);
    setup({ supportedAdapters: ["codex"] }, [makeModel()]);

    fireEvent.click(screen.getByRole("button", { name: "models.applyChangeSummary" }));
    await waitFor(() =>
      expect(
        screen.getByText((content) => content.includes("normalize TOML"))
      ).toBeTruthy()
    );
    expect(screen.queryByText("models.codexWireApiBlocked")).toBeNull();
  });
});
