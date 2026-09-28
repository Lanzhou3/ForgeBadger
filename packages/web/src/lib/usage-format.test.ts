import { describe, expect, it } from "vitest";

import { formatDurationMs, formatEstimatedUsd, formatTokens } from "./usage-format";

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

  it("formats token counts into compact k/M/B units", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(-5)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(1_250_000_000)).toBe("1.3B");
  });
});
