// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { CopilotChat } from "@/components/copilot/copilot-chat";

const {
  pushMock,
  listConversationsMock,
  listMessagesMock,
  createConversationMock,
  renameConversationMock,
  deleteConversationMock,
  cancelRunMock,
  sendMessageMock,
  editMessageMock,
  getCopilotCapabilitiesMock,
  listModelProvidersMock,
  getRunMock,
  listRunsMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  listConversationsMock: vi.fn(),
  listMessagesMock: vi.fn(),
  createConversationMock: vi.fn(),
  renameConversationMock: vi.fn(),
  deleteConversationMock: vi.fn(),
  cancelRunMock: vi.fn(),
  sendMessageMock: vi.fn(),
  editMessageMock: vi.fn(),
  getCopilotCapabilitiesMock: vi.fn(),
  listModelProvidersMock: vi.fn(),
  getRunMock: vi.fn(),
  listRunsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    listConversations: listConversationsMock,
    listMessages: listMessagesMock,
    createConversation: createConversationMock,
    renameConversation: renameConversationMock,
    deleteConversation: deleteConversationMock,
    cancelRun: cancelRunMock,
    sendMessage: sendMessageMock,
    editMessage: editMessageMock,
    getCopilotCapabilities: getCopilotCapabilitiesMock,
    getRun: getRunMock,
    listConversationRuns: listRunsMock,
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

// jsdom does not implement Element.scrollTo; the chat pins the stream to the
// bottom on new messages.
Element.prototype.scrollTo = () => {};

const baseConversation = {
  id: "conv-1",
  title: "测试对话",
  status: "active",
  created_at: 1779370000000,
  updated_at: 1779373600000,
};

const baseUserMessage = {
  id: "msg-1",
  conversationId: "conv-1",
  userId: "user-1",
  role: "user" as const,
  kind: "text" as const,
  content: "你好",
  sequence: 1,
  createdAt: "2026-05-21T00:00:00.000Z",
};

const baseModels = {
  providers: [],
  credentials: [],
  models: [
    {
      id: "model-1",
      providerProfileId: "provider-1",
      providerKey: "openai",
      providerName: "OpenAI",
      baseUrl: null,
      name: "gpt-5",
      modelId: "gpt-5",
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
    },
  ],
};

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderChat() {
  return render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <CopilotChat />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

async function waitForConversationLoaded() {
  await waitFor(() => expect(screen.getByText("你好")).toBeTruthy());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CopilotChat console layout", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    listRunsMock.mockResolvedValue({ runs: [], activeRun: null });
    window.localStorage.clear();
    window.history.replaceState({}, "", "/copilot");
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation] });
    listMessagesMock.mockResolvedValue({ messages: [baseUserMessage] });
    createConversationMock.mockResolvedValue({ conversation: baseConversation });
    renameConversationMock.mockResolvedValue({ conversation: baseConversation });
    deleteConversationMock.mockResolvedValue({ deleted: true });
    cancelRunMock.mockResolvedValue({ cancelled: true, runId: "run-1" });
    sendMessageMock.mockResolvedValue({ runId: "run-1" });
    editMessageMock.mockResolvedValue({ runId: "run-2" });
    getCopilotCapabilitiesMock.mockResolvedValue(baseCapabilities);
    listModelProvidersMock.mockResolvedValue(baseModels);
    getRunMock.mockResolvedValue({
      run: {
        id: "run-1",
        conversationId: "conv-1",
        userId: "user-1",
        status: "running",
        steps: 0,
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      },
      pendingActions: [],
    });
  });

  it("shows the thinking pulse immediately on send, before the POST answers", async () => {
    const blocked = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blocked.promise);
    renderChat();

    await waitForConversationLoaded();
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "继续" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });

    // The POST is still in flight, but the pulsing indicator must already be
    // visible — no dead air while the Gateway starts the model turn.
    expect(screen.getAllByText("Copilot 正在思考…").length).toBeGreaterThan(0);

    await act(async () => {
      blocked.resolve({ runId: "run-1" });
    });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("conv-1", "继续", undefined));
  });

  it("clears the thinking pulse and shows the send error when the POST fails", async () => {
    const blocked = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blocked.promise);
    renderChat();

    await waitForConversationLoaded();
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "继续" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    expect(screen.getAllByText("Copilot 正在思考…").length).toBeGreaterThan(0);

    await act(async () => {
      blocked.reject(new Error("gateway down"));
    });

    await waitFor(() => expect(screen.queryAllByText("Copilot 正在思考…").length).toBe(0));
    await waitFor(() => expect(screen.getByText("发送失败，请检查 Gateway 服务。")).toBeTruthy());
  });

  it("renders the two-zone console: conversation sidebar and centered chat stream", async () => {
    renderChat();

    await waitForConversationLoaded();
    // Left: conversation sidebar with search + the conversation row.
    expect(screen.getByPlaceholderText("搜索对话…")).toBeTruthy();
    expect(screen.getAllByText("测试对话").length).toBeGreaterThan(0);
    // Center: message stream with the persisted user message.
    expect(screen.getByText("你好")).toBeTruthy();
    // The status bar keeps model/runtime visibility in the console.
    expect(screen.getByTestId("copilot-status-bar")).toBeTruthy();
  });

  it("renders a floating composer instead of a docked bottom bar", async () => {
    renderChat();

    await waitForConversationLoaded();
    const composer = screen.getByTestId("copilot-composer");
    expect(composer.className).toContain("rounded-xl");
    expect(composer.className).toContain("backdrop-blur-md");
    expect(composer.className).toContain("shadow-lg");
    expect(composer.className).toContain("hover:-translate-y-0.5");
    expect(composer.className).toContain("focus-within:ring-brand/30");
    // No docked footer strip above the composer (old border-t bar removed).
    expect(composer.parentElement?.className).not.toContain("border-t");
  });

  it("opens the full Copilot settings page from the header gear", async () => {
    renderChat();

    await waitForConversationLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Copilot 设置" }));

    expect(pushMock).toHaveBeenCalledWith("/copilot/settings");
  });

  it("opens the conversations sheet from the header button on mobile", async () => {
    renderChat();

    await waitForConversationLoaded();
    fireEvent.click(screen.getByRole("button", { name: "对话" }));

    // The Sheet portals into document.body; jsdom keeps the desktop sidebar
    // mounted too, so a second search input proves the sheet opened.
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText("搜索对话…").length).toBeGreaterThan(1)
    );
  });

  it("shows the status bar with the current model and runtime badge", async () => {
    renderChat();

    const statusBar = await screen.findByTestId("copilot-status-bar");
    await waitFor(() => expect(statusBar.textContent).toContain("OpenAI / gpt-5"));
    expect(statusBar.textContent).toContain("当前模型");
    expect(statusBar.textContent).toContain("Gateway 原生");
  });

  it("collapses the conversation sidebar via the header toggle", async () => {
    renderChat();

    await waitForConversationLoaded();
    fireEvent.click(screen.getByRole("button", { name: "切换会话列表" }));

    await waitFor(() => expect(screen.queryByPlaceholderText("搜索对话…")).toBeNull());
  });

  it("preselects the conversation from the ?c= deep link", async () => {
    const deepLinked = { ...baseConversation, id: "conv-2", title: "目标对话" };
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, deepLinked] });
    listMessagesMock.mockResolvedValue({ messages: [] });
    window.history.replaceState({}, "", "/copilot?c=conv-2");

    renderChat();

    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith("conv-2"));
    await waitFor(() => expect(screen.getAllByText("目标对话").length).toBeGreaterThan(0));
  });

  it("falls back to the first conversation when the ?c= id no longer exists", async () => {
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation] });
    window.history.replaceState({}, "", "/copilot?c=conv-deleted");

    renderChat();

    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith("conv-1"));
  });

  it("falls back to the generic edit error for other failures", async () => {
    editMessageMock.mockRejectedValue(new Error("boom"));

    renderChat();

    await waitForConversationLoaded();
    fireEvent.click(
      screen.getByRole("button", { name: "编辑消息（删除该消息及之后所有内容并重新运行）" })
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并重新运行" }));

    await waitFor(() => expect(screen.getByText("编辑失败，请重试。")).toBeTruthy());
  });
  it("does not submit Enter while a restored approval is pending", async () => {
    const run = { id: "run-1", conversationId: "conv-1", status: "awaiting_approval", revision: 3 };
    listRunsMock.mockResolvedValue({ runs: [run], activeRun: run });
    getRunMock.mockResolvedValue({ run, pendingActions: [{ id: "action", runId: "run-1", tool: "create_project", status: "pending", inputJson: "{}", inputDigest: "digest" }] });
    renderChat();
    await waitFor(() => expect(screen.getByText("需要批准")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "继续" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await act(async () => {});
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(screen.getByText("需要批准")).toBeTruthy();
  });

});
