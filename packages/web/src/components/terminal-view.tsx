"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon as FitAddonInstance } from "@xterm/addon-fit";
import type { Terminal as TerminalInstance } from "@xterm/xterm";
import { ArrowDown, ClipboardCopy, Copy, Eraser, GripVertical, Minus, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useTerminalWriter } from "@/hooks/use-terminal-writer";
import { useColorMode } from "@/hooks/use-color-mode";
import { useTerminalFont } from "@/hooks/use-terminal-font";
import { useTerminalToolbarDrag } from "@/hooks/use-terminal-toolbar-drag";
import { Button } from "@/components/ui/button";
import { SessionOutputHistory } from "@/components/sessions/session-output-history";
import { useLanguage } from "@/hooks/use-language";
import type { TranslationKey } from "@/lib/i18n";
import { updateSessionLastPrompt } from "@/lib/api";
import { resolveWheelAction } from "@/lib/terminal-scroll";
import { CodexWheelInput } from "@/lib/codex-wheel-input";
import { PiWheelInput } from "@/lib/pi-wheel-input";
import { isTerminalWheelInput } from "@/lib/terminal-wheel-input";
import { installSafariTerminalInputFix } from "@/lib/terminal-safari-input";
import { terminalAltArrowInput } from "@/lib/terminal-alt-arrows";
import { copyTerminalText, getTerminalBufferText, shouldCopyTerminalSelection } from "@/lib/terminal-copy";
import { toast } from "@/lib/toast";
import { createTerminalInputMessage, createTerminalResizeMessage, MAX_TERMINAL_COLS, MAX_TERMINAL_ROWS } from "@/lib/terminal-messages";
import { createTerminalPromptCapture } from "@/lib/terminal-prompt-capture";
import { notifySessionTabsChanged, setSessionTabPrompt } from "@/lib/session-tabs";
import { getTerminalPalette } from "@/lib/terminal-theme";
import {
  ensureTerminalFontLoaded,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  setTerminalFont,
} from "@/lib/terminal-font";
import { useTerminalToolbarCopy } from "./terminal-copy";
import { parseTerminalWebSocketMessage } from "@/lib/terminal-websocket-messages";
import { replaceTerminalInputListener, type DisposableInputListener } from "@/lib/terminal-input-listener";
import {
  toastDurationFor,
  toneAccentClassNames,
  toneIconClassNames,
  toneIcons,
  type NotificationToastTone
} from "@/lib/notification-toast";
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
const TERMINAL_STATUS_LABEL_KEYS: Record<ConnectionStatus, TranslationKey> = {
  connecting: "terminal.status.connecting",
  connected: "terminal.status.connected",
  reconnecting: "terminal.status.reconnecting",
  disconnected: "terminal.status.disconnected",
  failed: "terminal.status.failed",
};
/**
 * xterm latches `isUserScrolling` on any upward scroll and then never follows
 * output again until the user returns to the very bottom. Trackpad momentum
 * can set that latch unnoticed, and a large commit burst (e.g. Codex flushing
 * a finished task into scrollback) then leaves the viewport stranded at the
 * top/middle. New output re-pins the viewport to the bottom unless the user
 * actively scrolled up within this window.
 */
const AUTO_STICK_WINDOW_MS = 10_000;
/** Fonts and dev-mode CSS can settle right after the socket opens; re-fit once
 * shortly after connect so the server-side window converges to the real pane. */
const RESIZE_SETTLE_DELAY_MS = 400;

function getReconnectDelay(attempt: number): number {
  const index = Math.min(attempt, RECONNECT_DELAYS.length - 1);
  return RECONNECT_DELAYS[index] as number;
}

/** In-tab toast state for terminal-native signals (bell, OSC 9/99/777). */
interface TerminalNotificationToast {
  id: number;
  tone: NotificationToastTone;
  title: string;
  message: string;
}

/**
 * Tone for a terminal notification type. `toastToneFor` is shaped around the
 * gateway event union and renders task outcomes as "info", so the in-tab toast
 * keeps its own small mapping.
 */
function toneForNotificationType(notificationType: string): NotificationToastTone {
  if (notificationType === "permission_prompt") return "warning";
  if (notificationType === "task_failed") return "error";
  if (notificationType === "task_completed") return "success";
  return "info";
}

/** Minimal kitty OSC 99 parameter parse (`A=...;T=...`) for the in-tab toast. */
function parseKittyOsc99(data: string): { alert?: string; title?: string } {
  const result: { alert?: string; title?: string } = {};
  for (const part of data.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (!value) continue;
    if (key === "A") result.alert = value;
    else if (key === "T") result.title = value;
  }
  return result;
}

export function TerminalView({
  sessionId,
  authToken,
  attachToken,
  aiTool,
  historyOpen = false,
  onHistoryClose,
  credentialsPending = false,
}: {
  sessionId: string;
  authToken: string;
  attachToken: string;
  aiTool?: string;
  /** Controlled read-only output-history overlay (trigger lives in the tab strip). */
  historyOpen?: boolean;
  onHistoryClose?: () => void;
  /** The session page is still fetching the attach token (connect in flight).
   *  Render the connecting strip instead of the missing-credentials panel so
   *  a tab switch never flashes an error while the token is on its way. */
  credentialsPending?: boolean;
}) {
  const { t } = useLanguage();
  const toolbarCopy = useTerminalToolbarCopy();
  const { resolved: colorModeResolved } = useColorMode();
  const terminalFont = useTerminalFont();
  const writer = useTerminalWriter(sessionId);
  const queryClient = useQueryClient();
  const writerRef = useRef(writer);
  writerRef.current = writer;
  // Mirror of the font settings for the async creation closure, which cannot
  // safely depend on the hook value without re-creating the terminal.
  const terminalFontRef = useRef(terminalFont);
  terminalFontRef.current = terminalFont;
  const aiToolRef = useRef(aiTool);
  aiToolRef.current = aiTool;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const toolbarContainerRef = useRef<HTMLDivElement | null>(null);
  const toolbarDrag = useTerminalToolbarDrag(toolbarContainerRef);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const fitAddonRef = useRef<FitAddonInstance | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptCountRef = useRef(0);
  const inputDisposableRef = useRef<DisposableInputListener | null>(null);
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const promptCaptureRef = useRef(createTerminalPromptCapture());
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  /** Staged scrollback replay: history frames are buffered until the
   *  terminal_history_end marker arrives, then applied with one reset+write
   *  so a tab switch swaps screens in a single frame instead of filling the
   *  old screen chunk by chunk. Live output received while buffering is
   *  queued and written right after the replay. Frames are ACKed at receipt
   *  (the gateway output gate would otherwise stall the replay itself). */
  const replayRef = useRef<{ history: string[]; live: string[] } | null>(null);
  const mountedRef = useRef(true);
  const lastWheelUpAtRef = useRef(0);
  const atBottomRef = useRef(true);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [attemptCount, setAttemptCount] = useState(0);
  const [terminalReady, setTerminalReady] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [hasSelection, setHasSelection] = useState(false);
  const [alternateScreen, setAlternateScreen] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyBusyRef = useRef(false);
  const toolbarMountedRef = useRef(true);
  const [terminalToast, setTerminalToast] = useState<TerminalNotificationToast | null>(null);
  const terminalToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalToastSeqRef = useRef(0);

  const tRef = useRef(t);
  tRef.current = t;

  /** Single in-tab toast: a new signal replaces the current one and restarts
      the auto-dismiss timer (no queue — the latest signal wins). */
  const showTerminalToast = useCallback(
    (notificationType: string, tone: NotificationToastTone, title: string, message?: string) => {
      terminalToastSeqRef.current += 1;
      setTerminalToast({
        id: terminalToastSeqRef.current,
        tone,
        title,
        message: message ?? ""
      });
      if (terminalToastTimerRef.current !== null) {
        clearTimeout(terminalToastTimerRef.current);
      }
      terminalToastTimerRef.current = setTimeout(() => {
        terminalToastTimerRef.current = null;
        setTerminalToast(null);
      }, toastDurationFor(notificationType));
    },
    []
  );
  const showTerminalToastRef = useRef(showTerminalToast);
  showTerminalToastRef.current = showTerminalToast;

  /* Fire-and-forget: the session board prefers the freshest prompt, so report
     terminal input to the Gateway without blocking the input path. */
  const reportSessionPrompt = useCallback(
    (id: string, prompt: string) => {
      void updateSessionLastPrompt(id, prompt)
        .then(() => queryClient.invalidateQueries({ queryKey: ["sessions-board"] }))
        .catch((error) => {
          console.warn("Failed to report session last prompt", error);
        });
    },
    [queryClient]
  );

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const syncAtBottom = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const buffer = terminal.buffer.active;
    setAlternateScreen(buffer.type === "alternate");
    const next = buffer.type !== "normal" || buffer.viewportY >= buffer.baseY;
    if (atBottomRef.current !== next) {
      atBottomRef.current = next;
      setAtBottom(next);
    }
  }, []);

  const stickToBottomUnlessUserScrolled = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const buffer = terminal.buffer.active;
    if (buffer.type !== "normal" || buffer.viewportY >= buffer.baseY) return;
    if (Date.now() - lastWheelUpAtRef.current < AUTO_STICK_WINDOW_MS) return;
    terminal.scrollToBottom();
    syncAtBottom();
  }, [syncAtBottom]);

  const handleScrollToBottom = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.scrollToBottom();
    terminal.focus();
    lastWheelUpAtRef.current = 0;
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  /**
   * Fit xterm to the host and push the size to the gateway when it changed.
   * Fitting still happens with a closed socket so the canvas always matches
   * the pane. The socket-open handler resets `lastSentSizeRef`, so the first
   * fit after a (re)connect always sends a real size; unchanged-size
   * ResizeObserver fires stay no-ops.
   */
  const fitAndSendResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    const buffer = terminal.buffer.active;
    const wasAtBottom = buffer.type === "normal" && buffer.viewportY >= buffer.baseY;
    const previousCols = terminal.cols, previousRows = terminal.rows;
    fitAddon.fit();
    // Small fonts on large displays can exceed the Gateway's grid limits.
    // Keep xterm and the PTY on the same grid instead of dropping that resize.
    if (terminal.cols > MAX_TERMINAL_COLS || terminal.rows > MAX_TERMINAL_ROWS) {
      terminal.resize(Math.min(terminal.cols, MAX_TERMINAL_COLS), Math.min(terminal.rows, MAX_TERMINAL_ROWS));
    }
    if (wasAtBottom && (terminal.cols !== previousCols || terminal.rows !== previousRows)) terminal.scrollToBottom();
    syncAtBottom();
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const last = lastSentSizeRef.current;
    if (last !== null && last.cols === terminal.cols && last.rows === terminal.rows) return;

    const resizeMessage = createTerminalResizeMessage({
      cols: terminal.cols,
      rows: terminal.rows
    });
    if (resizeMessage) {
      socket.send(resizeMessage);
      lastSentSizeRef.current = { cols: terminal.cols, rows: terminal.rows };
    }
  }, [syncAtBottom]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (!terminalReady) return;
    if (!authToken || !attachToken) {
      setStatus(credentialsPending ? "connecting" : "disconnected");
      return;
    }
    // A fresh attach re-sends the whole scrollback; discard any replay that
    // was still buffered from a previous (re)connect of this instance.
    replayRef.current = null;

    const socket = new WebSocket(
      terminalWebSocketUrl(sessionId),
      terminalWebSocketProtocols(authToken, attachToken)
    );
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (!mountedRef.current || socketRef.current !== socket) return;
      attemptCountRef.current = 0;
      setAttemptCount(0);
      setStatus("connected");

      lastSentSizeRef.current = null;
      fitAndSendResize();
      // Layout can settle right after open (fonts, dev-mode CSS); re-fit once
      // and push any correction so the terminal window converges to the real pane.
      window.setTimeout(() => {
        if (mountedRef.current) fitAndSendResize();
      }, RESIZE_SETTLE_DELAY_MS);
    });

    socket.addEventListener("message", (event) => {
      const terminal = terminalRef.current;
      if (!terminal || !mountedRef.current || socketRef.current !== socket) return;

      const message = parseTerminalWebSocketMessage(String(event.data));
      if (!message) return;

      const ackSequence = (sequence?: number) => {
        if (sequence === undefined) return;
        if (!mountedRef.current || socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "terminal_ack", payload: { sequence } }));
      };

      if (message.type === "terminal_history") {
        // Staged scrollback replay: buffer until the terminal_history_end
        // marker, then apply with one reset+write so the old screen is never
        // repainted chunk by chunk. On a reconnect the same xterm instance is
        // reused; the reset leaves a clean normal buffer for the history (a
        // full-screen TUI may have switched xterm to the alternate buffer).
        // ACK at receipt, not at flush: the gateway output gate stops at
        // 256KB/128 unacked frames, so deferring ACKs would hold back the
        // terminal_history_end marker itself and deadlock the replay.
        const replay = replayRef.current ?? (replayRef.current = { history: [], live: [] });
        replay.history.push(message.payload.data);
        ackSequence(message.payload.sequence);
        return;
      }

      if (message.type === "terminal_history_end") {
        ackSequence(message.payload.sequence);
        const replay = replayRef.current;
        replayRef.current = null;
        if (replay) {
          terminal.reset();
          stickToBottomUnlessUserScrolled();
          const historyData = replay.history.join("");
          if (historyData) {
            terminal.write(historyData, () => syncAtBottom());
          } else {
            syncAtBottom();
          }
          for (const data of replay.live) {
            stickToBottomUnlessUserScrolled();
            terminal.write(data, () => syncAtBottom());
          }
        }
        return;
      }

      if (message.type === "terminal_output") {
        // While the replay is staged, queue live frames — this also catches
        // history continuation chunks, which the gateway retags as
        // terminal_output — so nothing writes before the marker's reset.
        // ACKed at receipt for the same gate reason as terminal_history.
        if (replayRef.current !== null) {
          replayRef.current.live.push(message.payload.data);
          ackSequence(message.payload.sequence);
          return;
        }
        stickToBottomUnlessUserScrolled();
        terminal.write(message.payload.data, () => {
          syncAtBottom();
          ackSequence(message.payload.sequence);
        });
      }

      if (message.type === "terminal_exit") {
        replayRef.current = null;
        clearReconnectTimer();
        replaceTerminalInputListener(inputDisposableRef, null);
        socketRef.current = null;
        socket.close(1000);
        setStatus("disconnected");
        writerRef.current.refresh();
      }

      if (message.type === "terminal_error") {
        writerRef.current.refresh();
        terminal.writeln(`\r\n[forgebadger] ${message.payload.message}`);
      }
    });

    socket.addEventListener("close", (event) => {
      if (!mountedRef.current || socketRef.current !== socket) return;
      socketRef.current = null;

      if ([1000, 4000, 4403, 4404].includes(event.code) || (event.wasClean && ![1011, 4001].includes(event.code))) {
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
        if (writerRef.current.readOnly) {
          // The copilot owns the keyboard, but a wheel spin is not a
          // keystroke: pass pure SGR wheel reports through so a fullscreen
          // TUI's viewport can still be scrolled while watching.
          if (isTerminalWheelInput(data) && socket.readyState === WebSocket.OPEN) {
            socket.send(createTerminalInputMessage(data));
          }
          return;
        }
        const prompt = promptCaptureRef.current.push(data);
        if (prompt) {
          setSessionTabPrompt(sessionId, prompt);
          notifySessionTabsChanged();
          reportSessionPrompt(sessionId, prompt);
        }
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(createTerminalInputMessage(data));
        }
      });
      replaceTerminalInputListener(inputDisposableRef, disposable);
    }
  }, [sessionId, authToken, attachToken, credentialsPending, terminalReady, fitAndSendResize, clearReconnectTimer, stickToBottomUnlessUserScrolled, syncAtBottom, reportSessionPrompt]);

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

  // Font size rides the existing terminal-font preference store: setTerminalFont
  // persists to the same localStorage key the font settings UI uses, and the
  // font-follow effect below re-applies it to the live xterm instance.
  const adjustFontSize = useCallback((delta: number) => {
    setTerminalFont({
      fontFamily: terminalFontRef.current.fontFamily,
      fontSize: terminalFontRef.current.fontSize + delta,
    });
  }, []);

  const clearTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    // Full-screen TUIs track their own cursor and diff-rendered screen. A local
    // clear would desynchronize that state without asking the CLI to redraw.
    if (!terminal || terminal.buffer.active.type !== "normal") return;
    terminal.clearSelection();
    terminal.clear();
    syncAtBottom();
  }, [syncAtBottom]);

  // Toolbar work can finish while the connection effect is awaiting a token.
  // Its lifetime follows the component, rather than the current WebSocket.
  useEffect(() => {
    toolbarMountedRef.current = true;
    return () => { toolbarMountedRef.current = false; };
  }, []);

  const copyText = useCallback(async (text: string) => {
    if (copyBusyRef.current) return;
    if (!text) { toast.info(toolbarCopy.copyEmpty); return; }
    copyBusyRef.current = true;
    setCopying(true);
    try {
      const copied = await copyTerminalText(text);
      if (!toolbarMountedRef.current) return;
      if (copied) toast.success(toolbarCopy.copied);
      else toast.error(toolbarCopy.copyFailed);
    } finally {
      copyBusyRef.current = false;
      if (toolbarMountedRef.current) setCopying(false);
    }
  }, [toolbarCopy]);

  const copySelection = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    void copyText(terminal.getSelection());
  }, [copyText]);
  const copySelectionRef = useRef(copySelection);
  copySelectionRef.current = copySelection;

  const copyEntireBuffer = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    void copyText(getTerminalBufferText(terminal));
  }, [copyText]);

  // Initialize terminal instance once
  useEffect(() => {
    let cancelled = false;
    let disposeSafariInputFix: (() => void) | undefined;
    let scrollDisposable: { dispose(): void } | null = null;
    let bellDisposable: { dispose(): void } | null = null;
    let osc9Disposable: { dispose(): void } | null = null;
    let osc99Disposable: { dispose(): void } | null = null;
    let osc777Disposable: { dispose(): void } | null = null;
    const codexWheel = new CodexWheelInput();
    let piWheel: PiWheelInput | null = null;
    let selectionDisposable: { dispose(): void } | null = null;
    let bufferDisposable: { dispose(): void } | null = null;
    let viewportScrollFrame: number | null = null;
    // xterm suppresses onScroll for native viewport scrolling. Read the
    // buffer on the next frame, after its DOM scroll handler updates it.
    const onViewportScroll = () => {
      if (viewportScrollFrame !== null) return;
      viewportScrollFrame = window.requestAnimationFrame(() => {
        viewportScrollFrame = null;
        syncAtBottom();
      });
    };
    const onWheelCapture = (event: WheelEvent) => {
      if (event.deltaY < 0) lastWheelUpAtRef.current = Date.now();
    };
    const timer = window.setTimeout(() => {
      void Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        ensureTerminalFontLoaded(terminalFontRef.current.fontFamily)
      ]).then(
        ([xterm, fit]) => {
          const host = hostRef.current;
          if (cancelled || !host) return;

          const terminal = new xterm.Terminal({
            cursorBlink: true,
            fontFamily: terminalFontRef.current.fontFamily,
            fontSize: terminalFontRef.current.fontSize,
            // Palette chosen from the DOM class: the beforeInteractive script
            // has already stamped the correct `dark` class before paint, so
            // this is always in sync with the stored preference on first open.
            theme: getTerminalPalette(
              document.documentElement.classList.contains("dark") ? "dark" : "light"
            )
          });
          terminal.attachCustomKeyEventHandler((event) => {
            if (event.type !== "keydown") return true;
            const altArrowInput = terminalAltArrowInput(event, navigator.platform);
            if (altArrowInput !== null) {
              event.preventDefault();
              terminal.input(altArrowInput, true);
              return false;
            }
            if (!shouldCopyTerminalSelection(event, terminal.hasSelection())) return true;

            event.preventDefault();
            copySelectionRef.current();
            return false;
          });
          const pi = new PiWheelInput((data) => terminalRef.current?.input(data, false));
          piWheel = pi;
          // Full-screen TUIs (Claude Code / Kimi Code) run on the alternate
          // screen with mouse reporting disabled, so xterm's alternateScroll
          // converts the wheel into ↑/↓ key sequences that pollute the input
          // history. Suppress only in that state; OpenCode (mouse on) keeps its
          // SGR wheel events and the normal buffer keeps its scrollback scroll.
          terminal.attachCustomWheelEventHandler((event) => {
            if (aiToolRef.current === "pi") {
              // PI's fullscreen TUI consumes SGR wheel reports. The attach
              // replay restores the rendered screen but not the terminal's
              // mouse state, so the browser terminal may have mouse reporting
              // off even though the app is waiting for SGR wheel reports.
              // Emit OS-coalesced reports (one per accumulated notch, plus a
              // tail flush) regardless of the browser's local state; PI
              // accelerates the gesture itself.
              const screen = terminal.element?.querySelector(".xterm-screen");
              const rect = screen?.getBoundingClientRect();
              const data = rect
                ? pi.encode(event, {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    cols: terminal.cols,
                    rows: terminal.rows
                  })
                : null;
              if (data !== null) {
                event.preventDefault();
                if (data) terminal.input(data, false);
                return false;
              }
            }
            if (
              aiToolRef.current === "codex" &&
              terminal.buffer.active.type === "alternate" &&
              terminal.modes.mouseTrackingMode !== "none"
            ) {
              const screen = terminal.element?.querySelector(".xterm-screen");
              const rect = screen?.getBoundingClientRect();
              const data = rect
                ? codexWheel.encode(event, {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    cols: terminal.cols,
                    rows: terminal.rows
                  })
                : null;
              if (data !== null) {
                event.preventDefault();
                if (data) terminal.input(data, false);
                return false;
              }
            }
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
          disposeSafariInputFix = installSafariTerminalInputFix(terminal);
          terminalRef.current = terminal;
          fitAddonRef.current = fitAddon;
          scrollDisposable = terminal.onScroll(syncAtBottom);
          bufferDisposable = terminal.buffer.onBufferChange(syncAtBottom);
          host.addEventListener("scroll", onViewportScroll, { capture: true });
          selectionDisposable = terminal.onSelectionChange(() => {
            setHasSelection(terminal.hasSelection());
          });
          // Terminal-native signals (bell / OSC 9/99/777) become an in-tab
          // toast only — the main channel is the daemon-side PTY scanner that
          // relays the same signals to the Gateway. Nice-to-have layer: it
          // gives the focused tab an immediate cue even if the global
          // notification channel is lagging. All handlers return true, so the
          // sequences are consumed and never painted into the buffer.
          bellDisposable = terminal.onBell(() => {
            showTerminalToastRef.current(
              "attention",
              "warning",
              tRef.current("terminal.notif.terminalBell")
            );
          });
          osc9Disposable = terminal.parser.registerOscHandler(9, (data) => {
            const text = data.trim();
            // A bare-integer first segment is an auxiliary OSC 9 sub-command
            // (kitty-style `9;4` progress bars — Kimi Code emits these
            // continuously on WezTerm), not a notification message. Kept in
            // lockstep with the gateway's isOsc9AuxiliaryPayload
            // (packages/gateway/src/services/session-server/terminal-notification-scanner.ts);
            // the web and gateway packages cannot share code, so both copies
            // must change together.
            if (text && !/^\d+$/.test(text.split(";", 1)[0] ?? "")) {
              showTerminalToastRef.current(
                "permission_prompt",
                "warning",
                tRef.current("terminal.notif.needsAttention"),
                text
              );
            }
            return true;
          });
          osc99Disposable = terminal.parser.registerOscHandler(99, (data) => {
            // Kitty feature probe (p=?): consume silently, no toast.
            if (data.includes("p=?")) return true;
            const { alert, title } = parseKittyOsc99(data);
            const haystack = `${title ?? ""} ${alert ?? ""}`.toLowerCase();
            const notificationType = /(error|fail)/.test(haystack)
              ? "task_failed"
              : /(complete|idle|done)/.test(haystack)
                ? "task_completed"
                : "permission_prompt";
            showTerminalToastRef.current(
              notificationType,
              toneForNotificationType(notificationType),
              title ?? tRef.current("terminal.notif.needsAttention"),
              alert ?? title ?? data
            );
            return true;
          });
          osc777Disposable = terminal.parser.registerOscHandler(777, (data) => {
            const parts = data.split(";");
            if ((parts[0] ?? "") !== "notify") return true;
            const title = (parts[1] ?? "").trim();
            const body = parts.slice(2).join(";").trim();
            if (title || body) {
              showTerminalToastRef.current(
                "permission_prompt",
                "warning",
                title || tRef.current("terminal.notif.needsAttention"),
                body || undefined
              );
            }
            return true;
          });
          // Track upward wheel intent (incl. trackpad momentum) so output can
          // re-pin the viewport once the user has not scrolled for a while.
          host.addEventListener("wheel", onWheelCapture, { capture: true, passive: true });

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
      disposeSafariInputFix?.();
      window.clearTimeout(timer);
      setTerminalReady(false);
      scrollDisposable?.dispose();
      bellDisposable?.dispose();
      osc9Disposable?.dispose();
      osc99Disposable?.dispose();
      osc777Disposable?.dispose();
      if (terminalToastTimerRef.current !== null) {
        clearTimeout(terminalToastTimerRef.current);
        terminalToastTimerRef.current = null;
      }
      setTerminalToast(null);
      hostRef.current?.removeEventListener("wheel", onWheelCapture, { capture: true });
      hostRef.current?.removeEventListener("scroll", onViewportScroll, { capture: true });
      if (viewportScrollFrame !== null) window.cancelAnimationFrame(viewportScrollFrame);
      selectionDisposable?.dispose();
      bufferDisposable?.dispose();
      piWheel?.dispose();
      piWheel = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [syncAtBottom]);

  // Follow the app color mode at runtime: xterm.js re-renders the viewport
  // (including scrollback) when the theme option changes, so a light/dark
  // switch never re-opens the terminal. No-op while the instance is still
  // initializing; creation already picked the palette from the DOM class.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = getTerminalPalette(colorModeResolved);
  }, [colorModeResolved]);

  // Font metrics change the cell grid even when the container keeps its size.
  // Re-fit after rendering and report the new rows/columns to the live PTY.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontFamily = terminalFont.fontFamily;
    terminal.options.fontSize = terminalFont.fontSize;
    const frame = window.requestAnimationFrame(fitAndSendResize);
    return () => window.cancelAnimationFrame(frame);
  }, [terminalFont.fontFamily, terminalFont.fontSize, terminalReady, fitAndSendResize]);

  // Manage connection lifecycle
  useEffect(() => {
    if (!terminalReady) {
      return;
    }
    if (!authToken || !attachToken) {
      setStatus(credentialsPending ? "connecting" : "disconnected");
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
  }, [authToken, attachToken, credentialsPending, connect, clearReconnectTimer, terminalReady]);

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
  // The status strip floats over the terminal instead of taking flow space,
  // so a connecting → connected flip never re-layouts the pane.
  const showStatusBar = status !== "connected";
  const statusLabel = t(TERMINAL_STATUS_LABEL_KEYS[status]);
  // Genuine missing credentials (not a token still in flight from the page's
  // connect round-trip) replace the terminal with an explanatory panel.
  const missingCredentials = (!authToken || !attachToken) && !credentialsPending;
  const statusTone =
    status === "connected"
      ? "bg-emerald-500"
      : status === "reconnecting"
        ? "bg-amber-400"
        : status === "failed"
          ? "bg-red-500"
          : "bg-muted-foreground";
  const ToastIcon = terminalToast ? toneIcons[terminalToast.tone] : null;

  return (
    <div
      data-testid="terminal-frame"
      className={cn(
        "grid h-full min-h-0 overflow-hidden bg-terminal",
        missingCredentials ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]"
      )}
    >
      {missingCredentials && (
        <div className="p-4 text-sm text-destructive">
          {t("terminal.missingCredentials")}
        </div>
      )}
      {/* Padding lives on the wrapper, NOT on the xterm host: FitAddon reads
          the host's computed width/height (border-box under Tailwind preflight)
          without subtracting host padding, so padding here would overshoot
          cols/rows and clip the rightmost character column. */}
      <div ref={toolbarContainerRef} className="relative flex h-full min-h-0 flex-col overflow-hidden p-2 pb-12">
        {/* Screen readers still get the connecting → connected transition even
            though the healthy state has no visible strip. */}
        {!showStatusBar && (
          <span aria-live="polite" className="sr-only">
            {statusLabel}
          </span>
        )}
        {/* Status strip and read-only banner float as a semi-transparent
            overlay instead of in-flow rows: a status flip must not re-layout
            the terminal. pointer-events-none keeps the terminal interactive
            through the gaps; the panels themselves stay clickable. */}
        {(showStatusBar || writer.readOnly) && (
          <div className="pointer-events-none absolute inset-x-0 top-12 z-20 flex flex-col items-stretch gap-2 p-2">
            {showStatusBar && (
              <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-terminal/85 px-3 py-2 text-xs text-muted-foreground">
                <span className={cn("size-2 rounded-full", statusTone)} aria-hidden="true" />
                <span aria-live="polite">{statusLabel}</span>
                {attemptCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-300">
                    {attemptCount}/{MAX_RECONNECT_ATTEMPTS}
                  </span>
                )}
                <span className="min-w-0 truncate font-mono">session {sessionId}</span>
              </div>
            )}
            {writer.readOnly && (
              <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-terminal/85 p-2 text-xs text-amber-600 dark:text-amber-300" role="status">
                <span>
                  {writer.loading
                    ? t("terminal.writer.checking")
                    : writer.error
                      ? t("terminal.writer.syncFailed")
                      : t("terminal.writer.copilotReadOnly")}
                </span>
                <Button size="sm" variant="outline" disabled={writer.loading || writer.takingOver} onClick={writer.takeover}>
                  {t("terminal.writer.takeover")}
                </Button>
                <Button size="sm" variant="ghost" onClick={writer.refresh}>{t("terminal.writer.refresh")}</Button>
                {writer.error && <span role="alert">{writer.error.message}</span>}
              </div>
            )}
          </div>
        )}
        <div
          ref={hostRef}
          data-testid="terminal-host"
          title={t("terminal.selectionHint")}
          className="min-h-0 flex-1 [&_.xterm-screen]:!h-full [&_.xterm-viewport]:!h-full [&_.xterm]:h-full"
        />
        {/* Default and reset position: top-right. Status overlays sit below
            this corner, keeping the controls accessible during reconnects.
            The bottom band still protects input when the toolbar is moved. */}
        <div
          ref={toolbarDrag.toolbarRef}
          style={toolbarDrag.style}
          data-testid="terminal-toolbar"
          aria-busy={copying}
          onMouseDown={(event) => {
            // Mouse controls preserve terminal typing focus; keyboard users
            // can still tab to and activate the buttons normally.
            if (event.button === 0 && event.target instanceof Element && event.target.closest("button")) event.preventDefault();
          }}
          className="absolute right-2 top-2 z-10 flex w-max max-w-[calc(100%-1rem)] flex-wrap items-center gap-0.5 rounded-md border border-border bg-terminal/85 px-1 py-0.5 shadow-sm backdrop-blur-sm"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 touch-none cursor-grab select-none active:cursor-grabbing"
            aria-label={toolbarCopy.moveToolbar}
            title={toolbarCopy.moveToolbar}
            data-testid="terminal-toolbar-drag-handle"
            {...toolbarDrag.handleProps}
          >
            <GripVertical className="size-3.5" />
          </Button>
          <span
            role="status"
            aria-label={statusLabel}
            title={statusLabel}
            className={cn("mx-0.5 size-2 shrink-0 rounded-full", statusTone)}
          />
          {aiTool ? (
            <span className="hidden px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
              {aiTool}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={toolbarCopy.fontSmaller}
            title={toolbarCopy.fontSmaller}
            disabled={terminalFont.fontSize <= MIN_TERMINAL_FONT_SIZE}
            onClick={() => adjustFontSize(-1)}
          >
            <span className="flex items-center gap-px">
              <span className="text-[10px] font-semibold leading-none">A</span>
              <Minus className="size-2.5" />
            </span>
          </Button>
          <span className="hidden w-6 text-center text-[10px] tabular-nums text-muted-foreground sm:inline">
            {terminalFont.fontSize}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={toolbarCopy.fontLarger}
            title={toolbarCopy.fontLarger}
            disabled={terminalFont.fontSize >= MAX_TERMINAL_FONT_SIZE}
            onClick={() => adjustFontSize(1)}
          >
            <span className="flex items-center gap-px">
              <span className="text-[10px] font-semibold leading-none">A</span>
              <Plus className="size-2.5" />
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={toolbarCopy.clear}
            title={alternateScreen ? toolbarCopy.clearAlternate : toolbarCopy.clear}
            disabled={!terminalReady || alternateScreen}
            onClick={clearTerminal}
          >
            <Eraser className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={toolbarCopy.copySelection}
            title={toolbarCopy.copySelection}
            disabled={!terminalReady || !hasSelection || copying}
            onClick={copySelection}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={toolbarCopy.copyAll}
            title={toolbarCopy.copyAll}
            disabled={!terminalReady || copying}
            onClick={copyEntireBuffer}
          >
            <ClipboardCopy className="size-3.5" />
          </Button>
        </div>
        {terminalToast && ToastIcon && (
          <div
            key={terminalToast.id}
            role="status"
            aria-live="polite"
            className={cn(
              "absolute left-1/2 top-12 z-20 flex max-w-[80%] -translate-x-1/2 items-start gap-2 rounded-md border bg-popover px-3 py-2 text-xs shadow-lg",
              toneAccentClassNames[terminalToast.tone]
            )}
          >
            <ToastIcon aria-hidden="true" className={cn("mt-0.5 shrink-0", toneIconClassNames[terminalToast.tone])} />
            <div className="min-w-0">
              <p className="font-medium">{terminalToast.title}</p>
              {terminalToast.message && (
                <p className="mt-0.5 break-words text-muted-foreground">{terminalToast.message}</p>
              )}
            </div>
          </div>
        )}
        {!atBottom && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleScrollToBottom}
            className="absolute bottom-12 right-4 z-10 gap-1 shadow md:bottom-4"
            aria-label={t("terminal.backToBottom")}
          >
            <ArrowDown className="size-3.5" />
            {t("terminal.backToBottom")}
          </Button>
        )}
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
