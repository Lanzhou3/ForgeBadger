// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedStatValue } from "./animated-stat-value";

function stubMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced
      ? query.includes("(prefers-reduced-motion: reduce)")
      : query.includes("no-preference"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "matchMedia", {
    value: originalMatchMedia,
    configurable: true,
    writable: true,
  });
});

describe("AnimatedStatValue", () => {
  it("renders non-numeric placeholders statically without touching matchMedia", () => {
    const matchMediaSpy = vi.spyOn(window, "matchMedia");
    render(<AnimatedStatValue value="—" />);
    expect(screen.getByText("—").className).toContain("tabular-nums");
    expect(matchMediaSpy).not.toHaveBeenCalled();
  });

  it("shows the final integer immediately under reduced motion", () => {
    stubMatchMedia(true);
    render(<AnimatedStatValue value={42} />);
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("tweens from the previously displayed value to the next one", async () => {
    const { rerender } = render(<AnimatedStatValue value={0} />);
    expect(screen.getByText("0")).toBeTruthy();
    rerender(<AnimatedStatValue value={12} />);
    await waitFor(() => expect(screen.getByText("12")).toBeTruthy());
  });

  it("keeps the displayed value in sync when data disappears and returns", async () => {
    const { rerender } = render(<AnimatedStatValue value={7} />);
    rerender(<AnimatedStatValue value="—" />);
    expect(screen.getByText("—")).toBeTruthy();
    rerender(<AnimatedStatValue value={3} />);
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy());
  });
});
