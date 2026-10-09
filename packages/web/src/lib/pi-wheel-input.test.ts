// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { PiWheelInput } from "./pi-wheel-input";

const geometry = { left: 100, top: 200, width: 800, height: 600, cols: 80, rows: 30 };

function wheel(deltaY: number, options: WheelEventInit = {}): WheelEvent {
  return new WheelEvent("wheel", { deltaY, clientX: 500, clientY: 500, ...options });
}

describe("pi wheel input coalescing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits one report per accumulated mouse notch", () => {
    // Arrange
    const sink = vi.fn();
    const input = new PiWheelInput(sink);

    // Act / Assert: a 120px notch is exactly one report, sent inline.
    expect(input.encode(wheel(-120), geometry)).toBe("\x1b[<64;41;16M");
    expect(sink).not.toHaveBeenCalled();
    expect(input.encode(wheel(120), geometry)).toBe("\x1b[<65;41;16M");
    input.dispose();
  });

  it("coalesces a trackpad sweep into one report per notch instead of one per event", () => {
    // Arrange: 540px of sweep arrives as 18 raw events (30px each, 16ms apart).
    vi.useFakeTimers();
    const sink = vi.fn();
    const input = new PiWheelInput(sink);
    const inlineReports: string[] = [];
    for (let i = 0; i < 18; i += 1) {
      inlineReports.push(input.encode(wheel(-30), geometry) ?? "");
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(100); // let the tail flush fire

    // Assert: 540px = 5.4 notches → 5 inline reports (20px residue carries
    // into the next notch) + 1 tail flush — never 18 raw events.
    const inlineCount = inlineReports.filter(report => report !== "").length;
    expect(inlineCount).toBe(5);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toBe("\x1b[<64;41;16M");
    input.dispose();
  });

  it("flushes a micro-flick tail after the gesture stops", () => {
    // Arrange: a deliberate flick that never reaches a full notch.
    vi.useFakeTimers();
    const sink = vi.fn();
    const input = new PiWheelInput(sink);

    // Act
    expect(input.encode(wheel(-15), geometry)).toBe("");
    expect(input.encode(wheel(-15), geometry)).toBe("");
    vi.advanceTimersByTime(100);

    // Assert: one report so the flick still lands; PI gives an isolated
    // event a single line.
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toBe("\x1b[<64;41;16M");
    input.dispose();
  });

  it("drops sub-tail noise and never forwards modifier gestures", () => {
    // Arrange
    vi.useFakeTimers();
    const sink = vi.fn();
    const input = new PiWheelInput(sink);

    // Act / Assert
    expect(input.encode(wheel(-5), geometry)).toBe("");
    vi.advanceTimersByTime(100);
    expect(sink).not.toHaveBeenCalled();
    expect(input.encode(wheel(5, { ctrlKey: true }), geometry)).toBeNull();
    expect(input.encode(wheel(5, { metaKey: true }), geometry)).toBeNull();
    expect(input.encode(wheel(0), geometry)).toBeNull();
    input.dispose();
  });

  it("clamps coordinates to the grid", () => {
    // Arrange
    const input = new PiWheelInput(vi.fn());

    // Act / Assert
    expect(input.encode(wheel(-120, { clientX: -100, clientY: 3000 }), geometry)).toBe("\x1b[<64;1;30M");
    input.dispose();
  });
});
