import type { ResolvedColorMode } from "./color-mode";

/**
 * xterm.js terminal palettes, one per resolved color mode. Mirrors how VS
 * Code themes own their terminal colors: the palette carries the surface
 * (background/foreground/cursor/selection) plus the full ANSI 16-color
 * ladder, with the light palette's ANSI colors tuned dark-on-light for
 * contrast (e.g. red is #cf222e, not the bright terminal red).
 *
 * Applied live via `terminal.options.theme = ...` — xterm.js re-renders the
 * whole viewport including scrollback, so no terminal re-open is needed on
 * a light/dark switch.
 */
export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_PALETTES: Record<ResolvedColorMode, TerminalPalette> = {
  dark: {
    background: "#05070a",
    foreground: "#e5edf7",
    cursor: "#5cc8ff",
    cursorAccent: "#05070a",
    selectionBackground: "rgba(92, 200, 255, 0.3)",
    // xterm.js default ANSI ladder (dark-oriented).
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#f6f8fa",
    foreground: "#24292f",
    cursor: "#0e7490",
    cursorAccent: "#f6f8fa",
    selectionBackground: "rgba(8, 110, 168, 0.25)",
    // Light-background ANSI ladder (GitHub Light-inspired, tuned for
    // contrast on #f6f8fa).
    black: "#24292f",
    red: "#cf222e",
    green: "#1a7f37",
    yellow: "#9a6700",
    blue: "#0550ae",
    magenta: "#8250df",
    cyan: "#0969da",
    white: "#57606a",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#2da44e",
    brightYellow: "#bb8009",
    brightBlue: "#388bfd",
    brightMagenta: "#8250df",
    brightCyan: "#1b7c83",
    brightWhite: "#24292f",
  },
};

export function getTerminalPalette(mode: ResolvedColorMode): TerminalPalette {
  return TERMINAL_PALETTES[mode];
}
