"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon as FitAddonInstance } from "@xterm/addon-fit";
import type { Terminal as TerminalInstance } from "@xterm/xterm";

import { Button } from "@/components/ui/button";
import { SessionOutputHistory } from "@/components/sessions/session-output-history";
import { useLanguage } from "@/hooks/use-language";
import { resolveWheelAction } from "@/lib/terminal-scroll";
import { copySelectedTerminalText, shouldCopyTerminalSelection } from "@/lib/terminal-copy";
import { createTerminalInputMessage, createTerminalResizeMessage } from "@/lib/terminal-messages";
import { createTerminalPromptCapture } from "@/lib/terminal-prompt-capture";
import { notifySessionTabsChanged, setSessionTabPrompt } from "@/lib/session-tabs";
import { parseTerminalWebSocketMessage } from "@/lib/terminal-websocket-messages";
import { replaceTerminalInputListener, type DisposableInputListener } from "@/lib/terminal-input-listener";
import { cn } from "@/lib/utils";
import { terminalWebSocketProtocols, terminalWebSocketUrl } from "../lib/ws";

type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
/** Fonts and dev-mode CSS can settle right after the socket opens; re-fit once
 * shortly after connect so the server-side window converges to the real pane. */
const RESIZE_SETTLE_DELAY_MS = 400;

function getReconnectDelay(attempt: number): number {
  const index = Math.min(attempt, RECONNECT_DELAYS.length - 1);
  return RECONNECT_DELAYS[index] as number;
}

export function TerminalView({
  sessionId,
  authToken,
  attachToken,
  historyOpen = false,
  onHistoryClose,
}: {
  sessionId: string;
  authToken: string;
  attachToken: string;
  /** Controlled read-only output-history overlay (trigger lives in the tab strip). */
  historyOpen?: boolean;
  onHistoryClose?: () => void;
}) {
  const { t } = useLanguage();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const fitAddonRef = useRef<FitAddonInstance | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptCountRef = useRef(0);
  const inputDisposableRef = useRef<DisposableInputListener | null>(null);
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const promptCaptureRef = useRef(createTerminalPromptCapture());
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [attemptCount, setAttemptCount] = useState(0);
  const [terminalReady, setTerminalReady] = useState(false);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  /**
   * Fit xterm to the host and push the size to the gateway when it changed.
   * Fitting still happens with a closed socket so the canvas always matches
   * the pane; `force` resends even when the dimensions look unchanged (used
   * right after connect, when an earlier fit may have run before layout/CSS
   * had fully settled and its resize message was dropped).
   */
  const fitAndSendResize = useCallback((force = false) => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    fitAddon.fit();
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const last = lastSentSizeRef.current;
    const changed = !last || last.cols !== terminal.cols || last.rows !== terminal.rows;
    if (!force && !changed) return;

    const resizeMessage = createTerminalResizeMessage({
      cols: terminal.cols,
      rows: terminal.rows
    });
    if (resizeMessage) {
      socket.send(resizeMessage);
      lastSentSizeRef.current = { cols: terminal.cols, rows: terminal.rows };
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (!terminalReady) return;
    if (!authToken || !attachToken) {
      setStatus("disconnected");
      return;
    }

    const socket = new WebSocket(
      terminalWebSocketUrl(sessionId),
      terminalWebSocketProtocols(authToken, attachToken)
    );
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (!mountedRef.current) return;
      attemptCountRef.current = 0;
      setAttemptCount(0);
      setStatus("connected");

      lastSentSizeRef.current = null;
      fitAndSendResize(true);
      // Layout can settle right after open (fonts, dev-mode CSS); re-fit once
      // and push any correction so the tmux window converges to the real pane.
      window.setTimeout(() => {
        if (mountedRef.current) fitAndSendResize();
      }, RESIZE_SETTLE_DELAY_MS);
    });

    socket.addEventListener("message", (event) => {
      const terminal = terminalRef.current;
      if (!terminal) return;

      const message = parseTerminalWebSocketMessage(String(event.data));
      if (!message) return;

      if (message.type === "terminal_history") {
        // Scrollback replay, always sent before the live attach stream. Reset
        // first: on a socket reconnect the same xterm instance is reused, and
        // replaying on top of the old buffer would duplicate every line (and,
        // if a full-screen TUI had switched xterm to the alternate buffer,
        // corrupt the live frame). The reset leaves a clean normal buffer for
        // the history; the live repaint that follows paints the current UI.
        terminal.reset();
        terminal.write(message.payload.data);
      }

      if (message.type === "terminal_output") {
        terminal.write(message.payload.data);
      }

      if (message.type === "terminal_error") {
        terminal.writeln(`\r\n[forgebadger] ${message.payload.message}`);
      }
    });

    socket.addEventListener("close", (event) => {
      if (!mountedRef.current) return;
      socketRef.current = null;

      if (event.wasClean) {
        replaceTerminalInputListener(inputDisposableRef, null);
        setStatus("disconnected");
        return;
      }

      replaceTerminalInputListener(inputDisposableRef, null);
      const nextAttempt = attemptCountRef.current + 1;
      attemptCountRef.current = nextAttempt;
      setAttemptCount(nextAttempt);

      if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
        setStatus("failed");
        return;
      }

      setStatus("reconnecting");
      const delay = getReconnectDelay(nextAttempt - 1);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    });

    const terminal = terminalRef.current;
    if (terminal) {
      replaceTerminalInputListener(inputDisposableRef, null);
      const disposable = terminal.onData((data) => {
        const prompt = promptCaptureRef.current.push(data);
        if (prompt) {
          setSessionTabPrompt(sessionId, prompt);
          notifySessionTabsChanged();
        }
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(createTerminalInputMessage(data));
        }
      });
      replaceTerminalInputListener(inputDisposableRef, disposable);
    }
  }, [sessionId, authToken, attachToken, terminalReady, fitAndSendResize]);

  const handleManualReconnect = useCallback(() => {
    clearReconnectTimer();
    attemptCountRef.current = 0;
    setAttemptCount(0);
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setStatus("connecting");
    connect();
  }, [clearReconnectTimer, connect]);

  // Initialize terminal instance once
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]).then(
        ([xterm, fit]) => {
          const host = hostRef.current;
          if (cancelled || !host) return;

          const terminal = new xterm.Terminal({
            cursorBlink: true,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            fontSize: 14,
            theme: {
              background: "#05070a",
              foreground: "#e5edf7",
              cursor: "#5cc8ff"
            }
          });
          terminal.attachCustomKeyEventHandler((event) => {
            if (event.type !== "keydown") return true;
            if (!shouldCopyTerminalSelection(event, terminal.hasSelection())) return true;

            event.preventDefault();
            void copySelectedTerminalText(terminal);
            return false;
          });
          // Full-screen TUIs (Claude Code / Kimi Code) run on the alternate
          // screen with mouse reporting disabled, so xterm's alternateScroll
          // converts the wheel into ↑/↓ key sequences that pollute the input
          // history. Suppress only in that state; OpenCode (mouse on) keeps its
          // SGR wheel events and the normal buffer keeps its scrollback scroll.
          terminal.attachCustomWheelEventHandler((event) => {
            const suppress =
              resolveWheelAction(
                terminal.buffer.active.type,
                // Prefer xterm's public terminal-mode API over renderer CSS.
                terminal.modes.mouseTrackingMode !== "none"
              ) === "suppress";
            if (suppress) {
              event.preventDefault();
              return false; // 阻止 xterm alternateScroll（滚轮→↑/↓）
            }
            return true;
          });
          const fitAddon = new fit.FitAddon();
          terminal.loadAddon(fitAddon);
          terminal.open(host);
          terminalRef.current = terminal;
          fitAddonRef.current = fitAddon;

          window.requestAnimationFrame(() => {
            if (cancelled) return;
            fitAddon.fit();
            setTerminalReady(true);
          });
        }
      );
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setTerminalReady(false);
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Manage connection lifecycle
  useEffect(() => {
    if (!terminalReady) {
      return;
    }
    if (!authToken || !attachToken) {
      setStatus("disconnected");
      return;
    }

    mountedRef.current = true;
    setStatus("connecting");
    connect();

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      replaceTerminalInputListener(inputDisposableRef, null);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [authToken, attachToken, connect, clearReconnectTimer, terminalReady]);

  // Resize handler
  useEffect(() => {
    if (!terminalReady) {
      return;
    }

    const resize = () => fitAndSendResize();
    const onVisibilityChange = () => {
      // ResizeObserver does not fire while the tab is hidden; catch up when
      // the page becomes visible again so the gateway learns the real size.
      if (document.visibilityState === "visible") fitAndSendResize();
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    resizeHandlerRef.current = resize;
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    const host = hostRef.current;
    if (resizeObserver && host) {
      resizeObserver.observe(host);
      if (host.parentElement) {
        resizeObserver.observe(host.parentElement);
      }
    }

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resizeObserver?.disconnect();
      resizeHandlerRef.current = null;
    };
  }, [terminalReady, fitAndSendResize]);

  const showReconnectingOverlay = status === "reconnecting";
  const showFailedOverlay = status === "failed";
  // The status strip only earns its vertical space when something is wrong or
  // in flux; a healthy connection stays invisible (VS Code-style chrome).
  const showStatusBar = status !== "connected";
  const statusTone =
    status === "connected"
      ? "bg-emerald-500"
      : status === "reconnecting"
        ? "bg-amber-400"
        : status === "failed"
          ? "bg-red-500"
          : "bg-muted-foreground";

  return (
    <div
      data-testid="terminal-frame"
      className={cn(
        "grid h-full min-h-0 overflow-hidden rounded-lg border border-border bg-[#05070a]",
        showStatusBar ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]"
      )}
    >
      {/* The status strip only appears while the connection is in flux or
          broken; the output-history trigger lives in the tab strip above. */}
      {showStatusBar && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", statusTone)} aria-hidden="true" />
          <span aria-live="polite">{status}</span>
          {attemptCount > 0 && (
            <span className="text-amber-300">
              {attemptCount}/{MAX_RECONNECT_ATTEMPTS}
            </span>
          )}
          <span className="min-w-0 truncate font-mono">session {sessionId}</span>
        </div>
      )}
      {/* Screen readers still get the connecting → connected transition even
          though the healthy state has no visible strip. */}
      {!showStatusBar && (
        <span aria-live="polite" className="sr-only">
          {status}
        </span>
      )}
      {!authToken || !attachToken ? (
        <div className="p-4 text-sm text-destructive">
          {t("terminal.missingCredentials")}
        </div>
      ) : null}
      {/* Padding lives on the wrapper, NOT on the xterm host: FitAddon reads
          the host's computed width/height (border-box under Tailwind preflight)
          without subtracting host padding, so padding here would overshoot
          cols/rows and clip the rightmost character column. */}
      <div className="relative h-full min-h-0 overflow-hidden p-2">
        <div
          ref={hostRef}
          data-testid="terminal-host"
          className="h-full min-h-0 [&_.xterm-screen]:!h-full [&_.xterm-viewport]:!h-full [&_.xterm]:h-full"
        />
        {historyOpen && (
          <SessionOutputHistory
            sessionId={sessionId}
            authToken={authToken}
            open={historyOpen}
            onClose={() => onHistoryClose?.()}
          />
        )}
        {showReconnectingOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10">
            <div className="text-center">
              <p className="text-yellow-400 text-sm font-mono">
                {t("terminal.reconnecting")}… ({attemptCount}/{MAX_RECONNECT_ATTEMPTS})
              </p>
            </div>
          </div>
        )}
        {showFailedOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
            <div className="text-center">
              <p className="text-red-400 text-sm font-mono mb-3">
                {t("terminal.connectionLost")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleManualReconnect}
                className="text-red-400 border-red-400/50 hover:bg-red-400/10"
              >
                {t("terminal.reconnect")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
