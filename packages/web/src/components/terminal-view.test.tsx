// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TERMINAL_FONT, setTerminalFont } from "@/lib/terminal-font";
import { TerminalView } from "./terminal-view";

const fitMock = vi.hoisted(() => vi.fn());
const toolbarToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toolbarToast }));

const terminal = vi.hoisted(() => ({
  cols: 80, rows: 24, write: vi.fn(), reset: vi.fn(), writeln: vi.fn(), resize: vi.fn(), focus: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(), attachCustomWheelEventHandler: vi.fn(),
  loadAddon: vi.fn(), open: vi.fn(), input: vi.fn(), element: null as HTMLElement | null,
  modes: { mouseTrackingMode: "none" },
  options: {} as Record<string, unknown>,
  dispose: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })),
  onScroll: vi.fn(() => ({ dispose: vi.fn() })), onSelectionChange: vi.fn((listener: () => void) => ({ dispose: vi.fn(), listener })),
  scrollToBottom: vi.fn(), clear: vi.fn(), selectAll: vi.fn(), clearSelection: vi.fn(),
  getSelection: vi.fn(() => ""), hasSelection: vi.fn(() => false),
  onBell: vi.fn(() => ({ dispose: vi.fn() })),
  parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
  buffer: {
    onBufferChange: vi.fn((_listener: () => void) => ({ dispose: vi.fn() })),
    active: { type: "normal", viewportY: 0, baseY: 0, length: 2,
      getLine: vi.fn((index: number) => index < 2 ? { isWrapped: false, translateToString: () => ["buffer line 1", "buffer line 2"][index]! } : undefined),
    },
  },
}));
vi.mock("@xterm/xterm", () => ({ Terminal: class { constructor() { return terminal; } } }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() { fitMock(); } } }));
vi.mock("@/hooks/use-terminal-writer", () => ({ useTerminalWriter: () => ({ readOnly: false, refresh: vi.fn() }) }));
vi.mock("@/hooks/use-language", () => ({ useLanguage: () => ({ t: (key: string) => key, language: "zh-CN", useUiLocale: () => "en-US" })}));
vi.mock("@/components/sessions/session-output-history", () => ({ SessionOutputHistory: () => null }));
class Socket extends EventTarget {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  send = vi.fn();
  constructor() { super(); Socket.instances.push(this); }
  close(code = 1000) { this.readyState = 3; this.dispatchEvent(new CloseEvent("close", { code, wasClean: true })); }
  message(type: string, payload: object) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type, payload }) })); }
}
beforeEach(() => {
  vi.clearAllMocks();
  fitMock.mockReset();
  terminal.scrollToBottom.mockImplementation(() => { terminal.buffer.active.viewportY = terminal.buffer.active.baseY; });
  terminal.cols = 80; terminal.rows = 24;
  terminal.resize.mockImplementation((cols: number, rows: number) => { terminal.cols = cols; terminal.rows = rows; });
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  terminal.buffer.active.type = "normal";
  terminal.buffer.active.viewportY = 0;
  terminal.buffer.active.baseY = 0;
  terminal.modes.mouseTrackingMode = "none";
  terminal.element = null;
  terminal.options = {};
  terminal.getSelection.mockReturnValue("");
  terminal.hasSelection.mockReturnValue(false);
  window.localStorage.removeItem("forgebadger.terminal-font");
  // The terminal-font store is module-level; reset it so font-size tests are
  // independent of each other.
  setTerminalFont(DEFAULT_TERMINAL_FONT);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const queryClient = new QueryClient();
function renderTerminalView(props: { sessionId: string; authToken: string; attachToken: string; aiTool?: string; credentialsPending?: boolean }) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TerminalView {...props} />
    </QueryClientProvider>
  );
}
async function start(aiTool?: string) {
  const view = renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "t", aiTool });
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  act(() => socket.dispatchEvent(new Event("open")));
  return { view, socket };
}
it("sends the full trackpad distance to Codex's alternate-screen transcript", async () => {
  // Arrange
  await start("codex");
  const host = screen.getByTestId("terminal-host");
  const xtermScreen = document.createElement("div");
  xtermScreen.className = "xterm-screen";
  xtermScreen.getBoundingClientRect = () => ({ left: 100, top: 200, width: 800, height: 600 } as DOMRect);
  host.appendChild(xtermScreen);
  terminal.element = host;
  terminal.buffer.active.type = "alternate";
  terminal.modes.mouseTrackingMode = "any";
  const handleWheel = terminal.attachCustomWheelEventHandler.mock.calls[0]![0] as (event: WheelEvent) => boolean;
  const event = new WheelEvent("wheel", { deltaY: -120, clientX: 500, clientY: 500, cancelable: true });

  // Act
  const allowed = handleWheel(event);

  // Assert
  expect(allowed).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  expect(terminal.input).toHaveBeenCalledWith("\x1b[<64;41;13M".repeat(9), false);
});

it("keeps other mouse-reporting CLIs on xterm's existing wheel path", async () => {
  // Arrange
  await start("opencode");
  terminal.buffer.active.type = "alternate";
  terminal.modes.mouseTrackingMode = "any";
  const handleWheel = terminal.attachCustomWheelEventHandler.mock.calls[0]![0] as (event: WheelEvent) => boolean;

  // Act / Assert
  expect(handleWheel(new WheelEvent("wheel", { deltaY: -120 }))).toBe(true);
  expect(terminal.input).not.toHaveBeenCalled();
});
it("ACKs replay frames at receipt and live frames after xterm consumption", async () => {
  const { view, socket } = await start();
  act(() => { socket.message("terminal_history", { data: "history", sequence: 1 }); socket.message("terminal_history_end", { data: "", sequence: 2 }); socket.message("terminal_output", { data: "live", sequence: 3 }); });
  expect(terminal.reset).toHaveBeenCalledOnce();
  expect(terminal.write.mock.calls.map(call => call[0])).toEqual(["history", "live"]);
  // Replay frames ACK at receipt: the gateway output gate stops at
  // 256KB/128 unacked frames, so deferring them would hold back the
  // terminal_history_end marker itself and deadlock the replay.
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 1 } }));
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 2 } }));
  expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 3 } }));
  view.unmount();
  terminal.write.mock.calls[1]![1]();
  expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 3 } }));
});
it.each([1011, 4001])("reconnects temporary close code %s despite a clean handshake", async code => {
  const { socket } = await start();
  act(() => socket.close(code));
  expect(screen.getByText("terminal.status.reconnecting")).toBeTruthy();
});
it.each([1000, 4000, 4403, 4404])("does not reconnect terminal close code %s", async code => {
  const { socket } = await start();
  act(() => socket.close(code));
  expect(screen.getByText("terminal.status.disconnected")).toBeTruthy();
});
it("shows disconnected after process exit", async () => {
  const { socket } = await start();
  act(() => socket.message("terminal_output", { data: "final output", sequence: 1 }));
  act(() => socket.message("terminal_exit", { exitCode: 0 }));
  act(() => terminal.write.mock.calls[0]![1]());
  expect(socket.send.mock.calls.some(call => String(call[0]).includes("terminal_ack"))).toBe(false);
  expect(screen.getByText("terminal.status.disconnected")).toBeTruthy();
});
it("does not acknowledge pending old output on a replacement connection", async () => {
  const { socket, view } = await start();
  act(() => socket.message("terminal_output", { data: "old", sequence: 1 }));
  const consumeOld = terminal.write.mock.calls[0]![1];
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <TerminalView sessionId="s" authToken="a" attachToken="new-token" />
    </QueryClientProvider>
  );
  await waitFor(() => expect(Socket.instances).toHaveLength(2));
  const replacement = Socket.instances[1]!;
  act(() => { replacement.dispatchEvent(new Event("open")); consumeOld(); });
  expect(replacement.send.mock.calls.some(call => String(call[0]).includes("terminal_ack"))).toBe(false);
  act(() => socket.close(1011));
  expect(screen.getByText("terminal.status.connected")).toBeTruthy();
});
it("sticks to the bottom on new output when the user has not scrolled recently", async () => {
  const { socket } = await start();
  terminal.buffer.active.baseY = 100; // viewportY 0 < baseY 100: detached viewport
  act(() => socket.message("terminal_output", { data: "live", sequence: 1 }));
  expect(terminal.scrollToBottom).toHaveBeenCalledOnce();
});
it("keeps the viewport when the user scrolled up within the auto-stick window", async () => {
  const { socket } = await start();
  const host = screen.getByTestId("terminal-host");
  act(() => { host.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 })); });
  terminal.buffer.active.baseY = 100;
  act(() => socket.message("terminal_output", { data: "live", sequence: 1 }));
  expect(terminal.scrollToBottom).not.toHaveBeenCalled();
});
it("shows a back-to-bottom control while detached and clicking it restores the bottom", async () => {
  const { socket } = await start();
  const host = screen.getByTestId("terminal-host");
  act(() => { host.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 })); });
  terminal.buffer.active.baseY = 100;
  act(() => socket.message("terminal_output", { data: "live", sequence: 1 }));
  expect(screen.queryByText("terminal.backToBottom")).toBeNull();
  // The write callback syncs the detached state and reveals the control.
  act(() => terminal.write.mock.calls.at(-1)![1]());
  const button = await screen.findByText("terminal.backToBottom");
  act(() => button.click());
  expect(terminal.scrollToBottom).toHaveBeenCalledOnce();
  expect(terminal.focus).toHaveBeenCalledOnce();
  expect(screen.queryByText("terminal.backToBottom")).toBeNull();
});
it("updates the back-to-bottom control for native viewport scrolling that does not emit xterm onScroll", async () => {
  await start();
  await act(async () => new Promise(resolve => setTimeout(resolve, 450)));
  const viewport = document.createElement("div");
  viewport.className = "xterm-viewport";
  screen.getByTestId("terminal-host").appendChild(viewport);
  terminal.buffer.active.baseY = 100; terminal.buffer.active.viewportY = 10;

  fireEvent.scroll(viewport);

  const button = await screen.findByText("terminal.backToBottom");
  fireEvent.click(button);
  expect(terminal.buffer.active.viewportY).toBe(100);
  expect(screen.queryByText("terminal.backToBottom")).toBeNull();
});

it("stages the replay until the marker, then applies it in order", async () => {
  const { socket } = await start();
  act(() => { socket.message("terminal_history", { data: "abcd", sequence: 1 }); socket.message("terminal_output", { data: "ef", sequence: 2 }); });
  expect(terminal.reset).not.toHaveBeenCalled();
  expect(terminal.write).not.toHaveBeenCalled();
  // Buffered frames still ACK at receipt so the gateway gate keeps flowing.
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 1 } }));
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 2 } }));
  act(() => { socket.message("terminal_history_end", { data: "", sequence: 3 }); socket.message("terminal_output", { data: "live", sequence: 4 }); });
  expect(terminal.reset).toHaveBeenCalledOnce();
  expect(terminal.write.mock.calls.map(call => call[0])).toEqual(["abcd", "ef", "live"]);
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 3 } }));
  expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 4 } }));
  // Only live output written after the replay keeps write-callback ACKs.
  act(() => terminal.write.mock.calls[2]![1]());
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 4 } }));
});
it("drops a staged replay when the process exits before the marker", async () => {
  const { socket } = await start();
  act(() => { socket.message("terminal_history", { data: "history", sequence: 1 }); socket.message("terminal_exit", { exitCode: 0 }); });
  expect(terminal.write).not.toHaveBeenCalled();
  expect(terminal.reset).not.toHaveBeenCalled();
  expect(screen.getByText("terminal.status.disconnected")).toBeTruthy();
});
it("replays the staged snapshot again on a replacement connection", async () => {
  const { view, socket } = await start();
  act(() => { socket.message("terminal_history", { data: "history-1", sequence: 1 }); socket.message("terminal_history_end", { data: "", sequence: 2 }); socket.message("terminal_output", { data: "live-1", sequence: 3 }); });
  expect(terminal.write.mock.calls.map(call => call[0])).toEqual(["history-1", "live-1"]);
  view.unmount();
  renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "t" });
  await waitFor(() => expect(Socket.instances).toHaveLength(2));
  const replacement = Socket.instances[1]!;
  act(() => replacement.dispatchEvent(new Event("open")));
  act(() => { replacement.message("terminal_history", { data: "history-2", sequence: 1 }); replacement.message("terminal_history_end", { data: "", sequence: 2 }); replacement.message("terminal_output", { data: "live-2", sequence: 3 }); });
  expect(terminal.write.mock.calls.map(call => call[0])).toEqual(["history-1", "live-1", "history-2", "live-2"]);
  expect(terminal.reset).toHaveBeenCalledTimes(2);
});
it("keeps the frame layout stable when the status flips to connected", async () => {
  renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "t" });
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  expect(screen.getByText("terminal.status.connecting")).toBeTruthy();
  const frameBefore = screen.getByTestId("terminal-frame").className;
  act(() => socket.dispatchEvent(new Event("open")));
  expect(screen.queryByText("terminal.status.connecting")).toBeNull();
  expect(screen.getByTestId("terminal-frame").className).toBe(frameBefore);
});
it("shows the connecting strip instead of the credentials panel while the attach token is in flight", async () => {
  renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "", credentialsPending: true });
  await waitFor(() => expect(screen.getByText("terminal.status.connecting")).toBeTruthy());
  expect(screen.queryByText("terminal.missingCredentials")).toBeNull();
  expect(Socket.instances).toHaveLength(0);
});

describe("terminal chrome toolbar", () => {
  it("keeps the prompt at the bottom when a font resize adds scrollback", async () => {
    const { socket } = await start("codex");
    await act(async () => new Promise(resolve => setTimeout(resolve, 450)));
    terminal.buffer.active.baseY = 20; terminal.buffer.active.viewportY = 20;
    terminal.scrollToBottom.mockClear();
    fitMock.mockImplementation(() => { terminal.cols = 100; terminal.rows = 10; terminal.buffer.active.baseY = 25; });

    fireEvent.click(screen.getByRole("button", { name: "增大字号" }));

    await waitFor(() => expect(socket.send.mock.calls.map(call => JSON.parse(call[0]))).toContainEqual({ type: "terminal_resize", payload: { cols: 100, rows: 10 } }));
    expect(terminal.buffer.active.viewportY).toBe(25);
    expect(terminal.scrollToBottom).toHaveBeenCalled();
  });
  it("preserves the history reading position during a font resize", async () => {
    const { socket } = await start("codex");
    await act(async () => new Promise(resolve => setTimeout(resolve, 450)));
    terminal.buffer.active.baseY = 20; terminal.buffer.active.viewportY = 4;
    terminal.scrollToBottom.mockClear();
    fitMock.mockImplementation(() => { terminal.cols = 100; terminal.rows = 10; terminal.buffer.active.baseY = 25; });

    fireEvent.click(screen.getByRole("button", { name: "增大字号" }));

    await waitFor(() => expect(socket.send.mock.calls.map(call => JSON.parse(call[0]))).toContainEqual({ type: "terminal_resize", payload: { cols: 100, rows: 10 } }));
    expect(terminal.buffer.active.viewportY).toBe(4);
    expect(terminal.scrollToBottom).not.toHaveBeenCalled();
  });
  it("re-fits and reports terminal geometry after changing font size without reconnecting or sending input", async () => {
    const { socket } = await start("codex");
    // Let the initial socket-open layout-settle fit finish before the action.
    await act(async () => new Promise(resolve => setTimeout(resolve, 450)));
    fitMock.mockImplementation(() => { terminal.cols = 120 - Number(terminal.options.fontSize); terminal.rows = 48; });
    socket.send.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "增大字号" }));
    await waitFor(() => expect(socket.send.mock.calls.map(call => JSON.parse(call[0]))).toContainEqual({ type: "terminal_resize", payload: { cols: 105, rows: 48 } }));
    expect(Socket.instances).toHaveLength(1);
    expect(socket.send.mock.calls.some(call => JSON.parse(call[0]).type === "terminal_input")).toBe(false);
    fitMock.mockReset(); terminal.cols = 80; terminal.rows = 24;
  });
  it("keeps a small font on a large screen within the Gateway's terminal size limits", async () => {
    const { socket } = await start("codex");
    await act(async () => new Promise(resolve => setTimeout(resolve, 450)));
    fitMock.mockImplementation(() => { terminal.cols = 800; terminal.rows = 300; });
    socket.send.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "减小字号" }));

    await waitFor(() => expect(socket.send.mock.calls.map(call => JSON.parse(call[0]))).toContainEqual({ type: "terminal_resize", payload: { cols: 500, rows: 200 } }));
    expect(terminal.cols).toBe(500);
    expect(terminal.rows).toBe(200);
    expect(socket.send.mock.calls.some(call => JSON.parse(call[0]).type === "terminal_input")).toBe(false);
  });
  it("adjusts the font size and persists it through the terminal-font store", async () => {
    renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "t" });
    const toolbar = await screen.findByTestId("terminal-toolbar");

    act(() => screen.getByRole("button", { name: "增大字号" }).click());
    expect(JSON.parse(window.localStorage.getItem("forgebadger.terminal-font")!).fontSize).toBe(15);
    expect(within(toolbar).getByText("15")).toBeTruthy();

    act(() => screen.getByRole("button", { name: "减小字号" }).click());
    act(() => screen.getByRole("button", { name: "减小字号" }).click());
    expect(JSON.parse(window.localStorage.getItem("forgebadger.terminal-font")!).fontSize).toBe(13);

    // The live xterm instance follows the same store.
    expect(terminal.options.fontSize).toBe(13);
  });

  it("clamps the font size at the supported bounds", async () => {
    renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "t" });
    await screen.findByTestId("terminal-toolbar");
    for (let index = 0; index < 40; index += 1) {
      act(() => screen.getByRole("button", { name: "增大字号" }).click());
    }
    expect(JSON.parse(window.localStorage.getItem("forgebadger.terminal-font")!).fontSize).toBe(32);
    expect((screen.getByRole("button", { name: "增大字号" }) as HTMLButtonElement).disabled).toBe(true);
    for (let index = 0; index < 80; index += 1) {
      act(() => screen.getByRole("button", { name: "减小字号" }).click());
    }
    expect(JSON.parse(window.localStorage.getItem("forgebadger.terminal-font")!).fontSize).toBe(8);
    expect((screen.getByRole("button", { name: "减小字号" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears the terminal from the toolbar", async () => {
    await start();
    await screen.findByTestId("terminal-toolbar");
    act(() => screen.getByRole("button", { name: "清屏" }).click());
    expect(terminal.clear).toHaveBeenCalledTimes(1);
    expect(terminal.clearSelection).toHaveBeenCalledTimes(1);
    expect(Socket.instances[0]!.send.mock.calls.some(call => JSON.parse(call[0]).type === "terminal_input")).toBe(false);
  });

  it("protects full-screen CLI state from local clear and re-enables clear after leaving the alternate buffer", async () => {
    await start("codex");
    const changed = terminal.buffer.onBufferChange.mock.calls[0]![0] as unknown as () => void;
    act(() => { terminal.buffer.active.type = "alternate"; changed(); });
    const clear = screen.getByRole("button", { name: "清屏" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    expect(clear.title).toContain("全屏 CLI");
    fireEvent.click(clear);
    expect(terminal.clear).not.toHaveBeenCalled();
    act(() => { terminal.buffer.active.type = "normal"; changed(); });
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    expect(terminal.clear).toHaveBeenCalledTimes(1);
  });

  it("reports clipboard failure, re-enables copying and never sends clipboard content to the CLI", async () => {
    const { socket } = await start();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    fireEvent.click(screen.getByRole("button", { name: "复制全部" }));
    await waitFor(() => expect(toolbarToast.error).toHaveBeenCalled());
    expect((screen.getByRole("button", { name: "复制全部" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "复制全部" }));
    await waitFor(() => expect(toolbarToast.success).toHaveBeenCalled());
    expect(socket.send.mock.calls.some(call => JSON.parse(call[0]).type === "terminal_input")).toBe(false);
  });

  it("re-enables copy after a pending clipboard write finishes while reconnect credentials are in flight", async () => {
    const { view } = await start("codex");
    let complete!: () => void;
    vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "复制全部" }));
    expect((screen.getByRole("button", { name: "复制全部" }) as HTMLButtonElement).disabled).toBe(true);
    const renderProps = (attachToken: string) => (
      <QueryClientProvider client={queryClient}>
        <TerminalView sessionId="s" authToken="a" attachToken={attachToken} credentialsPending={!attachToken} aiTool="codex" />
      </QueryClientProvider>
    );

    view.rerender(renderProps(""));
    await act(async () => { complete(); });
    view.rerender(renderProps("new-token"));

    await waitFor(() => expect((screen.getByRole("button", { name: "复制全部" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "复制全部" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
  });

  it("copies the selection only when one exists", async () => {
    await start();
    await screen.findByTestId("terminal-toolbar");

    const copySelection = screen.getByRole("button", { name: "复制选中内容" });
    expect((copySelection as HTMLButtonElement).disabled).toBe(true);

    // Simulate xterm reporting an active selection.
    terminal.hasSelection.mockReturnValue(true);
    terminal.getSelection.mockReturnValue("selected text");
    const onSelectionChange = terminal.onSelectionChange.mock.calls[0]![0] as unknown as () => void;
    act(() => onSelectionChange());
    expect((screen.getByRole("button", { name: "复制选中内容" }) as HTMLButtonElement).disabled).toBe(false);

    act(() => screen.getByRole("button", { name: "复制选中内容" }).click());
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("selected text"));
  });

  it("copies the whole buffer without replacing the user's existing selection", async () => {
    await start();
    await screen.findByTestId("terminal-toolbar");
    terminal.getSelection.mockReturnValue("existing selection");
    act(() => screen.getByRole("button", { name: "复制全部" }).click());
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("buffer line 1\nbuffer line 2"));
    expect(terminal.selectAll).not.toHaveBeenCalled();
    expect(terminal.clearSelection).not.toHaveBeenCalled();
    expect(terminal.getSelection()).toBe("existing selection");
  });

  it("shows the connection status dot with the current status label", async () => {
    renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "t" });
    const toolbar = await screen.findByTestId("terminal-toolbar");
    expect(within(toolbar).getByRole("status").getAttribute("aria-label")).toBe("terminal.status.connecting");
    await waitFor(() => expect(Socket.instances).toHaveLength(1));
    act(() => Socket.instances[0]!.dispatchEvent(new Event("open")));
    expect(within(toolbar).getByRole("status").getAttribute("aria-label")).toBe("terminal.status.connected");
  });
});
