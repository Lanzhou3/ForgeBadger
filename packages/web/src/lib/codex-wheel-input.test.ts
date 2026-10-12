// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { CodexWheelInput } from "./codex-wheel-input";

const geometry = { left: 100, top: 200, width: 800, height: 600, cols: 80, rows: 30 };

function wheel(deltaY: number, options: WheelEventInit = {}): WheelEvent {
  return new WheelEvent("wheel", { deltaY, clientX: 500, clientY: 500, ...options });
}

describe("Codex trackpad wheel input", () => {
  it("accumulates small pixel movements until a wheel report can be sent", () => {
    // Arrange
    const input = new CodexWheelInput();

    // Act / Assert
    expect(input.encode(wheel(-4), geometry)).toBe("");
    expect(input.encode(wheel(-4), geometry)).toBe("");
    expect(input.encode(wheel(-4), geometry)).toBe("\x1b[<64;41;16M");
  });

  it("keeps the distance of a large gesture instead of collapsing it to one report", () => {
    // Arrange
    const input = new CodexWheelInput();

    // Act
    const data = input.encode(wheel(120), geometry);

    // Assert
    expect(data).toBe("\x1b[<65;41;16M".repeat(12));
  });

  it("caps bursts, clamps coordinates, and ignores browser zoom gestures", () => {
    // Arrange
    const input = new CodexWheelInput();

    // Act / Assert
    expect(input.encode(wheel(-1200, { clientX: -100, clientY: 3000 }), geometry))
      .toBe("\x1b[<64;1;30M".repeat(24));
    expect(input.encode(wheel(2, { ctrlKey: true }), geometry)).toBeNull();
    expect(input.encode(wheel(5), geometry)).toBe("");
  });
});
