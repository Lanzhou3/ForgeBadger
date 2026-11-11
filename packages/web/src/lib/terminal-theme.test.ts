import { describe, expect, it } from "vitest";

import { COLOR_THEMES } from "./color-theme";
import { TERMINAL_PALETTES, getTerminalPalette } from "./terminal-theme";

const REQUIRED_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function contrastRatio(first: string, second: string): number {
  function relativeLuminance(hex: string): number {
    const channels = hexToRgb(hex).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const [red = 0, green = 0, blue = 0] = channels;
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe("terminal palettes", () => {
  it("covers every xterm surface + ANSI 16 slot for all four themes", () => {
    for (const theme of COLOR_THEMES) {
      const palette = TERMINAL_PALETTES[theme.id];
      for (const key of REQUIRED_KEYS) {
        expect(palette[key], `${theme.id}.${key}`).toMatch(/^#|rgba?\(/);
      }
      expect(palette.foreground).toBe(theme.preview.foreground);
      expect(palette.cursor).toBe(theme.preview.accent);
    }
  });

  it("uses the One Dark palette for dark mode by default", () => {
    expect(getTerminalPalette("dark").background).toBe("#282c34");
    expect(getTerminalPalette("dark").foreground).toBe("#abb2bf");
    expect(getTerminalPalette("dark").cursor).toBe("#61afef");
  });

  it("selects the requested named palette independently in each mode", () => {
    expect(getTerminalPalette("dark", "tokyo-night").background).toBe("#1a1b26");
    expect(getTerminalPalette("dark", "tokyo-night").magenta).toBe("#bb9af7");
    expect(getTerminalPalette("light", "solarized-light").background).toBe("#fdf6e3");
    expect(getTerminalPalette("light", "solarized-light").blue).toBe("#268bd2");
  });

  it("does not apply a light palette to a dark terminal or vice versa", () => {
    expect(getTerminalPalette("dark", "github-light").background).toBe("#282c34");
    expect(getTerminalPalette("light", "tokyo-night").background).toBe("#f6f8fa");
  });

  it("keeps readable foreground contrast across light and dark themes", () => {
    for (const theme of COLOR_THEMES) {
      const palette = getTerminalPalette(theme.mode, theme.id);
      expect(contrastRatio(palette.background, palette.foreground), theme.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps each cursor readable on its own background", () => {
    for (const theme of COLOR_THEMES) {
      const palette = TERMINAL_PALETTES[theme.id];
      expect(Math.abs(luminance(palette.cursor) - luminance(palette.background)), theme.id).toBeGreaterThan(0.25);
    }
  });
});
