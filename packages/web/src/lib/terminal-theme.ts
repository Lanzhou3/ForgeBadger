import { COLOR_THEMES, DEFAULT_COLOR_THEMES, type ColorThemeId } from "./color-theme";
import type { ResolvedColorMode } from "./color-mode";

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

export const TERMINAL_PALETTES: Record<ColorThemeId, TerminalPalette> = {
  "forgebadger-dark": {
    background: "#161617",
    foreground: "#e6e6e8",
    cursor: "#2b95ff",
    cursorAccent: "#161617",
    selectionBackground: "rgba(1, 133, 255, 0.28)",
    black: "#28282b",
    red: "#f47a86",
    green: "#7ad48e",
    yellow: "#f0c96a",
    blue: "#4aa3ff",
    magenta: "#c9a2f0",
    cyan: "#5fd0c4",
    white: "#c8c8cc",
    brightBlack: "#85858c",
    brightRed: "#f899a2",
    brightGreen: "#9ee2ae",
    brightYellow: "#f6da98",
    brightBlue: "#86c0ff",
    brightMagenta: "#dcc2f6",
    brightCyan: "#8ddfd6",
    brightWhite: "#f4f4f5",
  },
  "forgebadger-light": {
    background: "#fafafa",
    foreground: "#18181b",
    cursor: "#0185FF",
    cursorAccent: "#fafafa",
    selectionBackground: "rgba(1, 133, 255, 0.18)",
    black: "#18181b",
    red: "#c22a44",
    green: "#1b7638",
    yellow: "#8a6400",
    blue: "#0168d6",
    magenta: "#8e3cb8",
    cyan: "#0b766c",
    white: "#5f5f66",
    brightBlack: "#6b6b72",
    brightRed: "#a8203a",
    brightGreen: "#13652d",
    brightYellow: "#775600",
    brightBlue: "#1555b0",
    brightMagenta: "#7a2fa0",
    brightCyan: "#07655c",
    brightWhite: "#3f3f46",
  },
  "one-dark": {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#61afef",
    cursorAccent: "#282c34",
    selectionBackground: "rgba(97, 175, 239, 0.32)",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#ef7983",
    brightGreen: "#a6d189",
    brightYellow: "#eacb8f",
    brightBlue: "#74b9f1",
    brightMagenta: "#d08ce4",
    brightCyan: "#69c5cf",
    brightWhite: "#c8ccd4",
  },
  "tokyo-night": {
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#7aa2f7",
    cursorAccent: "#1a1b26",
    selectionBackground: "rgba(122, 162, 247, 0.32)",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#ff899d",
    brightGreen: "#9fe044",
    brightYellow: "#faba4a",
    brightBlue: "#8db0ff",
    brightMagenta: "#c7a9ff",
    brightCyan: "#a4daff",
    brightWhite: "#c0caf5",
  },
  "github-light": {
    background: "#f6f8fa",
    foreground: "#1f2328",
    cursor: "#0969da",
    cursorAccent: "#f6f8fa",
    selectionBackground: "rgba(9, 105, 218, 0.22)",
    black: "#24292f",
    red: "#cf222e",
    green: "#1a7f37",
    yellow: "#9a6700",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#2da44e",
    brightYellow: "#bb8009",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#8c959f",
  },
  "solarized-light": {
    background: "#fdf6e3",
    foreground: "#586e75",
    cursor: "#268bd2",
    cursorAccent: "#fdf6e3",
    selectionBackground: "rgba(38, 139, 210, 0.24)",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#657b83",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
};

export function getTerminalPalette(
  mode: ResolvedColorMode,
  themeId: ColorThemeId = DEFAULT_COLOR_THEMES[mode]
): TerminalPalette {
  const matchesMode = COLOR_THEMES.some((theme) => theme.id === themeId && theme.mode === mode);
  return TERMINAL_PALETTES[matchesMode ? themeId : DEFAULT_COLOR_THEMES[mode]];
}
