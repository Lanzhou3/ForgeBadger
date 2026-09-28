// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { CopilotChat } from "@/components/copilot/copilot-chat";
import { LAST_COPILOT_CONVERSATION_KEY } from "@/lib/copilot-conversation-storage";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import type { CopilotPreferences } from "@/lib/copilot-api";
import { GatewayApiError } from "@/lib/api";

const {
  pushMock,
  toastErrorMock,
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
  listProjectsMock,
  getRunMock,
  listRunsMock,
  getCopilotPreferencesMock,
  updateCopilotPreferencesMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastErrorMock: vi.fn(),
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
  listProjectsMock: vi.fn(),
  getRunMock: vi.fn(),
  listRunsMock: vi.fn(),
  getCopilotPreferencesMock: vi.fn(),
  updateCopilotPreferencesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: toastErrorMock },
}));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    listFollowups: vi.fn().mockResolvedValue({ followups: [] }),
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
    getCopilotPreferences: getCopilotPreferencesMock,
    updateCopilotPreferences: updateCopilotPreferencesMock,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listModelProviders: listModelProvidersMock,
    listProjects: listProjectsMock,
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

// In-memory stand-in for the server-side preference store: PUTs merge into it
// and the subsequent GET (via query invalidation) returns the merged value.
let preferencesState: CopilotPreferences = { modelId: null, thinkingEffort: "medium" };

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

// jsdom implements neither Pointer Capture nor scrollIntoView; Radix Select
// calls both while opening/rendering its content.
function stubRadixSelectEnvironment() {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
}

function openSelect(name: string) {
  const trigger = screen.getByRole("combobox", { name });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

async function pickOption(name: string, option: string) {
  openSelect(name);
  const item = await screen.findByRole("option", { name: option });
  fireEvent.click(item);
}

describe("CopilotChat console layout", () => {
  it("restores the last selected conversation when returning from settings", async () => {
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, { ...baseConversation, id: "conv-2", title: "上次阅读" }] });
    window.localStorage.setItem(LAST_COPILOT_CONVERSATION_KEY, "conv-2");
    renderChat();
    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith("conv-2"));
    expect(listMessagesMock).not.toHaveBeenCalledWith("conv-1");
  });

  it("shows a loading skeleton instead of an empty conversation and can retry a failed history read", async () => {
    const loading = deferred<{ messages: typeof baseUserMessage[] }>();
    listMessagesMock.mockReturnValueOnce(loading.promise);
    renderChat();
    await waitFor(() => expect(listMessagesMock).toHaveBeenCalled());
    expect(screen.queryByText("你好")).toBeNull();
    expect(screen.getByTestId("copilot-loading-skeleton")).toBeTruthy();
    await act(async () => loading.reject(new Error("offline")));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitForConversationLoaded();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps optional controls out of history and preserves their consent when the panel closes", async () => {
    renderChat();
    await waitForConversationLoaded();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "执行选项" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /任务结束后自动只读复核/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /测试失败后尝试修复/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("你好")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "执行选项" }));
    expect((screen.getByRole("checkbox", { name: /任务结束后自动只读复核/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /测试失败后尝试修复/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "inspect" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("conv-1", "inspect", undefined,
      expect.objectContaining({ reviewTaskResults: true, repairFailedChecks: true })));
    fireEvent.click(screen.getByRole("button", { name: "执行选项" }));
    expect((screen.getByRole("checkbox", { name: /测试失败后尝试修复/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it("retains project and request identity when retrying an uncertain submission", async () => {
    sendMessageMock.mockRejectedValueOnce(new Error("network lost"));
    renderChat();
    await waitForConversationLoaded();
    await pickOption("项目上下文", "Selected project");
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "inspect" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重试" })).toBeTruthy());
    const options = sendMessageMock.mock.calls[0]![3];
    expect(options).toEqual({ projectId: "project-1", clientRequestId: expect.any(String) });
    await pickOption("项目上下文", "未指定项目");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(2));
    expect(sendMessageMock.mock.calls[1]).toEqual(["conv-1", "inspect", undefined, options]);
  });

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    stubRadixSelectEnvironment();
    preferencesState = { modelId: null, thinkingEffort: "medium" };
    getCopilotPreferencesMock.mockImplementation(async () => preferencesState);
    updateCopilotPreferencesMock.mockImplementation(
      async (patch: { modelId?: string | null; thinkingEffort?: CopilotPreferences["thinkingEffort"] }) => {
        preferencesState = { ...preferencesState, ...patch };
        return preferencesState;
      }
    );
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
    listProjectsMock.mockResolvedValue({ projects: [{ id: "project-1", name: "Selected project" }] });
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

  it("keeps the selected conversation and reports a busy deletion", async () => {
    deleteConversationMock.mockRejectedValueOnce(new GatewayApiError("Conversation busy", 409, { code: "COPILOT_CONVERSATION_BUSY" }));
    renderChat();
    await waitForConversationLoaded();
    fireEvent.click(screen.getByRole("button", { name: "删除对话" }));
    fireEvent.click(screen.getByRole("button", { name: "删除对话" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("会话仍有任务在运行或等待审批，请先停止任务再删除。"));
    expect(screen.getByText("你好")).toBeTruthy();
    expect(window.localStorage.getItem(LAST_COPILOT_CONVERSATION_KEY)).toBe("conv-1");
  });

  it("selects the remaining conversation after deleting the current one", async () => {
    const other = { ...baseConversation, id: "conv-2", title: "目标对话" };
    listConversationsMock.mockResolvedValueOnce({ conversations: [baseConversation, other] }).mockResolvedValue({ conversations: [other] });
    listMessagesMock.mockImplementation(async (id: string) => ({ messages: [{ ...baseUserMessage, conversationId: id, content: id === "conv-1" ? "你好" : "保留消息" }] }));
    renderChat();
    await waitForConversationLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "删除对话" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "删除对话" })[0]!);

    await waitFor(() => expect(screen.getByText("保留消息")).toBeTruthy());
    expect(window.localStorage.getItem(LAST_COPILOT_CONVERSATION_KEY)).toBe("conv-2");
    expect(screen.queryByText("你好")).toBeNull();
  });

  it("reports rename failures instead of silently discarding the change", async () => {
    renameConversationMock.mockRejectedValueOnce(new Error("offline"));
    renderChat();
    await waitForConversationLoaded();
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    const editor = screen.getByDisplayValue("测试对话");
    fireEvent.change(editor, { target: { value: "新标题" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("重命名失败，请重试。"));
    expect(screen.getByText("你好")).toBeTruthy();
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
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("conv-1", "继续", undefined, expect.objectContaining({ clientRequestId: expect.any(String) })));
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
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("发送失败，请检查 Gateway 服务。"));
    // The inline retry action stays available next to the transcript.
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
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

  it("sends the picked model with the message and persists the choice to the server", async () => {
    listModelProvidersMock.mockResolvedValue({
      ...baseModels,
      models: [
        baseModels.models[0]!,
        { ...baseModels.models[0]!, id: "model-2", name: "claude-opus", modelId: "claude-opus-4", providerName: "Anthropic", isDefault: false },
      ],
    });
    renderChat();

    await waitForConversationLoaded();
    await pickOption("当前模型", "Anthropic / claude-opus");
    await waitFor(() => expect(updateCopilotPreferencesMock).toHaveBeenCalledWith({ modelId: "model-2" }, expect.anything()));
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "换个模型" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    expect(sendMessageMock.mock.calls[0]![2]).toBe("model-2");
    // The invalidation refetch lands and the picker keeps the persisted choice.
    await waitFor(() => expect(screen.getByRole("combobox", { name: "当前模型" }).textContent).toContain("Anthropic / claude-opus"));
  });

  it("degrades the preference pickers while loading, then persists the thinking effort", async () => {
    const blocked = deferred<CopilotPreferences>();
    getCopilotPreferencesMock.mockReturnValueOnce(blocked.promise);
    renderChat();

    const modelPicker = screen.getByRole("combobox", { name: "当前模型" });
    const effortPicker = await screen.findByRole("combobox", { name: "思考强度" });
    // Both pickers are disabled while the preference is still in flight.
    expect(modelPicker.hasAttribute("disabled")).toBe(true);
    expect(effortPicker.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      blocked.resolve({ modelId: null, thinkingEffort: "high" });
    });

    await waitFor(() => expect(effortPicker.hasAttribute("disabled")).toBe(false));
    expect(modelPicker.hasAttribute("disabled")).toBe(false);
    await waitFor(() => expect(effortPicker.textContent).toContain("高"));

    openSelect("思考强度");
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["关闭", "低", "中", "高"]);
    fireEvent.click(screen.getByRole("option", { name: "低" }));
    await waitFor(() => expect(updateCopilotPreferencesMock).toHaveBeenCalledWith({ thinkingEffort: "low" }, expect.anything()));
    // The invalidation refetch lands and the picker follows the server value.
    await waitFor(() => expect(effortPicker.textContent).toContain("低"));
  });

  it("keeps the displayed and submitted model aligned when saving a preference fails", async () => {
    listModelProvidersMock.mockResolvedValue({ ...baseModels, models: [baseModels.models[0], { ...baseModels.models[0], id: "model-2", name: "Other model", isDefault: false }] });
    updateCopilotPreferencesMock.mockRejectedValueOnce(new Error("offline"));
    renderChat();
    await waitForConversationLoaded();
    await pickOption("当前模型", "OpenAI / Other model");
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("偏好保存失败，仍使用上次保存的设置。"));
    // The picker falls back to the effective default option.
    await waitFor(() => expect(screen.getByRole("combobox", { name: "当前模型" }).textContent).toContain("跟随系统默认"));
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "继续" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    expect(sendMessageMock.mock.calls[0]![2]).toBeUndefined();
  });

  it("clears a stale model preference that no longer exists in the model list", async () => {
    preferencesState = { modelId: "model-gone", thinkingEffort: "medium" };
    renderChat();

    await waitForConversationLoaded();
    // The stale id is cleared on the server, then the picker falls back to
    // the default option.
    await waitFor(() => expect(updateCopilotPreferencesMock).toHaveBeenCalledWith({ modelId: null }, expect.anything()));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "当前模型" }).textContent).toContain("跟随系统默认"));
    expect(preferencesState.modelId).toBeNull();
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

  it("keeps the conversation the user picks after the ?c= deep link was applied", async () => {
    const deepLinked = { ...baseConversation, id: "conv-2", title: "目标对话" };
    const deepLinkedMessage = { ...baseUserMessage, id: "msg-2", conversationId: "conv-2", content: "目标消息" };
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, deepLinked] });
    listMessagesMock.mockImplementation(async (id: string) => ({
      messages: id === "conv-2" ? [deepLinkedMessage] : [baseUserMessage],
    }));
    window.history.replaceState({}, "", "/copilot?c=conv-2");

    renderChat();

    // The deep link is applied first (the user has not interacted yet).
    await waitFor(() => expect(screen.getByText("目标消息")).toBeTruthy());

    // The user then switches to conv-1 manually from the sidebar.
    fireEvent.click(screen.getAllByRole("button", { name: /测试对话/ })[0]!);
    await waitFor(() => expect(screen.getByText("你好")).toBeTruthy());

    // A later conversation-list refresh (e.g. a reactive update) must not
    // pull the selection back to the deep-linked conversation.
    act(() => {
      window.dispatchEvent(
        new CustomEvent(FORGEBADGER_GATEWAY_EVENT, {
          detail: { type: "copilot_run_updated", payload: { source: "reactive", run_id: "run-1", conversation_id: "conv-2" } },
        })
      );
    });
    await waitFor(() => expect(listConversationsMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByText("你好")).toBeTruthy();
    expect(screen.queryByText("目标消息")).toBeNull();
    // conv-2's messages were fetched exactly once — the initial deep-link apply.
    expect(listMessagesMock.mock.calls.filter((call) => call[0] === "conv-2")).toHaveLength(1);
  });

  it("ignores a stale listMessages response after the user switches conversations", async () => {
    const otherConversation = { ...baseConversation, id: "conv-2", title: "目标对话" };
    const staleMessage = { ...baseUserMessage, id: "msg-2", conversationId: "conv-1", content: "过期消息" };
    const freshMessage = { ...baseUserMessage, id: "msg-3", conversationId: "conv-2", content: "最新内容" };
    let resolveStale!: (value: { messages: typeof staleMessage[] }) => void;
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, otherConversation] });
    listMessagesMock.mockImplementation((id: string) =>
      id === "conv-1"
        ? new Promise((resolve) => { resolveStale = resolve; })
        : Promise.resolve({ messages: [freshMessage] })
    );

    renderChat();

    // conv-1's initial auto-select is still in flight when the user
    // switches to conv-2.
    await waitFor(() => expect(screen.getAllByText("目标对话").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: /目标对话/ })[0]!);
    await waitFor(() => expect(screen.getByText("最新内容")).toBeTruthy());

    // The slow conv-1 response lands late and must not clobber the stream.
    await act(async () => { resolveStale({ messages: [staleMessage] }); });
    expect(screen.queryByText("过期消息")).toBeNull();
    expect(screen.getByText("最新内容")).toBeTruthy();
  });

  it("resets an unfinished edit when switching conversations", async () => {
    const other = { ...baseConversation, id: "conv-2", title: "目标对话" };
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, other] });
    listMessagesMock.mockImplementation(async (id: string) => ({ messages: [{ ...baseUserMessage, id: `message-${id}`, conversationId: id, content: id === "conv-1" ? "你好" : "第二条消息" }] }));
    renderChat();
    await waitForConversationLoaded();
    fireEvent.click(screen.getByRole("button", { name: /编辑消息/ }));
    fireEvent.click(screen.getByRole("button", { name: /目标对话/ }));
    await screen.findByText("第二条消息");
    expect(screen.getByRole("button", { name: /编辑消息/ })).toBeTruthy();
  });

  it("follows a changed deep link without remounting the chat", async () => {
    const other = { ...baseConversation, id: "conv-2", title: "目标对话" };
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, other] });
    listMessagesMock.mockImplementation(async (id: string) => ({ messages: [{ ...baseUserMessage, conversationId: id, content: id === "conv-1" ? "你好" : "第二条消息" }] }));
    const rendered = renderChat();
    await waitForConversationLoaded();
    window.history.replaceState({}, "", "/copilot?c=conv-2");
    rendered.rerender(<LanguageProvider><QueryClientProvider client={createQueryClient()}><CopilotChat /></QueryClientProvider></LanguageProvider>);
    await screen.findByText("第二条消息");
    expect(window.localStorage.getItem(LAST_COPILOT_CONVERSATION_KEY)).toBe("conv-2");
  });

  it("keeps the new conversation's run when an old send fails late", async () => {
    const oldSend = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValueOnce(oldSend.promise);
    const other = { ...baseConversation, id: "conv-2", title: "目标对话" };
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, other] });
    listMessagesMock.mockImplementation(async (id: string) => ({ messages: [{ ...baseUserMessage, conversationId: id, content: id === "conv-1" ? "你好" : "第二条消息" }] }));
    renderChat();
    await waitForConversationLoaded();
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "继续" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    const run = { id: "run-2", conversationId: "conv-2", status: "running", revision: 2 };
    listRunsMock.mockResolvedValue({ runs: [run], activeRun: run });
    getRunMock.mockResolvedValue({ run, pendingActions: [] });
    fireEvent.click(screen.getByRole("button", { name: /目标对话/ }));
    await screen.findByText("第二条消息");
    await act(async () => { oldSend.reject(new Error("late network failure")); });
    expect(screen.queryByText("发送失败，请检查 Gateway 服务。")).toBeNull();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  });

  it("reuses the edit request identity and project context after an uncertain result", async () => {
    editMessageMock.mockRejectedValueOnce(new Error("response lost"));
    renderChat();
    await waitForConversationLoaded();
    await pickOption("项目上下文", "Selected project");
    fireEvent.click(screen.getByRole("button", { name: /编辑消息/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存并重新运行" }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("编辑失败，请重试。"));
    const first = editMessageMock.mock.calls[0]!;
    expect(first[3]).toEqual({ projectId: "project-1", clientRequestId: expect.any(String) });
    fireEvent.click(screen.getByRole("button", { name: "保存并重新运行" }));
    await waitFor(() => expect(editMessageMock).toHaveBeenCalledTimes(2));
    expect(editMessageMock.mock.calls[1]).toEqual(first);
  });

  it("keeps the new conversation load when an old send succeeds late", async () => {
    const oldSend = deferred<{ runId: string }>();
    const newMessages = deferred<{ messages: typeof baseUserMessage[] }>();
    sendMessageMock.mockReturnValueOnce(oldSend.promise);
    const other = { ...baseConversation, id: "conv-2", title: "目标对话" };
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, other] });
    listMessagesMock.mockImplementation((id: string) => id === "conv-2" ? newMessages.promise : Promise.resolve({ messages: [baseUserMessage] }));
    renderChat();
    await waitForConversationLoaded();
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "继续" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(screen.getByRole("button", { name: /目标对话/ }));
    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith("conv-2"));
    await act(async () => { oldSend.resolve({ runId: "old-run" }); });
    await act(async () => { newMessages.resolve({ messages: [{ ...baseUserMessage, conversationId: "conv-2", content: "目标消息" }] }); });
    expect(screen.getByText("目标消息")).toBeTruthy();
    expect(listMessagesMock.mock.calls.filter(([id]) => id === "conv-1")).toHaveLength(1);
  });

  it("does not overwrite a newly sent message with an older refresh of the same conversation", async () => {
    const oldMessages = deferred<{ messages: typeof baseUserMessage[] }>();
    const pendingSend = deferred<{ runId: string }>();
    listMessagesMock.mockReturnValueOnce(oldMessages.promise);
    renderChat();
    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledTimes(1));
    // The first transcript load is still in flight when a new turn starts.
    sendMessageMock.mockReturnValueOnce(pendingSend.promise);
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "新问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await act(async () => { oldMessages.resolve({ messages: [baseUserMessage] }); });
    expect(screen.getByText("新问题")).toBeTruthy();
    await act(async () => { pendingSend.reject(new Error("offline")); });
  });

  it("applies a pending deep link using the latest overlapping list refresh", async () => {
    const other = { ...baseConversation, id: "conv-2", title: "目标对话" };
    const blocked = deferred<{ conversations: typeof baseConversation[] }>();
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, other] });
    listMessagesMock.mockImplementation(async (id: string) => ({ messages: [{ ...baseUserMessage, conversationId: id, content: id === "conv-1" ? "你好" : "目标消息" }] }));
    const rendered = renderChat();
    await waitForConversationLoaded();
    listConversationsMock.mockReturnValueOnce(blocked.promise);
    window.history.replaceState({}, "", "/copilot?c=conv-2");
    rendered.rerender(<LanguageProvider><QueryClientProvider client={createQueryClient()}><CopilotChat /></QueryClientProvider></LanguageProvider>);
    await waitFor(() => expect(listConversationsMock).toHaveBeenCalledTimes(2));
    act(() => { window.dispatchEvent(new CustomEvent(FORGEBADGER_GATEWAY_EVENT, { detail: { type: "copilot_run_updated", payload: { source: "reactive", run_id: "report-run", conversation_id: "other-conversation" } } })); });
    await screen.findByText("目标消息");
    await act(async () => { blocked.resolve({ conversations: [baseConversation, other] }); });
    expect(screen.getByText("目标消息")).toBeTruthy();
  });

  it("shares the active conversation with the floating robot panel's storage", async () => {
    const otherConversation = { ...baseConversation, id: "conv-2", title: "目标对话" };
    const freshMessage = { ...baseUserMessage, id: "msg-3", conversationId: "conv-2", content: "最新内容" };
    listConversationsMock.mockResolvedValue({ conversations: [baseConversation, otherConversation] });
    listMessagesMock.mockImplementation(async (id: string) => ({
      messages: id === "conv-2" ? [freshMessage] : [baseUserMessage],
    }));

    renderChat();

    // Mount + initial auto-select already records conv-1 for the panel.
    await waitForConversationLoaded();
    expect(window.localStorage.getItem(LAST_COPILOT_CONVERSATION_KEY)).toBe("conv-1");

    await waitFor(() => expect(screen.getAllByText("目标对话").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: /目标对话/ })[0]!);
    await waitFor(() => expect(screen.getByText("最新内容")).toBeTruthy());
    expect(window.localStorage.getItem(LAST_COPILOT_CONVERSATION_KEY)).toBe("conv-2");
  });

  it("falls back to the generic edit error for other failures", async () => {
    editMessageMock.mockRejectedValue(new Error("boom"));

    renderChat();

    await waitForConversationLoaded();
    fireEvent.click(
      screen.getByRole("button", { name: "编辑消息（删除该消息及之后所有内容并重新运行）" })
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并重新运行" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("编辑失败，请重试。"));
  });
  it("does not submit Enter while a restored legacy approval state is pending", async () => {
    const run = { id: "run-1", conversationId: "conv-1", status: "awaiting_approval", revision: 3 };
    listRunsMock.mockResolvedValue({ runs: [run], activeRun: run });
    getRunMock.mockResolvedValue({ run, pendingActions: [{ id: "action", runId: "run-1", tool: "create_project", status: "pending", inputJson: "{}", inputDigest: "digest" }] });
    renderChat();
    await waitFor(() => expect((screen.getByRole("combobox", { name: "项目上下文" })).hasAttribute("disabled")).toBe(true));
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "继续" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await act(async () => {});
    expect(sendMessageMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await waitFor(() => expect(cancelRunMock).toHaveBeenCalledWith("run-1"));
  });

});
