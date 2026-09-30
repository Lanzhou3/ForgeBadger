import { useSyncExternalStore } from "react";

import {
  DEFAULT_TERMINAL_FONT,
  getTerminalFontState,
  subscribeToTerminalFont,
  type TerminalFontSettings,
} from "@/lib/terminal-font";

/**
 * Observe the terminal font preference. Backed by the module-level store in
 * `terminal-font.ts` (see color-mode for the pattern) — no provider wrapper
 * required; live xterm instances re-apply the values via a React effect.
 */
export function useTerminalFont(): TerminalFontSettings {
  return useSyncExternalStore(
    subscribeToTerminalFont,
    getTerminalFontState,
    () => DEFAULT_TERMINAL_FONT
  );
}
