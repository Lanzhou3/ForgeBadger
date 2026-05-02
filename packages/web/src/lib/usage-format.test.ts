import { describe, expect, it } from "vitest";

import { formatDurationMs, formatEstimatedUsd } from "./usage-format";

describe("usage formatters", () => {
  it("formats durations into compact hours and minutes", () => {
    expect(formatDurationMs(0)).toBe("0m");
    expect(formatDurationMs(5 * 60 * 1000)).toBe("5m");
    expect(formatDurationMs(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe("2h 15m");
  });

  it("formats estimated usd values without implying billing precision", () => {
    expect(formatEstimatedUsd(0)).toBe("$0.00 est.");
    expect(formatEstimatedUsd(1.257)).toBe("$1.26 est.");
  });
});
