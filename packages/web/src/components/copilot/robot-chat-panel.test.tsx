// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { FORGEBADGER_GATEWAY_EVENT } from "@/lib/gateway-events";
import { GatewayApiError } from "@/lib/api";
import {
  ROBOT_CONVERSATION_STORAGE_KEY,
  RobotChatPanel,
} from "@/components/copilot/robot-chat-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  createConversationMock,
  listMessagesMock,
  renameConversationMock,
  sendMessageMock,
  editMessageMock,
  cancelRunMock,
  getRunMock,
  listRunsMock,
  getCopilotPreferencesMock,
  updateCopilotPreferencesMock,
  listProjectsMock,
  listModelProvidersMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  createConversationMock: vi.fn(),
  listMessagesMock: vi.fn(),
  renameConversationMock: vi.fn(),
  sendMessageMock: vi.fn(),
  editMessageMock: vi.fn(),
  cancelRunMock: vi.fn(),
  getRunMock: vi.fn(),
  listRunsMock: vi.fn(),
  getCopilotPreferencesMock: vi.fn(),
  updateCopilotPreferencesMock: vi.fn(),
  listProjectsMock: vi.fn(),
  listModelProvidersMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    createConversation: createConversationMock,
    listMessages: listMessagesMock,
    renameConversation: renameConversationMock,
    sendMessage: sendMessageMock,
    editMessage: editMessageMock,
    cancelRun: cancelRunMock,
    getRun: getRunMock,
    listConversationRuns: listRunsMock,
    getCopilotPreferences: getCopilotPreferencesMock,
    updateCopilotPreferences: updateCopilotPreferencesMock,
    listFollowups: vi.fn().mockResolvedValue({ followups: [] }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listProjects: listProjectsMock,
    listModelProviders: listModelProvidersMock,
  };
});

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: toastErrorMock },
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

// jsdom does not implement Element.scrollTo; the panel pins to the newest
// message on updates. A spy so tests can assert follow/pause behavior.
const scrollToSpy = vi.fn();
Element.prototype.scrollTo = scrollToSpy;

const storedConversation = {
  id: "conv-stored",
  title: "既有会话",
  status: "active",
  created_at: 1779370000000,
  updated_at: 1779373600000,
};

const storedMessage = {
  id: "msg-stored-1",
  conversationId: "conv-stored",
  userId: "user-1",
  role: "user" as const,
  kind: "text" as const,
  content: "上次的问题",
  sequence: 1,
  createdAt: "2026-05-21T00:00:00.000Z",
};

const newConversation = {
  id: "conv-new",
  title: null,
  status: "active",
  created_at: 1779370000000,
  updated_at: 1779373600000,
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

// In-memory stand-in for the server-side preference store, mirroring the
// console test: PUTs merge into it and the GET returns the merged value.
let preferencesState: { modelId: string | null; thinkingEffort: string };

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPanel(overrides: { onClose?: () => void; onExpandFull?: (id: string | null) => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onExpandFull = overrides.onExpandFull ?? vi.fn();
  render(
    <LanguageProvider>
      <QueryClientProvider client={createQueryClient()}>
        <RobotChatPanel onClose={onClose} onExpandFull={onExpandFull} />
      </QueryClientProvider>
    </LanguageProvider>
  );
  return { onClose, onExpandFull };
}

function dispatchRunUpdated(payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(FORGEBADGER_GATEWAY_EVENT, {
        detail: { type: "copilot_run_updated", payload },
      })
    );
  });
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

async function pickOption(name: string, option: string) {
  const trigger = screen.getByRole("combobox", { name });
  fireEvent.keyDown(trigger, { key: "Enter" });
  const item = await screen.findByRole("option", { name: option });
  fireEvent.click(item);
}

describe("RobotChatPanel", () => {
  it("focuses the quick-chat input and lets keyboard users close with Escape", () => {
    const { onClose } = renderPanel();
    const input = screen.getByRole("textbox");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    listRunsMock.mockResolvedValue({ runs: [], activeRun: null });
    window.localStorage.clear();
    createConversationMock.mockResolvedValue({ conversation: newConversation });
    listMessagesMock.mockResolvedValue({ messages: [] });
    renameConversationMock.mockResolvedValue({ conversation: newConversation });
    sendMessageMock.mockResolvedValue({ runId: "run-1" });
    editMessageMock.mockResolvedValue({ runId: "run-2" });
    cancelRunMock.mockResolvedValue({ cancelled: true, runId: "run-1" });
    listProjectsMock.mockResolvedValue({ projects: [] });
    listModelProvidersMock.mockResolvedValue(baseModels);
    preferencesState = { modelId: null, thinkingEffort: "medium" };
    getCopilotPreferencesMock.mockImplementation(async () => preferencesState);
    updateCopilotPreferencesMock.mockImplementation(async (patch: Record<string, unknown>) => {
      preferencesState = { ...preferencesState, ...patch };
      return preferencesState;
    });
    getRunMock.mockResolvedValue({
      run: {
        id: "run-1",
        conversationId: "conv-new",
        userId: "user-1",
        status: "running",
        steps: 0,
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      },
      pendingActions: [],
    });
    stubRadixSelectEnvironment();
  });

  it("retries an uncertain send using the same request identity without duplicating the local message", async () => {
    sendMessageMock.mockRejectedValueOnce(new Error("response lost"));
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "派发任务" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重试" })).toBeTruthy());
    // Console-aligned failure surface: a toast plus the inline retry action.
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("发送失败，请检查 Gateway 服务。"));
    const options = sendMessageMock.mock.calls[0]![3];
    expect(options).toEqual({ clientRequestId: expect.any(String) });
    sendMessageMock.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(2));
    expect(sendMessageMock.mock.calls[1]).toEqual(["conv-new", "派发任务", undefined, options]);
    expect(screen.getAllByText("派发任务")).toHaveLength(1);
  });

  it("preserves the restored conversation when loading fails temporarily", async () => {
    window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, "conv-stored");
    listMessagesMock.mockRejectedValueOnce(new Error("offline"));
    const { onExpandFull } = renderPanel();
    await waitFor(() => expect(screen.getByText("加载失败，请检查 Gateway 服务。")).toBeTruthy());
    expect(window.localStorage.getItem(ROBOT_CONVERSATION_STORAGE_KEY)).toBe("conv-stored");
    fireEvent.click(screen.getByRole("button", { name: "展开全屏" }));
    expect(onExpandFull).toHaveBeenCalledWith("conv-stored");
  });

  it("keeps an accepted run when the subsequent message refresh fails", async () => {
    listMessagesMock.mockRejectedValue(new Error("offline"));
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "派发任务" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    // Console-aligned: a refresh failure surfaces as a toast, not a send error.
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("加载失败，请检查 Gateway 服务。"));
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it("offers cancellation for a restored awaiting approval run", async () => {
    window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, "conv-stored");
    const run = { id: "run-legacy", conversationId: "conv-stored", status: "awaiting_approval", revision: 2 };
    listRunsMock.mockResolvedValue({ runs: [run], activeRun: run });
    getRunMock.mockResolvedValue({ run, pendingActions: [] });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "停止" }));
    await waitFor(() => expect(cancelRunMock).toHaveBeenCalledWith("run-legacy"));
  });

  it("renders the header actions, the shared empty state, and the console capability chrome", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "展开全屏" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
    expect(screen.getByText("你好，我是 Copilot")).toBeTruthy();
    // Parity chrome: model / thinking pickers (shared preferences store),
    // project context, and the run-options entry all live in the panel too.
    expect(screen.getByTestId("copilot-status-bar")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "当前模型" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "思考强度" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "项目上下文" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "执行选项" })).toBeTruthy();
    // The empty state shares the console's suggestion set.
    expect(screen.getByRole("button", { name: "项目整体进展如何？" })).toBeTruthy();
    // Mobile (<768px): near-fullscreen bottom sheet; desktop: 380x520 card
    // anchored bottom-right above the robot.
    const panel = screen.getByTestId("robot-chat-panel");
    expect(panel.className).toContain("inset-x-2");
    expect(panel.className).toContain("bottom-2");
    expect(panel.className).toContain("md:w-[380px]");
    expect(panel.className).toContain("md:h-[520px]");
    expect(panel.className).toContain("md:bottom-32");
  });

  it("renders a floating composer instead of a docked bottom bar", () => {
    renderPanel();

    const panel = screen.getByTestId("robot-chat-panel");
    const composer = screen.getByTestId("robot-chat-composer");

    // Detached elevated card: rounded, translucent + blur, drop shadow.
    expect(composer.className).toContain("rounded-xl");
    expect(composer.className).toContain("bg-card/90");
    expect(composer.className).toContain("backdrop-blur-md");
    expect(composer.className).toContain("shadow-lg");
    // Hover lift and focus glow affordances.
    expect(composer.className).toContain("hover:-translate-y-0.5");
    expect(composer.className).toContain("hover:shadow-xl");
    expect(composer.className).toContain("focus-within:ring-brand/30");

    // No docked footer strip above the composer (old border-t bar removed).
    expect(composer.parentElement?.className).not.toContain("border-t");
    // Messages fade out beneath the card via an upward gradient overlay.
    expect(panel.querySelector(".pointer-events-none.bg-gradient-to-t")).toBeTruthy();
  });

  it("creates the conversation lazily on the first message and persists its id", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "帮我看看进度" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });

    // Optimistic user bubble appears immediately.
    expect(screen.getByText("帮我看看进度")).toBeTruthy();
    await waitFor(() => expect(createConversationMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("conv-new", "帮我看看进度", undefined, { clientRequestId: expect.any(String) }));
    expect(window.localStorage.getItem(ROBOT_CONVERSATION_STORAGE_KEY)).toBe("conv-new");
    // The new conversation gets an auto title from the first message.
    await waitFor(() => expect(renameConversationMock).toHaveBeenCalledWith("conv-new", "帮我看看进度"));
  });

  it("drops a duplicate submit while lazy conversation creation is in flight", async () => {
    const blockedCreate = deferred<{ conversation: typeof newConversation }>();
    const blockedSend = deferred<{ runId: string }>();
    createConversationMock.mockReturnValue(blockedCreate.promise);
    sendMessageMock.mockReturnValue(blockedSend.promise);
    renderPanel();

    const input = screen.getByPlaceholderText("输入消息……");
    fireEvent.change(input, { target: { value: "双击发送" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Second Enter lands while createConversation is still in flight and the
    // controller's sending guard is not armed yet — it must be dropped.
    fireEvent.keyDown(input, { key: "Enter" });

    await act(async () => {
      blockedCreate.resolve({ conversation: newConversation });
    });

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(createConversationMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith("conv-new", "双击发送", undefined, { clientRequestId: expect.any(String) });
    // A single optimistic bubble, not two. (The send POST stays in flight so
    // the post-send refresh cannot replace the transcript before we assert.)
    expect(screen.getAllByText("双击发送")).toHaveLength(1);

    await act(async () => {
      blockedSend.resolve({ runId: "run-1" });
    });
  });

  it("shows the thinking pulse while the lazy conversation is created and the send is in flight", async () => {
    const blockedCreate = deferred<{ conversation: typeof newConversation }>();
    const blockedSend = deferred<{ runId: string }>();
    createConversationMock.mockReturnValue(blockedCreate.promise);
    sendMessageMock.mockReturnValue(blockedSend.promise);
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });

    // The lazy create round-trip has not resolved yet, so the controller has
    // not started the turn; no dead-air claim before the send exists.
    await waitFor(() => expect(createConversationMock).toHaveBeenCalled());

    await act(async () => {
      blockedCreate.resolve({ conversation: newConversation });
    });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    // Thinking while the send POST is in flight — no dead air while the
    // Gateway starts the model turn.
    expect(screen.getByText("Copilot 正在思考…")).toBeTruthy();

    await act(async () => {
      blockedSend.resolve({ runId: "run-1" });
    });
    // The placeholder graduated to running; still no text, so the indicator
    // stays until the first delta or terminal event arrives.
    expect(screen.getByText("Copilot 正在思考…")).toBeTruthy();

    getRunMock.mockResolvedValue({ run: { id: "run-1", conversationId: "conv-new", status: "completed", revision: 3 }, pendingActions: [] });
    dispatchRunUpdated({ run_id: "run-1", status: "completed" });
    await waitFor(() => expect(screen.queryByText("Copilot 正在思考…")).toBeNull());
  });

  it("clears the thinking pulse and offers a retry when the POST fails", async () => {
    const blockedSend = deferred<{ runId: string }>();
    sendMessageMock.mockReturnValue(blockedSend.promise);
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    expect(screen.getByText("Copilot 正在思考…")).toBeTruthy();

    await act(async () => {
      blockedSend.reject(new Error("gateway down"));
    });

    await waitFor(() => expect(screen.queryByText("Copilot 正在思考…")).toBeNull());
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("发送失败，请检查 Gateway 服务。"));
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("renders streaming text deltas for the active run", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());

    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "正在" });
    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "生成回复" });

    await waitFor(() => expect(screen.getByText("正在生成回复")).toBeTruthy());

    getRunMock.mockResolvedValue({ run: { id: "run-1", conversationId: "conv-new", status: "completed", revision: 3 }, pendingActions: [] });
    dispatchRunUpdated({ run_id: "run-1", status: "completed" });
    await waitFor(() => expect(screen.queryByText("正在生成回复")).toBeNull());
  });

  it("resets to a fresh draft on new chat without creating a server conversation", async () => {
    window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, "conv-stored");
    listMessagesMock.mockResolvedValue({ messages: [storedMessage] });
    renderPanel();

    await waitFor(() => expect(screen.getByText("上次的问题")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

    await waitFor(() => expect(screen.queryByText("上次的问题")).toBeNull());
    expect(screen.getByText("你好，我是 Copilot")).toBeTruthy();
    expect(window.localStorage.getItem(ROBOT_CONVERSATION_STORAGE_KEY)).toBeNull();
    // Lazy creation: no POST until the next message is actually sent.
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("restores the persisted conversation on open and hands its id to expand", async () => {
    window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, "conv-stored");
    listMessagesMock.mockResolvedValue({ messages: [storedMessage] });
    const { onExpandFull } = renderPanel();

    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith("conv-stored"));
    await waitFor(() => expect(screen.getByText("上次的问题")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "展开全屏" }));
    expect(onExpandFull).toHaveBeenCalledWith("conv-stored");
  });

  it("drops a stale persisted conversation id when the server no longer has it", async () => {
    window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, "conv-gone");
    listMessagesMock.mockRejectedValue(new GatewayApiError("not found", 404));

    renderPanel();

    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith("conv-gone"));
    await waitFor(() => expect(screen.getByText("你好，我是 Copilot")).toBeTruthy());
    expect(window.localStorage.getItem(ROBOT_CONVERSATION_STORAGE_KEY)).toBeNull();
  });

  it("closes via the header button and reports a null conversation when empty", () => {
    const { onClose, onExpandFull } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "展开全屏" }));
    expect(onExpandFull).toHaveBeenCalledWith(null);
  });

  it("splits inline <think> blocks out of persisted assistant messages", async () => {
    window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, "conv-stored");
    listMessagesMock.mockResolvedValue({
      messages: [
        {
          id: "msg-think-1",
          conversationId: "conv-stored",
          userId: "user-1",
          role: "assistant" as const,
          kind: "text" as const,
          content: "<think>推理内容</think>正式回答",
          sequence: 1,
          createdAt: "2026-05-21T00:00:00.000Z",
        },
      ],
    });

    renderPanel();

    // The answer renders as the body; the reasoning stays folded in the dim
    // strip instead of leaking raw <think> markup into the message.
    await waitFor(() => expect(screen.getByText("正式回答")).toBeTruthy());
    expect(screen.queryByText("推理内容")).toBeNull();
    expect(screen.queryByText(/<think>/u)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /思考过程/u }));
    await waitFor(() => expect(screen.getByText("推理内容")).toBeTruthy());
  });

  it("treats an unterminated <think> in the stream as live reasoning", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());

    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "<think>推理中" });

    // Live reasoning indicator; reasoning content folded, no raw tag in body.
    await waitFor(() => expect(screen.getByText("思考过程…")).toBeTruthy());
    expect(screen.queryByText("推理中")).toBeNull();
    expect(screen.queryByText(/<think>/u)).toBeNull();

    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "</think>答案" });

    await waitFor(() => expect(screen.getByText("答案")).toBeTruthy());
  });

  it("sends a suggestion chip from the shared empty state", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "项目整体进展如何？" }));

    await waitFor(() => expect(createConversationMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith("conv-new", "项目整体进展如何？", undefined, { clientRequestId: expect.any(String) })
    );
    // The empty state is replaced by the conversation.
    expect(screen.queryByRole("button", { name: "现在有哪些会话在运行？" })).toBeNull();
  });

  it("follows the stream at the bottom and pauses when the user scrolls up", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalled());

    // The user scrolls up: distance from bottom exceeds the pin threshold.
    const scroller = screen.getByTestId("robot-chat-scroll");
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 100, configurable: true });
    fireEvent.scroll(scroller);

    await waitFor(() => expect(screen.getByRole("button", { name: "回到底部" })).toBeTruthy());

    // New tokens arrive: follow mode stays paused while the user is reading.
    const callsBefore = scrollToSpy.mock.calls.length;
    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "更多内容" });
    await waitFor(() => expect(screen.getByText("更多内容")).toBeTruthy());
    expect(scrollToSpy.mock.calls.length).toBe(callsBefore);

    // The scroll-down button resumes follow mode.
    fireEvent.click(screen.getByRole("button", { name: "回到底部" }));
    await waitFor(() => expect(scrollToSpy.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("passes the picked project context through to the send", async () => {
    listProjectsMock.mockResolvedValue({ projects: [{ id: "project-1", name: "示例项目" }] });
    renderPanel();

    await pickOption("项目上下文", "示例项目");
    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "检查这个项目" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });

    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith("conv-new", "检查这个项目", undefined, {
        projectId: "project-1",
        clientRequestId: expect.any(String),
      })
    );
  });

  it("edits a persisted user message and reruns it through the shared controller", async () => {
    window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, "conv-stored");
    listMessagesMock.mockResolvedValue({ messages: [storedMessage] });
    renderPanel();

    await waitFor(() => expect(screen.getByText("上次的问题")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /编辑消息/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存并重新运行" }));

    await waitFor(() =>
      expect(editMessageMock).toHaveBeenCalledWith("conv-stored", "msg-stored-1", "上次的问题", {
        clientRequestId: expect.any(String),
      })
    );
  });

  it("shows the follow-up queue once a conversation exists", async () => {
    renderPanel();

    // No conversation yet: the queue is not mounted.
    expect(screen.queryByRole("textbox", { name: "后续消息" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());

    // Parity with the console: queued follow-ups can be enqueued in the panel.
    expect(await screen.findByRole("textbox", { name: "后续消息" })).toBeTruthy();
  });
});
