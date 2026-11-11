// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initColorThemes, setColorTheme } from "@/lib/color-theme";
import { getColorModeState, setColorMode } from "@/lib/color-mode";
import { ColorThemeSettings } from "./ColorThemeSettings";

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

describe("ColorThemeSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    initColorThemes();
    setColorMode("dark");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses theme cards for manual light/dark selection with one active choice", () => {
    render(<ColorThemeSettings />);
    expect(screen.queryByRole("button", { name: "settings.colorModeLight" })).toBeNull();
    expect(screen.queryByRole("button", { name: "settings.colorModeDark" })).toBeNull();
    expect(screen.getByRole("button", { name: "One Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "GitHub Light" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Solarized Light" }));

    expect(getColorModeState()).toEqual({ mode: "light", resolved: "light" });
    expect(screen.getByRole("button", { name: "Solarized Light" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("keeps system preferences distinct from the only active theme", () => {
    setColorTheme("tokyo-night");
    setColorTheme("solarized-light");
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    setColorMode("system");
    render(<ColorThemeSettings />);

    expect(screen.getByRole("switch", { name: "settings.colorModeSystem" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tokyo Night" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Solarized Light" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByText("settings.themePreferred")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "GitHub Light" }));

    expect(getColorModeState().mode).toBe("system");
    expect(window.localStorage.getItem("forgebadger.light-theme")).toBe("github-light");
    expect(screen.getByRole("button", { name: "Tokyo Night" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });
});
