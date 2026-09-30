// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  COLOR_MODE_STORAGE_KEY,
  DEFAULT_COLOR_MODE,
  applyColorMode,
  getColorModeState,
  initColorMode,
  isColorMode,
  readStoredColorMode,
  resolveColorMode,
  setColorMode,
  watchSystemColorMode,
} from "./color-mode";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function makeStorage() {
  return new MemoryStorage();
}

describe("color mode", () => {
  it("defaults to system", () => {
    expect(DEFAULT_COLOR_MODE).toBe("system");
    expect(readStoredColorMode(makeStorage())).toBe("system");
  });

  it("validates mode ids", () => {
    expect(isColorMode("light")).toBe(true);
    expect(isColorMode("dark")).toBe(true);
    expect(isColorMode("system")).toBe(true);
    expect(isColorMode("auto")).toBe(false);
    expect(isColorMode(null)).toBe(false);
  });

  it("reads the stored mode with fallback to default", () => {
    const storage = makeStorage();
    expect(readStoredColorMode(storage)).toBe("system");
    storage.setItem(COLOR_MODE_STORAGE_KEY, "dark");
    expect(readStoredColorMode(storage)).toBe("dark");
    storage.setItem(COLOR_MODE_STORAGE_KEY, "bogus");
    expect(readStoredColorMode(storage)).toBe("system");
  });

  it("resolves system via matchMedia", () => {
    expect(resolveColorMode("light", { matches: true })).toBe("light");
    expect(resolveColorMode("dark", { matches: false })).toBe("dark");
    expect(resolveColorMode("system", { matches: true })).toBe("dark");
    expect(resolveColorMode("system", { matches: false })).toBe("light");
    // Missing matcher falls back to light for system.
    expect(resolveColorMode("system", undefined)).toBe("light");
  });

  it("applies the dark class and color-scheme to <html>", () => {
    const storage = makeStorage();
    const root = document.documentElement;
    root.classList.remove("dark");

    applyColorMode("dark", storage);
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    expect(storage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");

    applyColorMode("light", storage);
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
    expect(storage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("light");
  });

  it("falls back to default for an invalid stored mode on apply", () => {
    const storage = makeStorage();
    applyColorMode("bogus" as never, storage);
    expect(storage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("system");
  });

  it("watchSystemColorMode subscribes and unsubscribes", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const mql = { addEventListener, removeEventListener } as unknown as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(mql);

    const onChange = vi.fn();
    const stop = watchSystemColorMode(onChange);
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    stop();
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    vi.restoreAllMocks();
  });

  it("setColorMode applies to <html>, persists, and updates the store", () => {
    setColorMode("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(getColorModeState()).toEqual({ mode: "light", resolved: "light" });
    expect(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("light");
  });

  it("initColorMode syncs the store from storage and follows the system when asked", () => {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "dark");
    const stop = initColorMode();
    expect(getColorModeState()).toEqual({ mode: "dark", resolved: "dark" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    stop();

    // system + dark OS preference
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, "system");
    const mql = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.spyOn(window, "matchMedia").mockReturnValue(mql as unknown as MediaQueryList);
    const stopSystem = initColorMode();
    expect(getColorModeState()).toEqual({ mode: "system", resolved: "dark" });
    stopSystem();
    vi.restoreAllMocks();
  });
});
