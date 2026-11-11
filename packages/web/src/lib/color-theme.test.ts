// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  COLOR_THEMES,
  COLOR_THEME_STORAGE_KEYS,
  DEFAULT_COLOR_THEMES,
  getColorTheme,
  getColorThemeState,
  initColorThemes,
  isColorThemeId,
  readDocumentColorTheme,
  readStoredColorTheme,
  setColorTheme,
} from "./color-theme";

describe("color themes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.darkTheme;
    delete document.documentElement.dataset.lightTheme;
    initColorThemes();
  });

  it("offers two distinct dark and two distinct light themes", () => {
    expect(COLOR_THEMES.filter((theme) => theme.mode === "dark").map((theme) => theme.id)).toEqual([
      "one-dark",
      "tokyo-night",
    ]);
    expect(COLOR_THEMES.filter((theme) => theme.mode === "light").map((theme) => theme.id)).toEqual([
      "github-light",
      "solarized-light",
    ]);
    expect(new Set(COLOR_THEMES.map((theme) => theme.preview.background)).size).toBe(4);
    expect(new Set(COLOR_THEMES.map((theme) => theme.preview.accent)).size).toBe(4);
  });

  it("validates theme ids and resolves named themes", () => {
    expect(isColorThemeId("one-dark")).toBe(true);
    expect(isColorThemeId("tokyo-night")).toBe(true);
    expect(isColorThemeId("github-light")).toBe(true);
    expect(isColorThemeId("solarized-light")).toBe(true);
    expect(isColorThemeId("cyan")).toBe(false);
    expect(getColorTheme("tokyo-night").name).toBe("Tokyo Night");
    expect(getColorTheme("missing").id).toBe(DEFAULT_COLOR_THEMES.dark);
  });

  it("reads each mode independently and rejects a theme from the other mode", () => {
    expect(readStoredColorTheme("dark")).toBe("one-dark");
    expect(readStoredColorTheme("light")).toBe("github-light");
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEYS.dark, "tokyo-night");
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEYS.light, "solarized-light");
    expect(readStoredColorTheme("dark")).toBe("tokyo-night");
    expect(readStoredColorTheme("light")).toBe("solarized-light");
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEYS.dark, "github-light");
    expect(readStoredColorTheme("dark")).toBe("one-dark");
  });

  it("persists a dark selection without changing the light selection", () => {
    setColorTheme("solarized-light");
    setColorTheme("tokyo-night");
    expect(getColorThemeState()).toEqual({ dark: "tokyo-night", light: "solarized-light" });
    expect(window.localStorage.getItem(COLOR_THEME_STORAGE_KEYS.dark)).toBe("tokyo-night");
    expect(window.localStorage.getItem(COLOR_THEME_STORAGE_KEYS.light)).toBe("solarized-light");
    expect(document.documentElement.dataset.darkTheme).toBe("tokyo-night");
    expect(document.documentElement.dataset.lightTheme).toBe("solarized-light");
    expect(readDocumentColorTheme("dark")).toBe("tokyo-night");
    expect(readDocumentColorTheme("light")).toBe("solarized-light");
  });

  it("restores both selections during initialization", () => {
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEYS.dark, "tokyo-night");
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEYS.light, "solarized-light");
    initColorThemes();
    expect(getColorThemeState()).toEqual({ dark: "tokyo-night", light: "solarized-light" });
    expect(document.documentElement.dataset.darkTheme).toBe("tokyo-night");
    expect(document.documentElement.dataset.lightTheme).toBe("solarized-light");
  });
});
