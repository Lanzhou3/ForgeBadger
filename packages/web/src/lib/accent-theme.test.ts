import { describe, expect, it } from "vitest";

import {
  ACCENT_THEMES,
  DEFAULT_ACCENT_ID,
  getAccentTheme,
  isAccentThemeId,
  readStoredAccent,
} from "./accent-theme";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("accent theme", () => {
  it("defaults to cyan", () => {
    expect(DEFAULT_ACCENT_ID).toBe("cyan");
    expect(getAccentTheme(undefined).id).toBe("cyan");
    expect(getAccentTheme("nope").id).toBe("cyan");
  });

  it("validates theme ids", () => {
    expect(isAccentThemeId("violet")).toBe(true);
    expect(isAccentThemeId("hacker-green")).toBe(false);
    expect(isAccentThemeId(null)).toBe(false);
  });

  it("reads the stored accent with fallback to default", () => {
    const storage = new MemoryStorage();
    expect(readStoredAccent(storage)).toBe("cyan");
    storage.setItem("openforge.accent", "rose");
    expect(readStoredAccent(storage)).toBe("rose");
    storage.setItem("openforge.accent", "bogus");
    expect(readStoredAccent(storage)).toBe("cyan");
  });

  it("gives every theme a distinct brand color and swatch", () => {
    const brands = new Set(ACCENT_THEMES.map((theme) => theme.brand));
    const swatches = new Set(ACCENT_THEMES.map((theme) => theme.swatch));
    expect(brands.size).toBe(ACCENT_THEMES.length);
    expect(swatches.size).toBe(ACCENT_THEMES.length);
  });
});
