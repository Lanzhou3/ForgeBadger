// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalView } from "./terminal-view";

const terminal = vi.hoisted(() => ({
  cols: 80, rows: 24, write: vi.fn(), reset: vi.fn(), writeln: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(), attachCustomWheelEventHandler: vi.fn(),
  loadAddon: vi.fn(), open: vi.fn(), input: vi.fn(), element: null as HTMLElement | null,
  modes: { mouseTrackingMode: "none" },
  dispose: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })),
  onScroll: vi.fn(() => ({ dispose: vi.fn() })), scrollToBottom: vi.fn(),
  onBell: vi.fn(() => ({ dispose: vi.fn() })),
  parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
  buffer: { active: { type: "normal", viewportY: 0, baseY: 0 } },
}));
vi.mock("@xterm/xterm", () => ({ Terminal: class { constructor() { return terminal; } } }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@/hooks/use-terminal-writer", () => ({ useTerminalWriter: () => ({ readOnly: false, refresh: vi.fn() }) }));
vi.mock("@/hooks/use-language", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
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
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  terminal.buffer.active.type = "normal";
  terminal.buffer.active.viewportY = 0;
  terminal.buffer.active.baseY = 0;
  terminal.modes.mouseTrackingMode = "none";
  terminal.element = null;
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
  expect(screen.getByText("reconnecting")).toBeTruthy();
});
it.each([1000, 4000, 4403, 4404])("does not reconnect terminal close code %s", async code => {
  const { socket } = await start();
  act(() => socket.close(code));
  expect(screen.getByText("disconnected")).toBeTruthy();
});
it("shows disconnected after process exit", async () => {
  const { socket } = await start();
  act(() => socket.message("terminal_output", { data: "final output", sequence: 1 }));
  act(() => socket.message("terminal_exit", { exitCode: 0 }));
  act(() => terminal.write.mock.calls[0]![1]());
  expect(socket.send.mock.calls.some(call => String(call[0]).includes("terminal_ack"))).toBe(false);
  expect(screen.getByText("disconnected")).toBeTruthy();
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
  expect(screen.getByText("connected")).toBeTruthy();
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
  expect(screen.getByText("disconnected")).toBeTruthy();
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
  expect(screen.getByText("connecting")).toBeTruthy();
  const frameBefore = screen.getByTestId("terminal-frame").className;
  act(() => socket.dispatchEvent(new Event("open")));
  expect(screen.queryByText("connecting")).toBeNull();
  expect(screen.getByTestId("terminal-frame").className).toBe(frameBefore);
});
it("shows the connecting strip instead of the credentials panel while the attach token is in flight", async () => {
  renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "", credentialsPending: true });
  await waitFor(() => expect(screen.getByText("connecting")).toBeTruthy());
  expect(screen.queryByText("terminal.missingCredentials")).toBeNull();
  expect(Socket.instances).toHaveLength(0);
});
