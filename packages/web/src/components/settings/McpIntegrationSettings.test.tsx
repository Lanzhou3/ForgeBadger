// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LanguageProvider } from "@/hooks/use-language";
import { McpIntegrationSettings } from "@/components/settings/McpIntegrationSettings";

// jsdom does not implement ResizeObserver; the Radix Dialog needs it.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const {
  listProjectsMock,
  getMcpStatusMock,
  listMcpTokensMock,
  createMcpTokenMock,
  revokeMcpTokenMock,
} = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  getMcpStatusMock: vi.fn(),
  listMcpTokensMock: vi.fn(),
  createMcpTokenMock: vi.fn(),
  revokeMcpTokenMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listProjects: listProjectsMock,
    getMcpStatus: getMcpStatusMock,
    listMcpTokens: listMcpTokensMock,
    createMcpToken: createMcpTokenMock,
    revokeMcpToken: revokeMcpTokenMock,
  };
});

const statusEnabled = { enabled: true, endpoint: "http://127.0.0.1:48731/mcp" };
const statusDisabled = { enabled: false, endpoint: "http://127.0.0.1:48731/mcp" };

function renderPanel() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <McpIntegrationSettings />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("McpIntegrationSettings", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    getMcpStatusMock.mockResolvedValue(statusEnabled);
    listMcpTokensMock.mockResolvedValue({ tokens: [] });
    listProjectsMock.mockResolvedValue({ projects: [{ id: "p1", name: "Project A", path: "/projects/a" }, { id: "p2", name: "Project B", path: "/projects/b" }] });
    createMcpTokenMock.mockResolvedValue({
      token: { id: "t1", name: "n", scopes: ["read"], createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null, revoked: false },
      plaintext: "fbmcp_secret",
    });
    revokeMcpTokenMock.mockResolvedValue({ revoked: true });
  });

  it("shows the endpoint and a create form when the service is enabled", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("服务已启用")).toBeTruthy());
    expect(screen.getByText("http://127.0.0.1:48731/mcp")).toBeTruthy();
    expect(screen.getByText("创建令牌")).toBeTruthy();
    expect(screen.queryByText("FORGEBADGER_MCP_ENABLED=true")).toBeNull();
  });

  it("shows the env hint instead of the token section when the service is disabled", async () => {
    getMcpStatusMock.mockResolvedValue(statusDisabled);
    renderPanel();
    await waitFor(() => expect(screen.getByText("服务未启用")).toBeTruthy());
    expect(screen.getByText("FORGEBADGER_MCP_ENABLED=true")).toBeTruthy();
    expect(screen.queryByText("创建令牌")).toBeNull();
    expect(listMcpTokensMock).not.toHaveBeenCalled();
  });

  it("lists tokens with scopes and never-used marker", async () => {
    listMcpTokensMock.mockResolvedValue({
      tokens: [
        { id: "t1", name: "inspector", scopes: ["read", "operate"], createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null, revoked: false },
        { id: "t2", name: "old", scopes: ["read"], createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-02T00:00:00.000Z", revoked: true },
      ],
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("inspector")).toBeTruthy());
    expect(screen.getByText("inspector").closest("div")?.textContent).toContain("可操作");
    expect(screen.getByText("从未使用")).toBeTruthy();
    expect(screen.getByText("已吊销")).toBeTruthy();
    // The revoked token has no revoke button; the active one does.
    expect(screen.getByLabelText("吊销 inspector")).toBeTruthy();
    expect(screen.queryByLabelText("吊销 old")).toBeNull();
  });

  it("creates a token and shows the plaintext once in a dialog", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("创建令牌")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "my-agent" } });
    fireEvent.click(await screen.findByLabelText("Project A"));
    fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
    await waitFor(() => expect(createMcpTokenMock).toHaveBeenCalledWith({ name: "my-agent", scopes: ["read"], projectIds: ["p1"], expiresInHours: null }, expect.anything()));
    await waitFor(() => expect(screen.getByText("fbmcp_secret")).toBeTruthy());
    expect(screen.getByText("访问令牌已创建")).toBeTruthy();
    expect(screen.getByText(/明文令牌只显示这一次/)).toBeTruthy();
  });

  it("keeps at least one scope selected and confirms before revoking", async () => {
    listMcpTokensMock.mockResolvedValue({
      tokens: [{ id: "t1", name: "inspector", scopes: ["read"], createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null, revoked: false }],
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("inspector")).toBeTruthy());

    // Unchecking the only selected scope is a no-op.
    fireEvent.click(screen.getByLabelText("只读"));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "x" } });
    fireEvent.click(await screen.findByLabelText("Project A"));
    fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
    await waitFor(() => expect(createMcpTokenMock).toHaveBeenCalledWith({ name: "x", scopes: ["read"], projectIds: ["p1"], expiresInHours: null }, expect.anything()));

    // Revoking opens a confirm dialog first.
    fireEvent.click(screen.getByLabelText("吊销 inspector"));
    await waitFor(() => expect(screen.getByText("确认吊销此令牌？持有它的客户端将立即失去访问权限。")).toBeTruthy());
    expect(revokeMcpTokenMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "吊销" }));
    await waitFor(() => expect(revokeMcpTokenMock).toHaveBeenCalledWith("t1", expect.anything()));
  });

  it("keeps a read scope when removing operate also removes CLI dispatch", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("创建令牌")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("CLI 任务派发"));
    fireEvent.click(screen.getByLabelText("只读"));
    fireEvent.click(screen.getByLabelText("可操作"));

    expect(screen.getByLabelText("只读").getAttribute("data-state")).toBe("checked");
    expect(screen.getByLabelText("可操作").getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByLabelText("CLI 任务派发").getAttribute("data-state")).toBe("unchecked");
  });

  it("creates a permanent full-permission token for multiple selected projects", async () => {
    renderPanel();
    await screen.findByLabelText("Project A");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "full" } });
    expect(screen.getByRole("button", { name: "创建令牌" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    fireEvent.click(screen.getByRole("button", { name: "全部权限" }));
    expect(screen.queryByPlaceholderText("/path/to/projects")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
    await waitFor(() => expect(createMcpTokenMock).toHaveBeenCalledWith({ name: "full", scopes: ["read", "operate", "cli_dispatch"], projectIds: ["p1", "p2"], expiresInHours: null }, expect.anything()));
    await screen.findByRole("dialog");
    const config = screen.getByRole("dialog").querySelector("pre")!.textContent!;
    expect(JSON.parse(config).mcpServers.forgebadger.headers.Authorization).toBe("Bearer fbmcp_secret");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("fbmcp_secret")).toBeNull();
    expect(document.body.textContent).not.toContain("Bearer fbmcp_secret");
  });

  it("searches projects and submits a finite lifetime", async () => {
    renderPanel();
    await screen.findByLabelText("Project A");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "limited" } });
    fireEvent.change(screen.getByLabelText("搜索项目名称或目录"), { target: { value: "Project B" } });
    expect(screen.queryByLabelText("Project A")).toBeNull();
    fireEvent.click(screen.getByLabelText("Project B"));
    fireEvent.change(screen.getByLabelText("有效期"), { target: { value: "limited" } });
    fireEvent.change(screen.getByLabelText("有效小时数"), { target: { value: "720" } });
    fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
    await waitFor(() => expect(createMcpTokenMock).toHaveBeenCalledWith({ name: "limited", scopes: ["read"], projectIds: ["p2"], expiresInHours: 720 }, expect.anything()));
  });

  it("renders only a copyable JSON template with the endpoint and a placeholder", async () => {
    renderPanel();
    await screen.findByText(/JSON 接入模板/);
    const config = JSON.parse(document.querySelector("pre")!.textContent!);
    expect(config.mcpServers.forgebadger.url).toBe(statusEnabled.endpoint);
    expect(config.mcpServers.forgebadger.headers.Authorization).toBe("Bearer <TOKEN>");
    expect(document.body.textContent).not.toContain("claude mcp add");
  });

  it.each(["empty", "error"])("disables token creation when projects are %s", async state => {
    if (state === "error") listProjectsMock.mockRejectedValue(new Error("Unavailable"));
    else listProjectsMock.mockResolvedValue({ projects: [] });
    renderPanel();
    await screen.findByText(state === "error" ? "项目加载失败，请刷新重试。" : "暂无项目，请先创建或导入项目。");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "agent" } });
    expect(screen.getByRole("button", { name: "创建令牌" }).hasAttribute("disabled")).toBe(true);
  });
});
