// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APPEARANCE_INIT_SCRIPT } from "./appearance-init";
import { COLOR_THEMES, DEFAULT_COLOR_THEMES, initColorThemes, readStoredColorTheme, setColorTheme } from "./color-theme";
import { readStoredColorMode, setColorMode } from "./color-mode";

describe("appearance first paint", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  });
  afterEach(() => vi.restoreAllMocks());

  function bootstrap() {
    // Execute the exact static script embedded before hydration by RootLayout.
    new Function(APPEARANCE_INIT_SCRIPT)();
  }

  it.each([true, false])("uses native defaults before hydration when system dark is %s", (dark) => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: dark } as MediaQueryList);
    bootstrap();
    expect(document.documentElement.dataset.darkTheme).toBe(DEFAULT_COLOR_THEMES.dark);
    expect(document.documentElement.dataset.lightTheme).toBe(DEFAULT_COLOR_THEMES.light);
    expect(document.documentElement.classList.contains("dark")).toBe(dark);
    expect(document.documentElement.style.colorScheme).toBe(dark ? "dark" : "light");
  });

  it("restores every explicit theme and agrees with the client initialization", () => {
    for (const theme of COLOR_THEMES) {
      window.localStorage.setItem(`forgebadger.${theme.mode}-theme`, theme.id);
      window.localStorage.setItem("forgebadger.color-mode", theme.mode);
      bootstrap();
      const firstPaint = { ...document.documentElement.dataset };
      expect(firstPaint[theme.mode === "dark" ? "darkTheme" : "lightTheme"]).toBe(theme.id);
      expect(document.documentElement.style.colorScheme).toBe(theme.mode);
      initColorThemes();
      expect({ ...document.documentElement.dataset }).toEqual(firstPaint);
    }
  });

  it("rejects cross-mode and removed identifiers before the first render", () => {
    window.localStorage.setItem("forgebadger.dark-theme", "github-light");
    window.localStorage.setItem("forgebadger.light-theme", "removed-theme");
    bootstrap();
    expect(document.documentElement.dataset.darkTheme).toBe("forgebadger-dark");
    expect(document.documentElement.dataset.lightTheme).toBe("forgebadger-light");
  });

  it("remains usable when browser preference storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    bootstrap();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(readStoredColorTheme("dark")).toBe(DEFAULT_COLOR_THEMES.dark);
    expect(readStoredColorMode()).toBe("system");
    initColorThemes();
    setColorTheme("forgebadger-light");
    setColorMode("light");
    expect(document.documentElement.dataset.lightTheme).toBe("forgebadger-light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
