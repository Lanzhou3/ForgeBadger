"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon as FitAddonInstance } from "@xterm/addon-fit";
import type { Terminal as TerminalInstance } from "@xterm/xterm";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { copySelectedTerminalText, shouldCopyTerminalSelection } from "@/lib/terminal-copy";
import { createTerminalInputMessage, createTerminalResizeMessage } from "@/lib/terminal-messages";
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

function getReconnectDelay(attempt: number): number {
  const index = Math.min(attempt, RECONNECT_DELAYS.length - 1);
  return RECONNECT_DELAYS[index] as number;
}

export function TerminalView({
  sessionId,
  authToken,
  attachToken
}: {
  sessionId: string;
  authToken: string;
  attachToken: string;
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

      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (terminal && fitAddon) {
        fitAddon.fit();
        const resizeMessage = createTerminalResizeMessage({
          cols: terminal.cols,
          rows: terminal.rows
        });
        if (resizeMessage) {
          socket.send(resizeMessage);
        }
      }
    });

    socket.addEventListener("message", (event) => {
      const terminal = terminalRef.current;
      if (!terminal) return;

      const message = parseTerminalWebSocketMessage(String(event.data));
      if (!message) return;

      if (message.type === "terminal_output") {
        terminal.write(message.payload.data);
      }

      if (message.type === "terminal_error") {
        terminal.writeln(`\r\n[openforge] ${message.payload.message}`);
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
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(createTerminalInputMessage(data));
        }
      });
      replaceTerminalInputListener(inputDisposableRef, disposable);
    }
  }, [sessionId, authToken, attachToken, terminalReady]);

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

    const resize = () => {
      const fitAddon = fitAddonRef.current;
      const socket = socketRef.current;
      const terminal = terminalRef.current;
      if (!fitAddon || !terminal) return;

      fitAddon.fit();
      if (socket && socket.readyState === WebSocket.OPEN) {
        const resizeMessage = createTerminalResizeMessage({
          cols: terminal.cols,
          rows: terminal.rows
        });
        if (resizeMessage) {
          socket.send(resizeMessage);
        }
      }
    };

    resize();
    window.addEventListener("resize", resize);
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
      resizeObserver?.disconnect();
      resizeHandlerRef.current = null;
    };
  }, [terminalReady]);

  const showReconnectingOverlay = status === "reconnecting";
  const showFailedOverlay = status === "failed";
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
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-[#05070a]"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 rounded-full", statusTone)} aria-hidden="true" />
          <span aria-live="polite">{status}</span>
          {attemptCount > 0 && status !== "connected" && (
            <span className="text-amber-300">
              {attemptCount}/{MAX_RECONNECT_ATTEMPTS}
            </span>
          )}
        </div>
        <span className="min-w-0 truncate font-mono">session {sessionId}</span>
      </div>
      {!authToken || !attachToken ? (
        <div className="p-4 text-sm text-destructive">
          {t("terminal.missingCredentials")}
        </div>
      ) : null}
      <div className="relative h-full min-h-0 overflow-hidden">
        <div
          ref={hostRef}
          data-testid="terminal-host"
          className="h-full min-h-0 p-2 [&_.xterm-screen]:!h-full [&_.xterm-viewport]:!h-full [&_.xterm]:h-full"
        />
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
