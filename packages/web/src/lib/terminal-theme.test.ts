import { describe, expect, it } from "vitest";

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

/** Perceived brightness 0..1 (ITU-R BT.601). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

describe("terminal palettes", () => {
  it("covers every xtheme surface + ANSI 16 slot for both modes", () => {
    for (const mode of ["light", "dark"] as const) {
      const palette = TERMINAL_PALETTES[mode];
      for (const key of REQUIRED_KEYS) {
        expect(palette[key], `${mode}.${key}`).toMatch(/^#|rgba?\(/);
      }
    }
  });

  it("keeps the dark palette on its historical surface", () => {
    expect(getTerminalPalette("dark").background).toBe("#05070a");
    expect(getTerminalPalette("dark").foreground).toBe("#e5edf7");
    expect(getTerminalPalette("dark").cursor).toBe("#5cc8ff");
  });

  it("uses a light surface with dark text for the light palette", () => {
    const palette = getTerminalPalette("light");
    expect(luminance(palette.background)).toBeGreaterThan(0.85);
    expect(luminance(palette.foreground)).toBeLessThan(0.35);
  });

  it("keeps the dark surface and light text for the dark palette", () => {
    const palette = getTerminalPalette("dark");
    expect(luminance(palette.background)).toBeLessThan(0.15);
    expect(luminance(palette.foreground)).toBeGreaterThan(0.8);
  });

  it("tunes each ANSI color for contrast against its own background", () => {
    for (const mode of ["light", "dark"] as const) {
      const palette = TERMINAL_PALETTES[mode];
      const ansiColors = [
        palette.red,
        palette.green,
        palette.yellow,
        palette.blue,
        palette.magenta,
        palette.cyan,
        palette.white,
        palette.brightBlack,
        palette.brightRed,
        palette.brightGreen,
        palette.brightYellow,
        palette.brightBlue,
        palette.brightMagenta,
        palette.brightCyan,
        palette.brightWhite,
      ];
      // ANSI black is intentionally near the background in both modes
      // (standard terminal convention: it renders dim text), so it is
      // checked separately below.
      for (const color of ansiColors) {
        const contrast = Math.abs(luminance(color) - luminance(palette.background));
        expect(contrast, `${mode} ${color} vs ${palette.background}`).toBeGreaterThan(0.25);
      }
      // ANSI black must sit on the same side of the background as dim text:
      // darker than the background in dark mode, clearly dark in light mode.
      if (mode === "dark") {
        expect(luminance(palette.black)).toBeLessThanOrEqual(luminance(palette.background) + 0.05);
      } else {
        expect(luminance(palette.black)).toBeLessThan(0.35);
      }
    }
  });

  it("keeps cursor readable on the background in both modes", () => {
    for (const mode of ["light", "dark"] as const) {
      const palette = TERMINAL_PALETTES[mode];
      const contrast = Math.abs(luminance(palette.cursor) - luminance(palette.background));
      expect(contrast, mode).toBeGreaterThan(0.25);
    }
  });
});
