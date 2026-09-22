// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import * as api from "@/lib/copilot-extensions-api";
import { CopilotConnectionsPanel } from "./CopilotConnectionsPanel";
vi.mock("@/lib/copilot-extensions-api", async original => ({ ...await original<typeof import("@/lib/copilot-extensions-api")>(), listCopilotConnections: vi.fn(), createCopilotConnection: vi.fn(), updateCopilotConnection: vi.fn(), discoverCopilotConnection: vi.fn(), deleteCopilotConnection: vi.fn() }));
vi.mock("./copilot-runtime-panel", () => ({ CapabilitiesSection: () => <div>Platform tool switches</div> }));
const connection: api.CopilotConnection = { id: "c1", name: "Docs server", kind: "mcp", endpoint: "https://mcp.example.com/mcp", enabled: false, revision: 3, hasCredential: true, status: "ready", lastDiscoveredAt: 10, tools: [
  { name: "lookup", modelName: "mcp_c1_lookup", description: "Search docs", inputSchema: { type: "object" }, enabled: false, compatible: true, unavailableReason: null },
  { name: "unsupported", modelName: "mcp_c1_bad", description: "Unsupported", inputSchema: {}, enabled: false, compatible: false, unavailableReason: "invalid_schema" },
] };
let client: QueryClient;
function mount() { render(<LanguageProvider><QueryClientProvider client={client}><CopilotConnectionsPanel /></QueryClientProvider></LanguageProvider>); }
beforeEach(() => { cleanup(); vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); vi.mocked(api.listCopilotConnections).mockResolvedValue({ connections: [connection] }); });
it("opens platform controls only inside the built-in Connection", () => {
  mount(); expect(screen.queryByText("Platform tool switches")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "管理工具" })); expect(screen.getByText("Platform tool switches")).toBeTruthy();
});
it("clears write-only bearer before failed submission and never caches or renders it", async () => {
  vi.mocked(api.createCopilotConnection).mockRejectedValue(new Error("test-secret-value")); mount();
  fireEvent.click(screen.getByRole("button", { name: "添加 MCP Connection" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "New MCP" } });
  fireEvent.change(screen.getByLabelText("HTTPS 端点"), { target: { value: "https://mcp.example.com/mcp" } });
  const secret = screen.getByLabelText("Bearer Token（可选，仅写入）"); fireEvent.change(secret, { target: { value: "test-secret-value" } });
  fireEvent.click(screen.getByRole("button", { name: "创建连接" }));
  await screen.findByRole("alert"); expect(secret).toHaveProperty("value", ""); expect(screen.queryByText("test-secret-value")).toBeNull();
  expect(api.createCopilotConnection).toHaveBeenCalledWith({ name: "New MCP", endpoint: "https://mcp.example.com/mcp", bearerToken: "test-secret-value" });
  expect(client.getMutationCache().getAll()).toHaveLength(0); expect(JSON.stringify(client.getQueryCache().getAll().map(query => query.state.data))).not.toContain("test-secret-value");
});
it("saves explicitly selected compatible tools with the observed revision", async () => {
  vi.mocked(api.updateCopilotConnection).mockResolvedValue({ connection }); mount(); await screen.findByText("Docs server");
  fireEvent.click(screen.getByRole("button", { name: "选择工具" }));
  expect(screen.getByRole("checkbox", { name: /unsupported/ })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /lookup/ })); fireEvent.click(screen.getByRole("button", { name: "保存工具选择" }));
  await waitFor(() => expect(api.updateCopilotConnection).toHaveBeenCalledWith("c1", { revision: 3, enabledTools: ["lookup"] }));
});
it("requires discovery before selecting tools and passes revision on discover", async () => {
  vi.mocked(api.listCopilotConnections).mockResolvedValue({ connections: [{ ...connection, status: "not_discovered", tools: [] }] }); vi.mocked(api.discoverCopilotConnection).mockResolvedValue({ connection }); mount(); await screen.findByText("Docs server");
  expect(screen.getByRole("button", { name: "选择工具" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "发现工具" })); await waitFor(() => expect(api.discoverCopilotConnection).toHaveBeenCalledWith("c1", 3));
});
it("toggles and deletes external connections through explicit revision-bound actions", async () => {
  vi.mocked(api.updateCopilotConnection).mockResolvedValue({ connection }); vi.mocked(api.deleteCopilotConnection).mockResolvedValue({ deleted: true }); mount();
  fireEvent.click(await screen.findByRole("switch", { name: "Docs server" })); await waitFor(() => expect(api.updateCopilotConnection).toHaveBeenCalledWith("c1", { revision: 3, enabled: true }));
  await waitFor(() => expect(screen.getByRole("button", { name: "删除" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "删除" }));
  fireEvent.click(screen.getByRole("button", { name: "删除" })); await waitFor(() => expect(api.deleteCopilotConnection).toHaveBeenCalledWith("c1", 3));
});
it("keeps built-in controls visible on external catalog failure", async () => {
  vi.mocked(api.listCopilotConnections).mockRejectedValue(new Error("offline")); mount(); expect(await screen.findByRole("alert")).toBeTruthy(); expect(screen.getByText("ForgeBadger")).toBeTruthy(); expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
});
it("removes saved credentials only through an explicit edit choice", async () => {
  vi.mocked(api.updateCopilotConnection).mockResolvedValue({ connection }); mount(); await screen.findByText("Docs server"); fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "移除已保存凭证" })); expect(screen.getByLabelText("Bearer Token（可选，仅写入）")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.updateCopilotConnection).toHaveBeenCalledWith("c1", { revision: 3, name: connection.name, endpoint: connection.endpoint, bearerToken: null }));
});
