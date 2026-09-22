// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalView } from "./terminal-view";

const terminal = vi.hoisted(() => ({
  cols: 80, rows: 24, write: vi.fn(), reset: vi.fn(), writeln: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(), attachCustomWheelEventHandler: vi.fn(),
  loadAddon: vi.fn(), open: vi.fn(), dispose: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })),
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
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const queryClient = new QueryClient();
function renderTerminalView(props: { sessionId: string; authToken: string; attachToken: string }) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TerminalView {...props} />
    </QueryClientProvider>
  );
}
async function start() {
  const view = renderTerminalView({ sessionId: "s", authToken: "a", attachToken: "t" });
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  act(() => socket.dispatchEvent(new Event("open")));
  return { view, socket };
}
it("ACKs each frame only after xterm consumption and ignores callbacks after unmount", async () => {
  const { view, socket } = await start();
  act(() => { socket.message("terminal_history", { data: "history", sequence: 1 }); socket.message("terminal_output", { data: "live", sequence: 2 }); });
  expect(terminal.reset).toHaveBeenCalledOnce();
  expect(terminal.write.mock.calls.map(call => call[0])).toEqual(["history", "live"]);
  expect(socket.send.mock.calls.some(call => String(call[0]).includes("terminal_ack"))).toBe(false);
  act(() => terminal.write.mock.calls[0]![1]());
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 1 } }));
  view.unmount();
  terminal.write.mock.calls[1]![1]();
  expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "terminal_ack", payload: { sequence: 2 } }));
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
