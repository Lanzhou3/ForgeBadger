// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TERMINAL_FONT,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_STORAGE_KEY,
  ensureTerminalFontLoaded,
  getTerminalFontState,
  parseTerminalFont,
  readStoredTerminalFont,
  setTerminalFont,
  writeTerminalFont,
} from "./terminal-font";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("terminal font", () => {
  it("defaults to the bundled Nerd Font family and 14px", () => {
    expect(DEFAULT_TERMINAL_FONT.fontFamily).toContain("ForgeBadger Nerd");
    expect(DEFAULT_TERMINAL_FONT.fontSize).toBe(14);
  });

  it("clamps the font size into the supported range", () => {
    expect(MIN_TERMINAL_FONT_SIZE).toBe(8);
    expect(MAX_TERMINAL_FONT_SIZE).toBe(32);
    const storage = new MemoryStorage();
    writeTerminalFont({ fontFamily: "x", fontSize: 4 }, storage);
    expect(readStoredTerminalFont(storage).fontSize).toBe(MIN_TERMINAL_FONT_SIZE);
    writeTerminalFont({ fontFamily: "x", fontSize: 99 }, storage);
    expect(readStoredTerminalFont(storage).fontSize).toBe(MAX_TERMINAL_FONT_SIZE);
    writeTerminalFont({ fontFamily: "x", fontSize: 13.6 }, storage);
    expect(readStoredTerminalFont(storage).fontSize).toBe(14);
  });

  it("falls back to the default family when the stored value is empty", () => {
    const storage = new MemoryStorage();
    writeTerminalFont({ fontFamily: "   ", fontSize: 14 }, storage);
    expect(readStoredTerminalFont(storage).fontFamily).toBe(DEFAULT_TERMINAL_FONT.fontFamily);
  });

  it("parses a valid stored payload", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      TERMINAL_FONT_STORAGE_KEY,
      JSON.stringify({ fontFamily: "MyFont, monospace", fontSize: 16 })
    );
    expect(readStoredTerminalFont(storage)).toEqual({
      fontFamily: "MyFont, monospace",
      fontSize: 16,
    });
  });

  it("returns defaults for malformed JSON or missing payload", () => {
    expect(parseTerminalFont(null)).toEqual(DEFAULT_TERMINAL_FONT);
    expect(parseTerminalFont("not json")).toEqual(DEFAULT_TERMINAL_FONT);
    expect(parseTerminalFont(JSON.stringify({ fontFamily: "", fontSize: 14 }))).toEqual({
      fontFamily: DEFAULT_TERMINAL_FONT.fontFamily,
      fontSize: 14,
    });
  });

  it("setTerminalFont persists, clamps, and updates the reactive store", () => {
    setTerminalFont({ fontFamily: "Custom NF", fontSize: 50 });
    expect(getTerminalFontState()).toEqual({
      fontFamily: "Custom NF",
      fontSize: MAX_TERMINAL_FONT_SIZE,
    });
    expect(window.localStorage.getItem(TERMINAL_FONT_STORAGE_KEY)).toContain("Custom NF");
    // restore for other tests
    setTerminalFont(DEFAULT_TERMINAL_FONT);
  });

  it("ensureTerminalFontLoaded is a no-op when the family does not use the bundled font", async () => {
    await expect(ensureTerminalFontLoaded("ui-monospace, monospace")).resolves.toBeUndefined();
  });

  it("ensureTerminalFontLoaded loads the bundled faces when referenced", async () => {
    // document.fonts.load is stubbed as a resolving spy; just assert it does
    // not throw and resolves.
    const load = vi.fn(() => Promise.resolve([] as FontFace[]));
    Object.defineProperty(document, "fonts", { value: { load }, configurable: true });
    await expect(
      ensureTerminalFontLoaded('400 14px "ForgeBadger Nerd"')
    ).resolves.toBeUndefined();
    expect(load).toHaveBeenCalled();
  });
});
