// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LanguageProvider } from "@/hooks/use-language";
import { OPENFORGE_GATEWAY_EVENT } from "@/lib/gateway-events";
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
  cancelRunMock,
  decidePendingActionMock,
  getRunMock,
} = vi.hoisted(() => ({
  createConversationMock: vi.fn(),
  listMessagesMock: vi.fn(),
  renameConversationMock: vi.fn(),
  sendMessageMock: vi.fn(),
  cancelRunMock: vi.fn(),
  decidePendingActionMock: vi.fn(),
  getRunMock: vi.fn(),
}));

vi.mock("@/lib/copilot-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot-api")>();
  return {
    ...actual,
    createConversation: createConversationMock,
    listMessages: listMessagesMock,
    renameConversation: renameConversationMock,
    sendMessage: sendMessageMock,
    cancelRun: cancelRunMock,
    decidePendingAction: decidePendingActionMock,
    getRun: getRunMock,
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

function renderPanel(overrides: { onClose?: () => void; onExpandFull?: (id: string | null) => void } = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onExpandFull = overrides.onExpandFull ?? vi.fn();
  render(
    <LanguageProvider>
      <RobotChatPanel onClose={onClose} onExpandFull={onExpandFull} />
    </LanguageProvider>
  );
  return { onClose, onExpandFull };
}

function dispatchRunUpdated(payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(OPENFORGE_GATEWAY_EVENT, {
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

describe("RobotChatPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    createConversationMock.mockResolvedValue({ conversation: newConversation });
    listMessagesMock.mockResolvedValue({ messages: [] });
    renameConversationMock.mockResolvedValue({ conversation: newConversation });
    sendMessageMock.mockResolvedValue({ runId: "run-1" });
    cancelRunMock.mockResolvedValue({ cancelled: true, runId: "run-1" });
    decidePendingActionMock.mockResolvedValue({ resumed: true, runId: "run-1" });
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
  });

  it("renders the header actions, the empty state, and the floating panel shape", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "展开全屏" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
    expect(screen.getByText("你好，我是 Copilot")).toBeTruthy();
    // Mobile (<768px): near-fullscreen bottom sheet; desktop: 380x520 card
    // anchored bottom-right above the robot.
    const panel = screen.getByTestId("robot-chat-panel");
    expect(panel.className).toContain("inset-x-2");
    expect(panel.className).toContain("bottom-2");
    expect(panel.className).toContain("md:w-[380px]");
    expect(panel.className).toContain("md:h-[520px]");
    expect(panel.className).toContain("md:bottom-24");
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
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("conv-new", "帮我看看进度", undefined));
    expect(window.localStorage.getItem(ROBOT_CONVERSATION_STORAGE_KEY)).toBe("conv-new");
    // The new conversation gets an auto title from the first message.
    await waitFor(() => expect(renameConversationMock).toHaveBeenCalledWith("conv-new", "帮我看看进度"));
  });

  it("shows the thinking pulse immediately on send, before the POST answers", async () => {
    const blockedCreate = deferred<{ conversation: typeof newConversation }>();
    const blockedSend = deferred<{ runId: string }>();
    createConversationMock.mockReturnValue(blockedCreate.promise);
    sendMessageMock.mockReturnValue(blockedSend.promise);
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });

    // Neither createConversation nor sendMessage has resolved, yet the panel
    // must already show the pulsing thinking indicator — no dead air while
    // the dsh runtime cold-starts.
    expect(screen.getByText("Copilot 正在思考…")).toBeTruthy();

    await act(async () => {
      blockedCreate.resolve({ conversation: newConversation });
    });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    // Still thinking while the send POST is in flight.
    expect(screen.getByText("Copilot 正在思考…")).toBeTruthy();

    await act(async () => {
      blockedSend.resolve({ runId: "run-1" });
    });
    // The placeholder graduated to running; still no text, so the indicator
    // stays until the first delta or terminal event arrives.
    expect(screen.getByText("Copilot 正在思考…")).toBeTruthy();

    dispatchRunUpdated({ run_id: "run-1", status: "completed" });
    await waitFor(() => expect(screen.queryByText("Copilot 正在思考…")).toBeNull());
  });

  it("clears the thinking pulse and shows the send error when the POST fails", async () => {
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
    expect(screen.getByText("发送失败，请检查 Gateway 服务。")).toBeTruthy();
  });

  it("renders streaming text deltas for the active run", async () => {
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "hi" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());

    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "正在" });
    dispatchRunUpdated({ run_id: "run-1", status: "running", text_delta: "生成回复" });

    await waitFor(() => expect(screen.getByText("正在生成回复")).toBeTruthy());

    dispatchRunUpdated({ run_id: "run-1", status: "completed" });
    await waitFor(() => expect(screen.queryByText("正在生成回复")).toBeNull());
  });

  it("approves a pending action from the approval card", async () => {
    window.localStorage.setItem(ROBOT_CONVERSATION_STORAGE_KEY, "conv-stored");
    listMessagesMock.mockResolvedValue({ messages: [storedMessage] });
    renderPanel();

    await waitFor(() => expect(screen.getByText("上次的问题")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("输入消息……"), { target: { value: "跑一下构建" } });
    fireEvent.keyDown(screen.getByPlaceholderText("输入消息……"), { key: "Enter" });
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith("conv-stored", "跑一下构建", undefined));

    dispatchRunUpdated({
      run_id: "run-1",
      status: "awaiting_approval",
      pending_action_id: "act-1",
      tool_name: "run_terminal",
    });

    await waitFor(() => expect(screen.getByText("需要批准")).toBeTruthy());
    expect(screen.getByText("run_terminal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "批准" }));

    await waitFor(() => expect(decidePendingActionMock).toHaveBeenCalledWith("run-1", "act-1", true));
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
    listMessagesMock.mockRejectedValue(new Error("not found"));

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

  it("sends a suggestion chip from the empty state", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "我的项目状态如何？" }));

    await waitFor(() => expect(createConversationMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith("conv-new", "我的项目状态如何？", undefined)
    );
    // The empty state is replaced by the conversation.
    expect(screen.queryByRole("button", { name: "列出进行中的会话" })).toBeNull();
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
});
