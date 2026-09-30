"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon as FitAddonInstance } from "@xterm/addon-fit";
import type { Terminal as TerminalInstance } from "@xterm/xterm";
import { RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useColorMode } from "@/hooks/use-color-mode";
import { useTerminalFont } from "@/hooks/use-terminal-font";
import { useLanguage } from "@/hooks/use-language";
import { fetchJson } from "@/lib/api";
import { ensureTerminalFontLoaded } from "@/lib/terminal-font";
import { getTerminalPalette } from "@/lib/terminal-theme";
import { cn } from "@/lib/utils";

/** Shape of `GET /api/v1/sessions/:id/output`. */
export interface SessionOutputResponse {
  output: string;
  truncated: boolean;
  lineCount: number;
}

/**
 * Read-only overlay that replays the buffered terminal output for a session.
 *
 * It mounts its own xterm instance with an explicit large `scrollback` (the
 * default 1000 is far below the gateway's 2000-line tail and would silently
 * drop the earliest lines), disables the cursor, and blocks all key input so
 * it can never mutate the underlying pty. The live terminal's WebSocket below
 * stays untouched while this overlay is open.
 */
export function SessionOutputHistory({
  sessionId,
  authToken,
  open,
  onClose,
}: {
  sessionId: string;
  authToken: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { resolved: colorModeResolved } = useColorMode();
  const terminalFont = useTerminalFont();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const fitAddonRef = useRef<FitAddonInstance | null>(null);
  // Mirror of the font settings for the async creation closure.
  const terminalFontRef = useRef(terminalFont);
  terminalFontRef.current = terminalFont;
  const outputRef = useRef<SessionOutputResponse | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const fetchOutput = useCallback(async (): Promise<SessionOutputResponse> => {
    return fetchJson<SessionOutputResponse>(`/api/v1/sessions/${sessionId}/output`);
  }, [sessionId]);

  const renderOutput = useCallback((data: SessionOutputResponse) => {
    outputRef.current = data;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    if (data.output) {
      terminal.write(data.output);
    }
  }, []);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage("");
    try {
      const data = await fetchOutput();
      renderOutput(data);
      setLoadState("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setLoadState("error");
    }
  }, [fetchOutput, renderOutput]);

  // Mount a disposable read-only xterm once the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      ensureTerminalFontLoaded(terminalFontRef.current.fontFamily)
    ]).then(
      ([xterm, fit]) => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;

        const terminal = new xterm.Terminal({
          scrollback: 100000,
          cursorBlink: false,
          fontFamily: terminalFontRef.current.fontFamily,
          fontSize: terminalFontRef.current.fontSize,
          // Palette from the DOM class: the beforeInteractive script keeps
          // <html> in sync with the stored preference before first paint.
          theme: getTerminalPalette(
            document.documentElement.classList.contains("dark") ? "dark" : "light"
          )
        });
        // Read-only: never forward any key to the terminal.
        terminal.attachCustomKeyEventHandler(() => false);
        const fitAddon = new fit.FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(host);
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        fitAddon.fit();

        const pending = outputRef.current;
        if (pending) {
          terminal.reset();
          if (pending.output) {
            terminal.write(pending.output);
          }
        }
      }
    );
    return () => {
      cancelled = true;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [open]);

  // Follow the app color mode while the panel is open (xterm re-renders the
  // viewport on a theme change; no re-open needed).
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = getTerminalPalette(colorModeResolved);
  }, [colorModeResolved]);

  // Follow the terminal font preference while the panel is open.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontFamily = terminalFont.fontFamily;
    terminal.options.fontSize = terminalFont.fontSize;
  }, [terminalFont.fontFamily, terminalFont.fontSize]);

  // Fetch the buffered output whenever the panel opens or is refreshed.
  useEffect(() => {
    if (!open) return;
    if (!authToken) {
      setLoadState("error");
      setErrorMessage(t("terminal.historyLoadFailed"));
      return;
    }
    void load();
  }, [open, authToken, load, t]);

  // Keep the read-only terminal fitted to its container while open.
  useEffect(() => {
    if (!open) return;
    const fit = () => fitAddonRef.current?.fit();
    fit();
    window.addEventListener("resize", fit);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    const host = hostRef.current;
    if (observer && host) {
      observer.observe(host);
    }
    return () => {
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, [open]);

  if (!open) return null;

  const isEmpty = loadState === "ready" && (!outputRef.current || outputRef.current.lineCount === 0);

  return (
    <div
      data-testid="session-output-history"
      className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-terminal"
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate font-medium">{t("terminal.historyOutput")}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => void load()}
            disabled={loadState === "loading"}
            title={t("terminal.historyRefresh")}
            aria-label={t("terminal.historyRefresh")}
          >
            <RefreshCw className={cn("size-3.5", loadState === "loading" && "animate-spin")} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden p-2">
        <div
          ref={hostRef}
          data-testid="session-output-history-host"
          className="h-full min-h-0 [&_.xterm-cursor]:!opacity-0 [&_.xterm-screen]:!h-full [&_.xterm-viewport]:!h-full [&_.xterm]:h-full"
        />
        {loadState === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        )}
        {loadState === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="max-w-sm rounded-md border border-destructive/50 bg-destructive/10 p-4 text-center">
              <p className="text-sm font-medium text-destructive">
                {t("terminal.historyLoadFailed")}
              </p>
              <p className="mt-1 break-words text-xs text-destructive/80">{errorMessage}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void load()}
              >
                {t("terminal.historyRefresh")}
              </Button>
            </div>
          </div>
        )}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {t("terminal.historyEmpty")}
          </div>
        )}
      </div>
    </div>
  );
}
